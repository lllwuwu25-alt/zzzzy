use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tokio_util::sync::CancellationToken;
use crate::ai_settings;

#[derive(Default)]
pub struct Requests(pub Mutex<HashMap<String, CancellationToken>>);
#[derive(Serialize)]
pub struct AiResponse { pub content: String, pub model: String }
pub(crate) fn status_error(code: u16) -> String {
    match code {
        401 => "DeepSeek API 密钥无效，请检查后重试。",
        402 => "DeepSeek 账户余额不足，请充值后重试。",
        429 => "请求过于频繁，请稍后手动重试。",
        400 | 422 => "模型或图片请求不受支持，请检查模型设置。",
        _ => "DeepSeek 服务暂时无法完成请求，请稍后重试。",
    }.into()
}
pub(crate) fn build_body(model: &str, question_type: &str, images: &[String], ocr_text: &str, prompt: &str) -> Result<Value, String> {
    if !ai_settings::valid_model(model) || !["choice", "fill-blank", "short-answer"].contains(&question_type) { return Err("模型或题型不正确".into()); }
    if images.is_empty() || images.len() > 8 { return Err("每次请选择 1–8 张图片".into()); }
    if ocr_text.len() > 200_000 || prompt.len() > 20000 { return Err("识别文字过长，请分批识别".into()); }
    let mut size = 0;
    let mut content = vec![json!({"type":"text","text":format!("题型：{question_type}。以下是可能有误的 OCR 参考，以图片为准：\n{ocr_text}")})];
    for image in images {
        if image.len() > 17 * 1024 * 1024 { return Err("图片过大，请分批识别".into()); }
        let (prefix, encoded) = image.split_once(',').ok_or("图片格式不正确")?;
        if !["data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"].contains(&prefix) { return Err("图片格式不正确".into()); }
        let bytes = STANDARD.decode(encoded).map_err(|_| "图片内容损坏")?;
        if !matches!(infer::get(&bytes).map(|v|v.mime_type()), Some("image/png" | "image/jpeg" | "image/webp")) { return Err("图片真实类型不受支持".into()); }
        size += bytes.len();
        if size > 12 * 1024 * 1024 { return Err("图片合计超过 12 MB，请分批识别".into()); }
        content.push(json!({"type":"image_url","image_url":{"url":image}}));
    }
    Ok(json!({"model":model,"stream":false,"thinking":{"type":"disabled"},"max_tokens":8192,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":prompt},{"role":"user","content":content}]}))
}
pub(crate) fn parse_response(raw: &str) -> Result<String, String> {
    if raw.len() > 1024 * 1024 { return Err("服务返回内容过大，请减少图片后重试。".into()); }
    let parsed: Value = serde_json::from_str(raw).map_err(|_| "服务返回格式无法读取，请重试。")?;
    let choice = &parsed["choices"][0];
    if choice["finish_reason"] != "stop" { return Err("识别内容被截断或未完成，请减少图片后重试。".into()); }
    let value = choice["message"]["content"].as_str().filter(|s| !s.trim().is_empty()).ok_or("服务未返回识别内容，请重试。")?;
    if value.len() > 256 * 1024 { return Err("识别结果过大，请分批重试。".into()); }
    Ok(value.to_owned())
}
async fn send_request(body: Value, key: String) -> Result<String, String> {
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(90)).build().map_err(|_| "无法初始化联网请求")?;
    let mut response = client.post("https://api.deepseek.com/chat/completions").bearer_auth(key).json(&body).send().await.map_err(|e| if e.is_timeout() { "识别超过 90 秒，请重试。" } else { "无法连接 DeepSeek，请检查网络。" })?;
    if !response.status().is_success() { return Err(status_error(response.status().as_u16())); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "服务响应中断，请重试。")? {
        if bytes.len() + chunk.len() > 1024 * 1024 { return Err("服务返回内容过大，请减少图片后重试。".into()); }
        bytes.extend_from_slice(&chunk);
    }
    parse_response(std::str::from_utf8(&bytes).map_err(|_| "服务返回格式无法读取。")?)
}
pub(crate) fn begin_request(state: &Requests, request_id: &str) -> Result<CancellationToken, String> {
        let mut requests = state.0.lock().map_err(|_| "无法创建识别任务")?;
        if let Some(token) = requests.get(request_id) {
            if token.is_cancelled() { requests.remove(request_id); return Err("识别已取消".into()); }
            return Err("已有识别任务，请稍后重试".into());
        }
        if requests.values().filter(|token| !token.is_cancelled()).count() >= 4 { return Err("已有识别任务，请稍后重试".into()); }
        let token = CancellationToken::new();
        requests.insert(request_id.to_owned(), token.clone()); Ok(token)
}
async fn perform(app: &tauri::AppHandle, state: &Requests, request_id: String, question_type: String, images: Vec<String>, ocr_text: String, prompt: String) -> Result<AiResponse, String> {
    if request_id.len() > 100 || request_id.is_empty() { return Err("请求标识无效".into()); }
    let token = begin_request(state, &request_id)?;
    let app = app.clone();
    let operation = async {
        let (settings, key, body) = tokio::task::spawn_blocking(move || -> Result<_, String> {
            let settings = ai_settings::read_settings(&app)?;
            if !settings.enabled { return Err("请先在设置中启用 DeepSeek".into()); }
            let key = ai_settings::read_key()?.ok_or("请先填写 DeepSeek API 密钥")?;
            let body = build_body(&settings.model, &question_type, &images, &ocr_text, &prompt)?;
            Ok((settings, key, body))
        }).await.map_err(|_| "无法准备识别请求".to_string())??;
        if token.is_cancelled() { return Err("识别已取消".into()); }
        send_request(body, key).await.map(|content| AiResponse { content, model: settings.model })
    };
    let result = tokio::select! {
        _ = token.cancelled() => Err("识别已取消".to_string()),
        result = tokio::time::timeout(Duration::from_secs(90), operation) => result.unwrap_or_else(|_| Err("识别超过 90 秒，请重试。".into())),
    };
    if let Ok(mut requests) = state.0.lock() { requests.remove(&request_id); }
    result
}
#[tauri::command]
pub async fn recognize_ai_question(app: tauri::AppHandle, state: tauri::State<'_, Requests>, request_id: String, question_type: String, images: Vec<String>, ocr_text: String, prompt: String) -> Result<AiResponse, String> {
    perform(&app, &state, request_id, question_type, images, ocr_text, prompt).await
}
#[tauri::command]
pub fn cancel_ai_request(state: tauri::State<'_, Requests>, request_id: String) {
    cancel_request(&state, request_id);
}
pub(crate) fn cancel_request(state: &Requests, request_id: String) {
    if request_id.len() > 100 { return; }
    if let Ok(mut requests) = state.0.lock() {
        if requests.len() >= 256 { requests.retain(|_, token| !token.is_cancelled()); }
        requests.entry(request_id).or_default().cancel();
    }
}
#[tauri::command]
pub async fn test_ai_connection(app: tauri::AppHandle, state: tauri::State<'_, Requests>, request_id: String) -> Result<(), String> {
    // Synthetic fixture contains a known black/white pattern, never user data.
    let image = format!("data:image/png;base64,{}", STANDARD.encode(include_bytes!("ai-test-image.png")));
    let response = perform(&app, &state, request_id, "short-answer".into(), vec![image], String::new(), "Read the digit in the test image. Return JSON with the single key digit and the digit as a string. Do not guess if unreadable.".into()).await?;
    let value: Value = serde_json::from_str(&response.content).map_err(|_| "视觉连接测试未通过，请检查模型。")?;
    if value["digit"] != "7" { return Err("视觉连接测试未通过，请检查模型。".into()); }
    Ok(())
}
