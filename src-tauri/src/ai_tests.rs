use super::*;
#[test]
fn cancellation_before_preparation_prevents_registration() {
    let requests = ai::Requests::default();
    ai::cancel_request(&requests, "early".into());
    assert!(ai::begin_request(&requests, "early").is_err());
    let token = ai::begin_request(&requests, "active").unwrap();
    ai::cancel_request(&requests, "active".into());
    assert!(token.is_cancelled());
}

#[test]
fn validates_images_models_and_request_body() {
    let image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=".to_string();
    let body = build_body("deepseek-flash", "choice", &[image.clone()], "OCR", "prompt").unwrap();
    assert_eq!(body["messages"][1]["content"][1]["image_url"]["url"], image);
    assert_eq!(body["response_format"]["type"], "json_object");
    assert_eq!(body["thinking"]["type"], "disabled");
    assert!(build_body("", "choice", &[image.clone()], "", "").is_err());
    assert!(build_body("deepseek-flash", "choice", &vec![image.clone();9], "", "").is_err());
    assert!(build_body("deepseek-flash", "choice", &["file:///secret".into()], "", "").is_err());
    assert!(build_body("deepseek-flash", "choice", &[], "", "").is_err());
}

#[test]
fn handles_failed_truncated_and_oversized_responses() {
    for input in ["", "<html>error</html>", r#"{"choices":[]}"#,
        r#"{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}"#,
        r#"{"choices":[{"finish_reason":"stop","message":{"content":""}}]}"#] {
        assert!(parse_response(input).is_err());
    }
    assert!(parse_response(&"x".repeat(1024*1024+1)).is_err());
    assert_eq!(parse_response(r#"{"choices":[{"finish_reason":"stop","message":{"content":"{\"question\":\"q\"}"}}]}"#).unwrap(), "{\"question\":\"q\"}");
    assert!(status_error(401).contains("密钥"));
    assert!(status_error(402).contains("余额"));
    assert!(status_error(429).contains("频繁"));
    assert!(!status_error(500).contains("Bearer"));
}
