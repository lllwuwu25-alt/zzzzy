use serde_json::Value;
use sha2::{Digest, Sha256};
use std::process::Command;
use tauri::Manager;
use super::sync_policy::{validated_gateway, valid_path, valid_auth_url};
use base64::{engine::general_purpose::STANDARD, Engine};

const MAX_TRANSFER: usize = 32 * 1024 * 1024;
fn service(identifier: &str, gateway: &str) -> String {
    format!("{identifier}.sync.{:x}", Sha256::digest(gateway.as_bytes()))
}
fn configured_gateway() -> Result<String, String> {
    validated_gateway(option_env!("VITE_SYNC_GATEWAY_URL").unwrap_or(""), cfg!(debug_assertions))
}
#[cfg(not(target_os = "android"))]
fn entry(app: &tauri::AppHandle, gateway: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(&service(&app.config().identifier, gateway), "product-session").map_err(|_| "无法访问系统安全存储。".into())
}
fn read_credentials(app: &tauri::AppHandle, gateway: &str) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        return match super::android::secure_read(app, &service(&app.config().identifier, gateway))? {
            Some(value) => serde_json::from_str(&value).map_err(|_| "同步凭据损坏，请重新连接飞书。".into()),
            None => Ok(serde_json::json!({})),
        };
    }
    #[cfg(not(target_os = "android"))]
    match entry(app, gateway)?.get_password() {
        Ok(value) => serde_json::from_str(&value).map_err(|_| "同步凭据损坏，请重新连接飞书。".into()),
        Err(keyring::Error::NoEntry) => Ok(serde_json::json!({})),
        Err(_) => Err("无法读取同步凭据，请解锁系统安全存储后重试。".into()),
    }
}
fn write_credentials(app: &tauri::AppHandle, gateway: &str, value: &Value) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { super::android::secure_write(app, &service(&app.config().identifier, gateway), Some(&value.to_string())) }
    #[cfg(not(target_os = "android"))]
    { entry(app, gateway)?.set_password(&value.to_string()).map_err(|_| "会话未保存：请解锁系统安全存储后重新授权。".into()) }
}

