use serde_json::Value;
use std::{fs, io::Write, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn prepare_backup(contents: &str) -> Result<String, String> {
    if contents.len() > 512 * 1024 * 1024 { return Err("备份超过 512 MB，无法安全导出".into()); }
    crate::validate_notebook_json(contents)?;
    let source: Value = serde_json::from_str(contents).map_err(|_| "备份格式不正确")?;
    let mut output = serde_json::Map::new();
    for key in ["version", "workspaceName", "items", "reviews", "taxonomy", "reviewSettings", "workspaceUpdatedAt"] {
        if let Some(value) = source.get(key) { output.insert(key.to_owned(), value.clone()); }
    }
    serde_json::to_string_pretty(&output).map_err(|_| "无法生成备份".into())
}
fn resolved(path: &Path) -> Result<PathBuf, String> {
    if path.exists() { return path.canonicalize().map_err(|_| "无法访问保存位置".into()); }
    let parent = path.parent().filter(|parent| *parent != path).ok_or("保存位置不正确")?;
    Ok(resolved(parent)?.join(path.file_name().ok_or("保存文件名不正确")?))
}
fn validate_destination(path: &Path, internal: &Path) -> Result<(), String> {
    if !path.is_absolute() || !path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("json")) {
        return Err("请选择以 .json 结尾的保存文件名".into());
    }
    if resolved(path)?.starts_with(resolved(internal)?) { return Err("请保存到文稿或桌面等文件夹，不要覆盖应用内部文件".into()); }
    Ok(())
}
fn write_export(path: &Path, contents: &str) -> Result<(), String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let temporary = path.with_extension(format!("json.{}.{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "无法创建导出文件，请检查文件夹权限")?;
        file.write_all(contents.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "导出写入失败，请检查磁盘空间")?;
        drop(file);
        fs::rename(&temporary, path).map_err(|_| "无法替换导出文件，请检查文件是否被占用")?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}
fn save(app: &tauri::AppHandle, contents: &str, name: &str) -> Result<Option<String>, String> {
    let Some(selected) = app.dialog().file().set_file_name(name).add_filter("JSON 文件", &["json"]).blocking_save_file() else { return Ok(None); };
    let path = selected.into_path().map_err(|_| "请选择本机文件夹")?;
    let internal = app.path().app_data_dir().map_err(|_| "无法定位应用目录")?;
    validate_destination(&path, &internal)?;
    write_export(&path, contents)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
// Deliberately available before activation: these commands only write user-chosen exports.
// Async commands execute off the main thread, as required by blocking_save_file.
#[tauri::command]
pub async fn export_license_request(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let contents = serde_json::to_string_pretty(&crate::license::activation_request()?).map_err(|_| "无法生成激活申请")?;
    save(&app, &contents, "错题本激活申请.ctb-request.json")
}
#[tauri::command]
pub async fn export_notebook_backup(app: tauri::AppHandle, contents: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    { return crate::android::export_json(&app, &prepare_backup(&contents)?, "错题本完整备份.json").await; }
    #[cfg(not(target_os = "android"))]
    save(&app, &prepare_backup(&contents)?, "错题本完整备份.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn export_contains_notebook_data_without_license_or_internal_paths() {
        let source = json!({"version":1,"workspaceName":"test","items":[{"question":"original"}],"reviews":[],"taxonomy":{"exams":[]},"reviewSettings":{"mode":"adaptive"},"workspacePath":"/private/path","license":"do-not-export"});
        let value: serde_json::Value = serde_json::from_str(&prepare_backup(&source.to_string()).unwrap()).unwrap();
        assert_eq!(value["items"][0]["question"], "original");
        assert!(value.get("workspacePath").is_none());
        assert!(value.get("license").is_none());
        assert!(prepare_backup("{}").is_err());
    }
    #[test]
    fn export_does_not_overwrite_internal_app_files_or_non_json_files() {
        let directory = std::env::temp_dir().join(format!("ctb-export-{}", std::process::id()));
        let internal = directory.join("app-data");
        std::fs::create_dir_all(&internal).unwrap();
        assert!(validate_destination(&internal.join("notebook.json"), &internal).is_err());
        assert!(validate_destination(&directory.join("script.exe"), &internal).is_err());
        let destination = directory.join("backup.json");
        validate_destination(&destination, &internal).unwrap();
        write_export(&destination, "original").unwrap();
        write_export(&destination, "replacement").unwrap();
        assert_eq!(std::fs::read_to_string(destination).unwrap(), "replacement");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
