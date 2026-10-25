use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Clone, Deserialize, Serialize)]
pub struct Settings {
    pub enabled: bool,
    pub model: String,
}
impl Default for Settings {
    fn default() -> Self { Self { enabled: false, model: "deepseek-flash".into() } }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings { pub enabled: bool, pub model: String, pub has_key: bool }

#[cfg(not(target_os = "android"))]
fn entry(app: &tauri::AppHandle) -> Result<keyring::Entry, String> {
    keyring::Entry::new(&credential_service(&app.config().identifier), "api-key").map_err(|_| "无法访问系统凭据库，请解锁系统后重试。".into())
}
pub(crate) fn credential_service(identifier: &str) -> String {
    // Preserve existing customers' credentials, isolate other application flavors.
    if identifier == "local.mistake.notebook" { "com.mistake-notebook.deepseek".into() }
    else { format!("{identifier}.deepseek") }
}

#[cfg(test)]
mod isolation_tests {
    #[test]
    fn local_test_credentials_do_not_share_the_production_keyring_entry() {
        assert_eq!(super::credential_service("local.mistake.notebook"), "com.mistake-notebook.deepseek");
        assert_eq!(super::credential_service("local.mistake.notebook.localtest"), "local.mistake.notebook.localtest.deepseek");
        assert_ne!(super::credential_service("local.mistake.notebook"), super::credential_service("local.mistake.notebook.localtest"));
    }
}
pub fn read_key(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    { return super::android::secure_read(app, "deepseek.api-key"); }
    #[cfg(not(target_os = "android"))]
    match entry(app)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("无法读取系统凭据库，请解锁系统后重试。".into()),
    }
}
fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|_| "无法定位应用设置目录".to_string())?;
    std::fs::create_dir_all(&directory).map_err(|_| "无法创建应用设置目录".to_string())?;
    Ok(directory.join("ai-settings.json"))
}
pub fn read_settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let target = path(app)?;
    if !target.exists() { return Ok(Settings::default()); }
    serde_json::from_str(&std::fs::read_to_string(target).map_err(|_| "无法读取 AI 设置".to_string())?).map_err(|_| "AI 设置损坏，请重新保存配置。".into())
}
pub fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.len() <= 100 && model.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_ .".contains(&c) && c != b' ')
}
#[tauri::command]
pub async fn get_ai_settings(app: tauri::AppHandle) -> Result<PublicSettings, String> {
    let s = read_settings(&app)?;
    Ok(PublicSettings { enabled: s.enabled, model: s.model, has_key: read_key(&app)?.is_some() })
}
#[tauri::command]
pub async fn save_ai_settings(app: tauri::AppHandle, enabled: bool, model: String, api_key: Option<String>) -> Result<PublicSettings, String> {
    if !valid_model(&model) { return Err("请输入有效的模型名称".into()); }
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        if key.len() > 1024 || key.contains(['\r', '\n']) { return Err("API 密钥格式不正确".into()); }
        #[cfg(target_os = "android")]
        super::android::secure_write(&app, "deepseek.api-key", Some(key.trim()))?;
        #[cfg(not(target_os = "android"))]
        entry(&app)?.set_password(key.trim()).map_err(|_| "密钥未保存：系统凭据库拒绝写入，请解锁系统后重试。".to_string())?;
    }
    let has_key = read_key(&app)?.is_some();
    if enabled && !has_key { return Err("请先填写 API 密钥".into()); }
    super::write_atomic(&path(&app)?, &serde_json::to_string(&Settings { enabled, model: model.clone() }).map_err(|_| "无法保存设置".to_string())?)?;
    Ok(PublicSettings { enabled, model, has_key })
}
#[tauri::command]
pub async fn delete_ai_key(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    super::android::secure_write(&app, "deepseek.api-key", None)?;
    #[cfg(not(target_os = "android"))]
    match entry(&app)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {},
        Err(_) => return Err("无法删除系统凭据，请解锁系统后重试。".into()),
    }
    let s = read_settings(&app)?;
    super::write_atomic(&path(&app)?, &serde_json::to_string(&Settings { enabled: false, ..s }).unwrap())
}
