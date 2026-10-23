use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock}};
use tauri::Manager;

pub(crate) const SIGNING_DOMAIN: &[u8] = b"mistake-notebook-license-v1\0";
pub(crate) const MAX_LICENSE_BYTES: usize = 32 * 1024;
const PRODUCT: &str = "mistake-notebook";
static IMPORT_LOCK: Mutex<()> = Mutex::new(());
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Envelope { version: u8, payload: String, signature: String }

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Claims {
    schema: u8,
    product: String,
    pub(crate) license_id: String,
    pub(crate) purchase_code: String,
    pub(crate) device_id: String,
    issued_at: String,
    pub(crate) kind: String,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    state: &'static str,
    pub(crate) can_write: bool,
    machine_code: Option<String>,
    platform: &'static str,
    purchase_code: Option<String>,
    license_id: Option<String>,
    message: String,
}

pub(crate) fn hex(bytes: &[u8]) -> String { bytes.iter().map(|byte| format!("{byte:02x}")).collect() }
pub(crate) fn key_id(key: &[u8; 32]) -> String { hex(&Sha256::digest(key))[..16].to_owned() }
pub(crate) fn configured_key(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64 || !value.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("发行公钥未配置或格式错误".into()); }
    let mut bytes = [0u8; 32];
    for (index, target) in bytes.iter_mut().enumerate() { *target = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).map_err(|_| "发行公钥错误")?; }
    let key = VerifyingKey::from_bytes(&bytes).map_err(|_| "发行公钥不可用")?;
    if key.is_weak() || bytes == [0u8; 32] { return Err("发行公钥不可用".into()); }
    Ok(bytes)
}
fn valid_device(value: &str) -> bool { value.len() == 64 && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) && value.bytes().any(|c| c != b'0') }
fn valid_purchase(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    parts.len() == 9 && parts[0] == "CTB" && parts[1..].iter().all(|part| part.len() == 4 && part.bytes().all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c)))
}
fn valid_uuid(value: &str) -> bool {
    value.len() == 36 && value.bytes().enumerate().all(|(i,c)| if [8,13,18,23].contains(&i) { c == b'-' } else { c.is_ascii_hexdigit() }) && value.bytes().any(|c| c != b'0' && c != b'-')
}
fn valid_issued_at(value: &str) -> bool {
    if value.len() != 24 || !value.bytes().enumerate().all(|(i,c)| match i { 4|7 => c == b'-', 10 => c == b'T', 13|16 => c == b':', 19 => c == b'.', 23 => c == b'Z', _ => c.is_ascii_digit() }) { return false; }
    let number = |range: std::ops::Range<usize>| value[range].parse::<u32>().unwrap_or(u32::MAX);
    (1..=12).contains(&number(5..7)) && (1..=31).contains(&number(8..10)) && number(11..13) < 24 && number(14..16) < 60 && number(17..19) < 60
}
fn decode(value: &str) -> Result<Vec<u8>, String> {
    let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| "授权文件编码不正确")?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value { return Err("授权文件编码不正确".into()); }
    Ok(bytes)
}
pub(crate) fn verify_license(contents: &str, public_key: &[u8; 32], device_id: &str) -> Result<Claims, String> {
    if contents.len() > MAX_LICENSE_BYTES { return Err("授权文件超过 32 KB，请选择卖家提供的授权文件".into()); }
    let envelope: Envelope = serde_json::from_str(contents).map_err(|_| "无法读取授权文件，格式不正确或已损坏")?;
    if envelope.version != 1 { return Err("授权文件版本不支持".into()); }
    let payload = decode(&envelope.payload)?;
    let signature = Signature::from_slice(&decode(&envelope.signature)?).map_err(|_| "授权签名长度不正确")?;
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| "发行公钥不可用")?;
    if key.is_weak() { return Err("发行公钥不可用".into()); }
    key.verify_strict(&[SIGNING_DOMAIN, payload.as_slice()].concat(), &signature).map_err(|_| "授权签名校验失败。文件可能被修改，或不是本发行版的授权。")?;
    let claims: Claims = serde_json::from_slice(&payload).map_err(|_| "授权内容格式不正确")?;
    if claims.schema != 1 || claims.product != PRODUCT || claims.kind != "perpetual" || claims.key_id != key_id(public_key) || !valid_device(&claims.device_id) || !valid_uuid(&claims.license_id) || !valid_purchase(&claims.purchase_code) || !valid_issued_at(&claims.issued_at) {
        return Err("授权内容与当前产品或发行公钥不匹配".into());
    }
    if claims.device_id != device_id { return Err("这份授权绑定了另一台设备，请把当前机器码发给卖家重新签发。".into()); }
    Ok(claims)
}
pub(crate) fn fingerprint(platform: &str, raw: &str) -> Result<String, String> {
    let normalized = raw.trim().replace('-', "").to_lowercase();
    if !["macos", "windows", "linux"].contains(&platform) || normalized.len() != 32 || !normalized.bytes().all(|c| c.is_ascii_hexdigit()) || normalized.bytes().all(|c| c == b'0') {
        return Err("无法读取本机稳定标识。请检查系统权限后重试，已有错题仍可查看和导出。".into());
    }
    Ok(hex(&Sha256::digest([b"mistake-notebook/device/v1\0".as_slice(), platform.as_bytes(), b"\0", normalized.as_bytes()].concat())))
}
pub(crate) fn machine_code(device: &str) -> String {
    format!("CTB1-{}", device.as_bytes().chunks(8).map(|part| String::from_utf8_lossy(part).to_uppercase()).collect::<Vec<_>>().join("-"))
}
fn read_machine_identity() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let raw = {
        let output = std::process::Command::new("/usr/sbin/ioreg").args(["-rd1", "-c", "IOPlatformExpertDevice"]).output().map_err(|_| "无法读取本机稳定标识")?;
        if !output.status.success() { return Err("无法读取本机稳定标识".into()); }
        String::from_utf8_lossy(&output.stdout).lines().find(|line| line.contains("\"IOPlatformUUID\""))
            .and_then(|line| line.split_once('=').map(|(_, value)| value.trim().trim_matches('"').to_owned())).ok_or("无法读取本机稳定标识")?
    };
    #[cfg(target_os = "windows")]
    let raw: String = {
        use winreg::{enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY}, RegKey};
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags("SOFTWARE\\Microsoft\\Cryptography", KEY_READ | KEY_WOW64_64KEY)
            .and_then(|key| key.get_value("MachineGuid")).map_err(|_| "无法读取本机稳定标识，请检查系统权限")?
    };
    #[cfg(target_os = "linux")]
    let raw = fs::read_to_string("/etc/machine-id").or_else(|_| fs::read_to_string("/var/lib/dbus/machine-id")).map_err(|_| "无法读取本机稳定标识")?;
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("当前平台不支持设备授权".into());
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    fingerprint(std::env::consts::OS, &raw)
}
pub(crate) fn cached_identity(cache: &OnceLock<String>, read: impl FnOnce() -> Result<String, String>) -> Result<String, String> {
    if let Some(value) = cache.get() { return Ok(value.clone()); }
    let value = read()?;
    let _ = cache.set(value);
    Ok(cache.get().expect("identity was initialized").clone())
}
fn identity() -> Result<String, String> {
    static IDENTITY: OnceLock<String> = OnceLock::new();
    cached_identity(&IDENTITY, read_machine_identity)
}
pub(crate) fn activation_request() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "version": 1, "product": PRODUCT, "machineCode": machine_code(&identity()?), "platform": std::env::consts::OS }))
}
fn license_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|path| path.join("activation.license.json")).map_err(|_| "无法定位授权保存目录".into())
}
fn read_certificate(path: &Path) -> Result<String, String> {
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|_| "无法读取本机授权文件")?.take((MAX_LICENSE_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|_| "无法读取本机授权文件")?;
    if bytes.len() > MAX_LICENSE_BYTES { return Err("本机授权文件过大或已损坏".into()); }
    String::from_utf8(bytes).map_err(|_| "本机授权文件编码损坏".into())
}
pub(crate) fn import_verified(path: &Path, contents: &str, public_key: &[u8; 32], device: &str) -> Result<Claims, String> {
    let claims = verify_license(contents, public_key, device)?;
    let _lock = IMPORT_LOCK.lock().map_err(|_| "授权写入暂时不可用，请重启应用")?;
    let parent = path.parent().ok_or("授权保存目录不正确")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建授权保存目录，请检查权限")?;
    let temporary = path.with_extension(format!("pending-{}-{}", std::process::id(), TEMP_ID.fetch_add(1, Ordering::Relaxed)));
    let write = || -> Result<(), String> {
        let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temporary).map_err(|_| "无法写入授权，请检查磁盘空间与目录权限")?;
        file.write_all(contents.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "保存授权失败，原有授权未被主动删除，请检查磁盘空间")?;
        drop(file);
        fs::rename(&temporary, path).map_err(|_| "替换授权文件失败，原有授权仍保留，请关闭占用文件的程序后重试")?;
        Ok(())
    };
    let result = write();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result?;
    Ok(claims)
}
pub(crate) fn enforce_write(can_write: bool) -> Result<(), String> {
    if can_write { Ok(()) } else { Err("当前未激活，不能新增或修改错题。已有资料仍可查看和导出，请先导入本机授权。".into()) }
}
#[tauri::command]
pub fn get_license_status(app: tauri::AppHandle) -> LicenseStatus { status(&app) }
fn status(app: &tauri::AppHandle) -> LicenseStatus {
    let device = identity();
    let mut status = LicenseStatus { state: "unactivated", can_write: false, machine_code: device.as_ref().ok().map(|device| machine_code(device)), platform: std::env::consts::OS, purchase_code: None, license_id: None, message: "尚未激活。请把机器码发给卖家，获取本机永久离线授权。".into() };
    let configured = env!("NOTEBOOK_LICENSE_PUBLIC_KEY");
    if configured.is_empty() && cfg!(debug_assertions) {
        status.state = "development"; status.can_write = true; status.message = "开发模式：未配置发行公钥，不代表正式激活。".into(); return status;
    }
    let key = match configured_key(configured) { Ok(key) => key, Err(message) => { status.state = "misconfigured"; status.message = message; return status } };
    let device = match device { Ok(device) => device, Err(message) => { status.state = "unavailable"; status.message = message; return status } };
    let path = match license_path(app) { Ok(path) => path, Err(message) => { status.state = "unavailable"; status.message = message; return status } };
    if !path.exists() { return status; }
    match read_certificate(&path).and_then(|contents| verify_license(&contents, &key, &device)) {
        Ok(claims) => { status.state = "active"; status.can_write = true; status.purchase_code = Some(claims.purchase_code); status.license_id = Some(claims.license_id); status.message = "本机已获得永久离线授权，无需联网续期。".into(); }
        Err(message) => { status.state = "invalid"; status.message = message; }
    }
    status
}
pub(crate) fn require_write(app: &tauri::AppHandle) -> Result<(), String> { enforce_write(status(app).can_write) }
#[tauri::command]
pub fn import_license(app: tauri::AppHandle, contents: String) -> Result<LicenseStatus, String> {
    let key = configured_key(env!("NOTEBOOK_LICENSE_PUBLIC_KEY"))?;
    let device = identity()?;
    import_verified(&license_path(&app)?, &contents, &key, &device)?;
    Ok(status(&app))
}

#[cfg(all(test, target_os = "macos"))]
mod host_probe_tests {
    #[test]
    fn macos_hardware_probe_returns_only_a_hashed_device_identifier() {
        let device = super::read_machine_identity().expect("macOS stable identity should be readable");
        assert!(super::valid_device(&device));
        assert!(super::machine_code(&device).starts_with("CTB1-"));
    }
}