/// The webview never receives a long-lived product session or Feishu credentials.
#[tauri::command]
pub async fn sync_gateway_request(app: tauri::AppHandle, method: String, path: String, mut body: Value) -> Result<Value, String> {
    super::license::require_write(&app)?;
    if !valid_path(&method, &path) { return Err("同步请求地址或方法无效。".into()); }
    let gateway = configured_gateway()?;
    let credentials = read_credentials(&app, &gateway)?;
    if path == "/v1/auth/feishu/start" {
        if !body.is_object() { return Err("授权请求无效。".into()); }
        body["client"] = Value::String("native".into());
        if let Some(proof) = credentials.get("deviceProof").and_then(Value::as_str) { body["deviceProof"] = Value::String(proof.into()); }
    }
    if path == "/v1/auth/exchange" && body.is_object() { body["client"] = Value::String("native".into()); }
    if serde_json::to_vec(&body).map_err(|_| "同步请求无法编码。")?.len() > MAX_TRANSFER { return Err("同步请求过大，请缩小单张图片后重试。".into()); }
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(60)).build().map_err(|_| "无法初始化安全连接。".to_string())?;
    let mut request = client.request(reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "请求方法无效。")?, format!("{gateway}{path}")).header("Origin", "tauri://localhost").header("Accept", "application/json");
    if let Some(token) = credentials.get("sessionToken").and_then(Value::as_str) { request = request.bearer_auth(token); }
    if method != "GET" && !body.is_null() { request = request.json(&body); }
    let mut response = request.send().await.map_err(|_| "无法连接云同步服务，本地数据仍保留。".to_string())?;
    let status = response.status().as_u16();
    let content_type = response.headers().get("content-type").and_then(|h| h.to_str().ok()).unwrap_or("").to_string();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "同步读取中断，请稍后重试。".to_string())? {
        if bytes.len() + chunk.len() > MAX_TRANSFER { return Err("同步响应过大，未写入本地。".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let mut value: Value = if content_type.starts_with("image/") && status == 200 {
        serde_json::json!({"dataUrl":format!("data:{};base64,{}", content_type.split(';').next().unwrap_or("image/png"), STANDARD.encode(&bytes))})
    } else { serde_json::from_slice(&bytes).map_err(|_| "云同步服务响应无效，请联系部署人员。".to_string())? };
    if path == "/v1/auth/exchange" && status == 200 && value.get("status").and_then(Value::as_str) == Some("complete") {
        let session_token = value.get("sessionToken").and_then(Value::as_str).filter(|t| t.len() >= 32).ok_or("授权会话不完整，请重新连接。")?;
        let proof = value.get("deviceProof").and_then(Value::as_str).filter(|t| t.len() >= 32).ok_or("设备凭据不完整，请重新连接。")?;
        write_credentials(&app, &gateway, &serde_json::json!({"sessionToken":session_token,"deviceProof":proof}))?;
    }
    if let Some(object) = value.as_object_mut() { object.remove("sessionToken"); object.remove("deviceProof"); }
    if status == 200 && ["/v1/auth/logout", "/v1/auth/disconnect", "/v1/connections/feishu/disconnect"].contains(&path.as_str()) {
        // Keep only opaque device proof for safe later reauthentication; never retain an active session after logout.
        let remaining = serde_json::json!({"deviceProof":credentials.get("deviceProof")});
        write_credentials(&app, &gateway, &remaining)?;
    }
    Ok(serde_json::json!({"status":status,"body":value}))
}

#[tauri::command]
pub async fn open_feishu_authorization(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !valid_auth_url(&url) { return Err("飞书授权地址未通过安全检查。".into()); }
    #[cfg(target_os = "android")]
    { return super::android::open_auth(&app, &url).await; }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32.exe").arg("url.dll,FileProtocolHandler").arg(&url).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(&url).status();
    #[cfg(not(target_os = "android"))]
    { status.map_err(|_| "无法打开系统浏览器。".to_string()).and_then(|s| if s.success() { Ok(()) } else { Err("系统浏览器没有打开，请重试。".into()) }) }
}

#[tauri::command]
pub fn create_sync_backup(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    super::license::require_write(&app)?;
    super::validate_notebook_json(&contents)?;
    let dir = app.path().app_data_dir().map_err(|_| "无法定位备份目录。")?.join("sync-backups");
    std::fs::create_dir_all(&dir).map_err(|_| "无法创建同步前备份目录，请检查磁盘空间。")?;
    let digest = format!("{:x}", Sha256::digest(contents.as_bytes()));
    let target = dir.join(format!("before-cloud-{digest}.json"));
    if !target.exists() { super::write_atomic(&target, &contents)?; }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_sync_backup_folder(app: tauri::AppHandle) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(|_| "无法定位备份目录。")?.join("sync-backups");
    if !directory.is_dir() { return Err("尚无同步前自动备份，请先完成首次连接。".into()); }
    super::open_workspace_folder(directory.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn gateway_rejects_unencrypted_or_credential_bearing_addresses() {
        assert!(super::validated_gateway("http://example.com", false).is_err());
        assert!(super::validated_gateway("https://user:pass@example.com", false).is_err());
        assert!(super::validated_gateway("https://api.example.com/path", false).is_err());
        assert!(super::validated_gateway("http://127.0.0.1:8787", true).is_ok());
    }
    #[test]
    fn request_path_cannot_escape_gateway_or_use_unapproved_methods() {
        assert!(super::valid_path("GET", "/v1/me"));
        assert!(!super::valid_path("GET", "//attacker.test/v1/me"));
        assert!(!super::valid_path("GET", "/v1/../private"));
        assert!(!super::valid_path("GET", "/v1/%2e%2e/private"));
        assert!(!super::valid_path("PUT", "/v1/me"));
    }
    #[test]
    fn authorization_browser_has_fixed_host_and_path() {
        assert!(super::valid_auth_url("https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=sample"));
        assert!(!super::valid_auth_url("https://accounts.feishu.cn.evil.test/open-apis/authen/v1/authorize"));
        assert!(!super::valid_auth_url("https://accounts.feishu.cn/elsewhere"));
        assert!(!super::valid_auth_url("file:///tmp/test"));
    }
    #[test]
    fn credential_namespaces_are_bound_to_application_and_gateway() {
        assert_ne!(super::service("local.mistake.notebook", "https://staging.example.com"), super::service("local.mistake.notebook", "https://api.example.com"));
        assert_ne!(super::service("local.mistake.notebook", "https://api.example.com"), super::service("local.mistake.notebook.localtest", "https://api.example.com"));
    }
}
