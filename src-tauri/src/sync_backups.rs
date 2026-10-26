use std::{fs, path::Path, time::UNIX_EPOCH};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot { pub name: String, pub modified_ms: u64, pub size: u64 }
fn valid_name(name: &str) -> bool {
    name.strip_prefix("before-cloud-").and_then(|name| name.strip_suffix(".json"))
        .is_some_and(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
}
pub fn catalog(directory: &Path) -> Result<Vec<Snapshot>, String> {
    if !directory.exists() { return Ok(vec![]); }
    let mut entries = vec![];
    for entry in fs::read_dir(directory).map_err(|_| "无法读取自动备份目录。")? {
        let entry = entry.map_err(|_| "无法读取自动备份。")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| "无法检查自动备份。")?;
        if !valid_name(&name) || !metadata.is_file() || metadata.len() > 512 * 1024 * 1024 { continue; }
        entries.push(Snapshot { name, modified_ms: metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|duration| duration.as_millis() as u64).unwrap_or(0), size: metadata.len() });
    }
    entries.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.name.cmp(&b.name)));
    Ok(entries)
}
pub fn read(directory: &Path, name: &str) -> Result<String, String> {
    if !valid_name(name) || !catalog(directory)?.iter().any(|snapshot| snapshot.name == name) { return Err("自动备份不存在或位置无效。".into()); }
    let contents = fs::read_to_string(directory.join(name)).map_err(|_| "无法读取这份自动备份。")?;
    super::validate_notebook_json(&contents)?;
    Ok(contents)
}

#[cfg(test)]
mod tests {
    #[test]
    fn selection_is_scoped_and_export_does_not_change_the_snapshot() {
        let directory = std::env::temp_dir().join(format!("ctb-snapshot-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let name = format!("before-cloud-{}.json", "a".repeat(64));
        let source = "{\"version\":1,\"items\":[],\"reviews\":[],\"taxonomy\":{},\"sync\":{\"pending\":\"must-preserve\"}}";
        std::fs::write(directory.join(&name), source).unwrap();
        std::fs::write(directory.join("unrelated.json"), "private").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(directory.join(&name), directory.join(format!("before-cloud-{}.json", "b".repeat(64)))).unwrap();
        assert_eq!(super::catalog(&directory).unwrap().len(), 1);
        assert_eq!(super::read(&directory, &name).unwrap(), source);
        assert!(super::read(&directory, "../notebook.json").is_err());
        assert!(super::read(&directory, "unrelated.json").is_err());
        assert_eq!(std::fs::read_to_string(directory.join(&name)).unwrap(), source);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
