pub fn validated_gateway(value: &str, development: bool) -> Result<String, String> {
    let trimmed = value.trim_end_matches('/');
    let (authority, secure) = if let Some(host) = trimmed.strip_prefix("https://") { (host, true) }
        else if let Some(host) = trimmed.strip_prefix("http://") { (host, false) }
        else { return Err("云同步服务尚未安全配置，请联系部署人员。".into()); };
    if authority.is_empty() || authority.bytes().any(|c| !c.is_ascii_alphanumeric() && !b".-:".contains(&c)) { return Err("同步服务地址无效。".into()); }
    let mut parts = authority.split(':');
    let host = parts.next().unwrap_or("");
    if let Some(port) = parts.next() { if port.parse::<u16>().ok().filter(|p| *p > 0).is_none() { return Err("同步服务端口无效。".into()); } }
    if parts.next().is_some() || host.starts_with('.') || host.ends_with('.') || host.split('.').any(|p| p.is_empty() || p.starts_with('-') || p.ends_with('-')) { return Err("同步服务地址无效。".into()); }
    if !secure && !(development && ["localhost", "127.0.0.1"].contains(&host)) { return Err("云同步必须通过 HTTPS 连接。".into()); }
    Ok(trimmed.into())
}
pub fn valid_path(method: &str, path: &str) -> bool {
    ["GET", "POST", "PATCH", "DELETE"].contains(&method) && path.starts_with("/v1/") && path.len() <= 2048 && !path.contains("..")
        && path.bytes().all(|c| c.is_ascii_alphanumeric() || b"/-_.?=&".contains(&c))
}
pub fn valid_auth_url(value: &str) -> bool {
    value.strip_prefix("https://accounts.feishu.cn/open-apis/authen/v1/authorize?")
        .is_some_and(|query| !query.is_empty() && !query.bytes().any(|c| c.is_ascii_control() || c.is_ascii_whitespace()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn cloud_transport_policy_is_not_an_arbitrary_url_or_command_launcher() {
        assert!(super::validated_gateway("https://api.example.com", false).is_ok());
        for value in ["http://example.com", "https://a@b.test", "https://b.test/path", "https://b.test?x", "https://b.test/#x", "https://b.test:bad", "https://b.test:99999"] { assert!(super::validated_gateway(value, false).is_err(), "{value}"); }
        assert!(super::validated_gateway("http://127.0.0.1:8787", true).is_ok());
        for path in ["//evil.test/v1/me", "/v1/../etc", "/v1/%2e%2e/etc", "/v1/abc#evil", "/v1/a\\b"] { assert!(!super::valid_path("GET", path)); }
        assert!(super::valid_path("GET", "/v1/sync/changes?epoch=a&cursor=20"));
        assert!(!super::valid_path("PUT", "/v1/me"));
        assert!(super::valid_auth_url("https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=x"));
        assert!(!super::valid_auth_url("https://accounts.feishu.cn.evil.test/open-apis/authen/v1/authorize"));
    }
}
