fn main() {
    println!("cargo:rerun-if-env-changed=NOTEBOOK_LICENSE_PUBLIC_KEY");
    println!("cargo:rerun-if-changed=license-public-key.json");
    let configuration: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string("license-public-key.json").expect("发行公钥配置文件不存在")
    ).expect("发行公钥配置文件不是有效 JSON");
    assert!(configuration["version"] == 1 && configuration["algorithm"] == "Ed25519" && configuration["product"] == "mistake-notebook", "发行公钥配置格式不正确");
    let key = std::env::var("NOTEBOOK_LICENSE_PUBLIC_KEY").ok().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| configuration["publicKeyHex"].as_str().unwrap_or("").to_owned()).trim().to_lowercase();
    if key.is_empty() {
        assert!(std::env::var("PROFILE").as_deref() != Ok("release"), "正式发行必须先配置 Ed25519 公钥。请用卖家工具导出 license-public-key.json；绝不能把私钥放进项目或 CI。");
    } else {
        assert!(key.len() == 64 && key.bytes().all(|c| c.is_ascii_hexdigit()), "发行公钥必须是 64 位十六进制");
        let bytes: Vec<u8> = (0..64).step_by(2).map(|i| u8::from_str_radix(&key[i..i + 2], 16).unwrap()).collect();
        let bytes: [u8; 32] = bytes.try_into().unwrap();
        let public = ed25519_dalek::VerifyingKey::from_bytes(&bytes).expect("发行公钥不是有效 Ed25519 公钥");
        assert!(!public.is_weak() && bytes != [0u8; 32], "不得使用零值或弱公钥发行");
        // Never trust the RFC vector or this repository's deterministic fixture signers.
        let test_keys = [
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
            "e28a8970753332bd72fef413e6b0b2ef1b4aadda7aa2c141f233712a6876b351",
            "d4eec1869fb1b8a4e817516ad5a931557cb56805c3eb16e8f3a803d647df7869",
        ];
        assert!(!test_keys.contains(&key.as_str()), "不得使用公开的测试公钥发行");
    }
    println!("cargo:rustc-env=NOTEBOOK_LICENSE_PUBLIC_KEY={key}");
    tauri_build::build()
}
