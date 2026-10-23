use super::license::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::json;
use std::{fs, sync::atomic::{AtomicUsize, Ordering}};

fn signer() -> SigningKey { SigningKey::from_bytes(&[71u8; 32]) } // Synthetic test-only signing material.
fn device() -> String { "1".repeat(64) }
fn signed(mutator: impl FnOnce(&mut serde_json::Value)) -> String {
    let signing = signer();
    let mut claims = json!({"schema":1,"product":"mistake-notebook","licenseId":"12345678-1234-4234-9234-123456789abc","purchaseCode":"CTB-ABCD-1234-ABCD-1234-ABCD-1234-ABCD-1234","deviceId":device(),"issuedAt":"2026-10-24T00:00:00.000Z","kind":"perpetual","keyId":key_id(&signing.verifying_key().to_bytes())});
    mutator(&mut claims);
    let payload = serde_json::to_vec(&claims).unwrap();
    let bytes = [SIGNING_DOMAIN, payload.as_slice()].concat();
    serde_json::to_string(&json!({"version":1,"payload":URL_SAFE_NO_PAD.encode(&payload),"signature":URL_SAFE_NO_PAD.encode(signing.sign(&bytes).to_bytes())})).unwrap()
}

#[test]
fn signed_permanent_certificate_is_bound_to_product_device_and_key() {
    let key = signer().verifying_key().to_bytes();
    let claims = verify_license(&signed(|_| {}), &key, &device()).unwrap();
    assert_eq!(claims.kind, "perpetual"); assert_eq!(claims.device_id, device());
    assert!(verify_license(&signed(|_| {}), &key, &"2".repeat(64)).is_err());
    assert!(verify_license(&signed(|_| {}), &SigningKey::from_bytes(&[72u8;32]).verifying_key().to_bytes(), &device()).is_err());
    for (field, value) in [("product", "another-product"), ("kind", "subscription"), ("deviceId", "invalid"), ("keyId", "0000000000000000"), ("issuedAt", "not-a-date"), ("purchaseCode", ""), ("licenseId", "invalid")] {
        assert!(verify_license(&signed(|claims| claims[field] = json!(value)), &key, &device()).is_err(), "accepted {field}");
    }
}

#[test]
fn rejects_tampering_unknown_fields_and_oversized_input() {
    let key = signer().verifying_key().to_bytes();
    let original = signed(|_| {});
    let mut envelope: serde_json::Value = serde_json::from_str(&original).unwrap();
    envelope["signature"] = json!(URL_SAFE_NO_PAD.encode([0u8;64]));
    assert!(verify_license(&envelope.to_string(), &key, &device()).is_err());
    let mut envelope: serde_json::Value = serde_json::from_str(&original).unwrap();
    envelope["payload"] = json!(URL_SAFE_NO_PAD.encode(b"{}"));
    assert!(verify_license(&envelope.to_string(), &key, &device()).is_err());
    let mut envelope: serde_json::Value = serde_json::from_str(&original).unwrap();
    envelope["unlocked"] = json!(true);
    assert!(verify_license(&envelope.to_string(), &key, &device()).is_err());
    assert!(verify_license(&signed(|claims| claims["expiresAt"] = json!("2099-01-01")), &key, &device()).is_err());
    assert!(verify_license(&"x".repeat(MAX_LICENSE_BYTES + 1), &key, &device()).is_err());
    assert!(verify_license("not json", &key, &device()).is_err());
}

#[test]
fn missing_or_invalid_license_cannot_authorize_native_writes() {
    assert!(enforce_write(false).is_err());
    assert!(enforce_write(true).is_ok());
    assert!(configured_key("not-a-key").is_err());
    assert!(configured_key(&"00".repeat(32)).is_err());
    assert_eq!(configured_key(&hex(&signer().verifying_key().to_bytes())).unwrap(), signer().verifying_key().to_bytes());
}

#[test]
fn fingerprint_is_stable_platform_scoped_and_never_uses_empty_identity() {
    let raw = "12345678-1234-1234-1234-123456789abc";
    let a = fingerprint("macos", raw).unwrap();
    assert_eq!(a, fingerprint("macos", &raw.to_uppercase()).unwrap());
    assert_ne!(a, fingerprint("windows", raw).unwrap());
    assert!(!machine_code(&a).contains(raw));
    assert!(fingerprint("macos", "").is_err());
    assert!(fingerprint("windows", "00000000-0000-0000-0000-000000000000").is_err());
}

#[test]
fn temporary_identity_failures_can_be_retried_and_success_is_cached() {
    let cache = std::sync::OnceLock::new();
    assert!(cached_identity(&cache, || Err("temporary permission failure".into())).is_err());
    assert_eq!(cached_identity(&cache, || Ok(device())).unwrap(), device());
    assert_eq!(cached_identity(&cache, || panic!("successful identity should be reused")).unwrap(), device());
}

#[test]
fn invalid_import_keeps_previous_certificate_and_valid_reimport_is_atomic() {
    static N: AtomicUsize = AtomicUsize::new(0);
    let directory = std::env::temp_dir().join(format!("ctb-license-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("activation.license.json");
    let key = signer().verifying_key().to_bytes();
    let contents = signed(|_| {});
    import_verified(&path, &contents, &key, &device()).unwrap();
    let before = fs::read_to_string(&path).unwrap();
    assert!(import_verified(&path, "corrupt", &key, &device()).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), before);
    import_verified(&path, &contents, &key, &device()).unwrap();
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn node_issuer_interoperability_fixture_when_requested() {
    let Some(path) = std::env::var_os("CTB_INTEROP_FIXTURE") else { return };
    let fixture: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let key = configured_key(fixture["publicKeyHex"].as_str().unwrap()).unwrap();
    let claims = verify_license(&fixture["certificate"].to_string(), &key, fixture["deviceId"].as_str().unwrap()).unwrap();
    assert_eq!(claims.purchase_code, fixture["purchaseCode"].as_str().unwrap());
}
