//! Only the isolated Android debug application is supported in this test phase.
//! No desktop license bypass and no commercial Android release is provided here.
#[cfg(all(target_os = "android", not(debug_assertions)))]
compile_error!("Android commercial release is not enabled. Build the isolated debug test APK only.");

#[cfg(target_os = "android")]
use tauri::{Manager, plugin::{PluginHandle, TauriPlugin}};

pub const TEST_IDENTIFIER: &str = "local.mistake.notebook.androidtest";
pub fn test_sandbox(platform: &str, debug: bool, identifier: &str) -> bool {
    platform == "android" && debug && identifier == TEST_IDENTIFIER
}
pub fn is_test(app: &tauri::AppHandle) -> bool {
    test_sandbox(std::env::consts::OS, cfg!(debug_assertions), &app.config().identifier)
}

#[cfg(target_os = "android")]
struct Mobile(PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
pub fn init() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("notebook-mobile")
        // Private bridge: raw credentials must never be callable from JavaScript,
        // even if a future capability accidentally grants this plugin a command.
        .invoke_handler(|invoke| { invoke.resolver.reject("Private native bridge"); true })
        .setup(|app, api| {
            let handle = api.register_android_plugin("local.mistake.notebook.mobile", "NotebookMobilePlugin")?;
            app.manage(Mobile(handle));
            Ok(())
        }).build()
}
#[cfg(target_os = "android")]
pub fn secure_read(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    let value: serde_json::Value = app.state::<Mobile>().0.run_mobile_plugin("secureRead", serde_json::json!({"key":key})).map_err(|_| "无法读取 Android 安全存储，请解锁手机后重试；原凭据没有被覆盖。")?;
    Ok(value.get("value").and_then(serde_json::Value::as_str).map(str::to_owned))
}
#[cfg(target_os = "android")]
pub fn secure_write(app: &tauri::AppHandle, key: &str, value: Option<&str>) -> Result<(), String> {
    let _: serde_json::Value = app.state::<Mobile>().0.run_mobile_plugin("secureWrite", serde_json::json!({"key":key,"value":value})).map_err(|_| "Android 安全存储写入失败，没有退回明文保存。")?;
    Ok(())
}
#[cfg(target_os = "android")]
pub async fn open_auth(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let _: serde_json::Value = app.state::<Mobile>().0.run_mobile_plugin_async("openAuthorization", serde_json::json!({"url":url})).await.map_err(|_| "无法打开系统浏览器，请检查手机是否已安装浏览器。")?;
    Ok(())
}
#[cfg(target_os = "android")]
pub async fn export_json(app: &tauri::AppHandle, contents: &str, name: &str) -> Result<Option<String>, String> {
    let value: serde_json::Value = app.state::<Mobile>().0.run_mobile_plugin_async("exportJson", serde_json::json!({"contents":contents,"name":name})).await.map_err(|_| "备份没有导出，请检查保存位置和空间后重试。")?;
    Ok(value.get("path").and_then(serde_json::Value::as_str).map(str::to_owned))
}

#[tauri::command]
pub async fn export_sync_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "android"))]
    { let _ = app; Err("桌面版请打开同步前备份文件夹。".into()) }
    #[cfg(target_os = "android")]
    {
        let directory = app.path().app_data_dir().map_err(|_| "无法定位备份目录。")?.join("sync-backups");
        let snapshots = super::sync_backups::catalog(&directory)?;
        if snapshots.is_empty() { return Err("尚无同步前自动备份。首次连接或切换账号前会自动创建。".into()); }
        let selected: serde_json::Value = app.state::<Mobile>().0.run_mobile_plugin_async("selectSnapshot", serde_json::json!({"snapshots":snapshots})).await.map_err(|_| "没有完成备份选择。")?;
        let Some(name) = selected.get("name").and_then(serde_json::Value::as_str) else { return Ok(None); };
        // Selection is checked again in Rust. Never accept an arbitrary private file path.
        let contents = super::sync_backups::read(&directory, name)?;
        export_json(&app, &contents, "错题本-同步前完整快照.json").await
    }
}

#[tauri::command]
pub async fn pick_android_images(app: tauri::AppHandle, camera: bool) -> Result<super::DroppedImages, String> {
    #[cfg(not(target_os = "android"))]
    { let _ = (app, camera); Err("此入口仅适用于安卓手机。".into()) }
    #[cfg(target_os = "android")]
    {
        super::license::require_write(&app)?;
        let value: serde_json::Value = app.state::<Mobile>().0.run_mobile_plugin_async("pickImages", serde_json::json!({"camera":camera})).await.map_err(|_| "没有完成图片选择，请检查相机权限或重试。")?;
        let root = app.path().app_cache_dir().map_err(|_| "无法访问临时图片目录。")?.join("capture-imports");
        let root = root.canonicalize().unwrap_or(root);
        let paths: Vec<String> = value.get("paths").and_then(serde_json::Value::as_array).into_iter().flatten().filter_map(serde_json::Value::as_str).filter_map(|value| {
            let path = std::path::Path::new(value).canonicalize().ok()?;
            path.starts_with(&root).then(|| path.to_string_lossy().into_owned())
        }).collect();
        let result = super::read_dropped_images_impl(paths.clone());
        for path in paths { let _ = std::fs::remove_file(path); }
        result.map(|mut images| { images.skipped += value.get("skipped").and_then(serde_json::Value::as_u64).unwrap_or(0) as usize; images })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_sandbox_never_unlocks_desktop_or_production() {
        assert!(super::test_sandbox("android", true, super::TEST_IDENTIFIER));
        for (os, debug, id) in [("macos", true, super::TEST_IDENTIFIER), ("windows", true, super::TEST_IDENTIFIER), ("android", false, super::TEST_IDENTIFIER), ("android", true, "local.mistake.notebook")] {
            assert!(!super::test_sandbox(os, debug, id));
        }
    }
}
