use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::{fs, io::Write, path::Path, process::Command};

const MAX_DROPPED_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedImage {
    name: String,
    data_url: String,
}

#[derive(Serialize)]
struct DroppedImages {
    images: Vec<DroppedImage>,
    skipped: usize,
}

#[tauri::command]
fn read_dropped_images(paths: Vec<String>) -> Result<DroppedImages, String> {
    if paths.len() > 50 {
        return Err("一次最多拖入 50 个文件".into());
    }
    let mut images = Vec::new();
    let mut skipped = 0;
    for value in paths {
        let path = Path::new(&value);
        let metadata = match fs::metadata(path) {
            Ok(metadata) if metadata.is_file() && metadata.len() <= MAX_DROPPED_IMAGE_BYTES => metadata,
            _ => { skipped += 1; continue; }
        };
        if metadata.len() == 0 { skipped += 1; continue; }
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(_) => { skipped += 1; continue; }
        };
        let mime = match infer::get(&bytes).map(|kind| kind.mime_type()) {
            Some("image/png") => "image/png",
            Some("image/jpeg") => "image/jpeg",
            Some("image/webp") => "image/webp",
            Some("image/gif") => "image/gif",
            Some("image/bmp") | Some("image/x-ms-bmp") => "image/bmp",
            _ => { skipped += 1; continue; }
        };
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("拖入图片").to_string();
        images.push(DroppedImage { name, data_url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)) });
    }
    Ok(DroppedImages { images, skipped })
}

#[tauri::command]
fn choose_workspace_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    let output = Command::new("osascript")
        .args(["-e", "POSIX path of (choose folder with prompt \"选择错题本工作区\")"])
        .output();

    #[cfg(target_os = "windows")]
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='选择错题本工作区'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}"])
        .output();

    #[cfg(target_os = "linux")]
    let output = Command::new("zenity")
        .args(["--file-selection", "--directory", "--title=选择错题本工作区"])
        .output();

    let output = output.map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().trim_end_matches('/').to_string();
    Ok((!path.is_empty()).then_some(path))
}

#[tauri::command]
fn open_workspace_folder(path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err("工作区文件夹不存在".into());
    }

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&path).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(&path).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(&path).status();

    status.map_err(|error| error.to_string()).and_then(|result| {
        if result.success() { Ok(()) } else { Err("系统没有成功打开文件夹".into()) }
    })
}

#[tauri::command]
fn write_workspace_notebook(path: String, contents: String) -> Result<(), String> {
    let directory = Path::new(&path);
    if !directory.is_dir() {
        return Err("工作区文件夹不存在".into());
    }
    let target = directory.join("notebook.json");
    let temporary = directory.join(".notebook.json.tmp");
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    file.write_all(contents.as_bytes()).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    if target.exists() {
        fs::remove_file(&target).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &target).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![choose_workspace_folder, open_workspace_folder, write_workspace_notebook, read_dropped_images])
        .run(tauri::generate_context!())
        .expect("error while running mistake notebook");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropped_images_accept_png_and_skip_other_files() {
        let directory = std::env::temp_dir().join(format!("mistake-notebook-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let png = directory.join("question.png");
        let text = directory.join("notes.txt");
        let bytes = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=").unwrap();
        fs::write(&png, bytes).unwrap();
        fs::write(&text, b"not an image").unwrap();
        let result = read_dropped_images(vec![png.to_string_lossy().into_owned(), text.to_string_lossy().into_owned()]).unwrap();
        assert_eq!(result.images.len(), 1);
        assert_eq!(result.skipped, 1);
        assert!(result.images[0].data_url.starts_with("data:image/png;base64,"));
        let _ = fs::remove_dir_all(directory);
    }
}
