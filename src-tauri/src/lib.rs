use std::{fs, io::Write, path::Path, process::Command};

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
        .invoke_handler(tauri::generate_handler![choose_workspace_folder, open_workspace_folder, write_workspace_notebook])
        .run(tauri::generate_context!())
        .expect("error while running mistake notebook");
}
