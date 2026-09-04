use std::cell::RefCell;

use tauri::ipc::{InvokeBody, InvokeError, InvokeResponse, InvokeResponseBody};

use super::*;

#[test]
fn request_parser_preserves_camel_case_defaults_and_unknown_fields() {
    let request = parse_invoke_request(&serde_json::json!({
        "requestId": "request-1",
        "command": "settings_get",
        "unknown": true,
    }))
    .expect("invoke_request 파싱 실패");
    assert_eq!(request.request_id, "request-1");
    assert_eq!(request.command, "settings_get");
    assert_eq!(request.args, Value::Null);

    let error = parse_invoke_request(&serde_json::json!({
        "request_id": "request-1",
        "command": "settings_get",
    }))
    .expect_err("snake_case request_id가 허용되면 안 됨");
    assert_eq!(error.to_string(), "missing field `requestId`");
}

#[test]
fn webview_selection_prefers_overlay_and_lazily_falls_back_to_main() {
    let calls = RefCell::new(Vec::new());
    let selected = select_overlay_or_main(
        || {
            calls.borrow_mut().push("overlay");
            Some("overlay-window")
        },
        || {
            calls.borrow_mut().push("main");
            Some("main-window")
        },
    );
    assert_eq!(selected, Some("overlay-window"));
    assert_eq!(calls.into_inner(), vec!["overlay"]);

    let calls = RefCell::new(Vec::new());
    let selected = select_overlay_or_main(
        || {
            calls.borrow_mut().push("overlay");
            None
        },
        || {
            calls.borrow_mut().push("main");
            Some("main-window")
        },
    );
    assert_eq!(selected, Some("main-window"));
    assert_eq!(calls.into_inner(), vec!["overlay", "main"]);

    assert_eq!(select_overlay_or_main(|| None::<&str>, || None), None);
    assert_eq!(NO_WEBVIEW_AVAILABLE, "No webview window available");
}

#[test]
fn invoke_request_projection_preserves_platform_and_tauri_fields() {
    let args = serde_json::json!({ "mode": "default", "value": 3 });
    let local_url = local_invoke_url();
    let request = build_invoke_request(
        "settings_get".to_string(),
        args.clone(),
        local_url,
        "invoke-key".to_string(),
    );

    assert_eq!(request.cmd, "settings_get");
    assert_eq!(request.callback.0, 0);
    assert_eq!(request.error.0, 1);
    if cfg!(windows) || cfg!(target_os = "android") {
        assert_eq!(request.url.as_str(), "http://tauri.localhost/");
    } else {
        assert_eq!(request.url.as_str(), "tauri://localhost");
    }
    match request.body {
        InvokeBody::Json(body) => assert_eq!(body, args),
        InvokeBody::Raw(_) => panic!("invoke body는 JSON이어야 함"),
    }
    assert!(request.headers.is_empty());
    assert_eq!(request.invoke_key, "invoke-key");
}

#[test]
fn invoke_response_projection_preserves_json_raw_error_and_null_fallback() {
    assert_eq!(
        project_invoke_response(InvokeResponse::Ok(InvokeResponseBody::Json(
            r#"{"ok":true,"value":3}"#.to_string(),
        ))),
        Ok(serde_json::json!({ "ok": true, "value": 3 }))
    );
    assert_eq!(
        project_invoke_response(InvokeResponse::Ok(InvokeResponseBody::Json(
            "not-json".to_string(),
        ))),
        Ok(Value::Null)
    );
    assert_eq!(
        project_invoke_response(InvokeResponse::Ok(InvokeResponseBody::Raw(vec![
            0, 1, 2, 253, 254, 255,
        ]))),
        Ok(Value::String("AAEC/f7/".to_string()))
    );
    assert_eq!(
        project_invoke_response(InvokeResponse::Err(InvokeError(serde_json::json!({
            "code": "FAILED",
            "retryable": false,
        })))),
        Err(serde_json::json!({
            "code": "FAILED",
            "retryable": false,
        }))
    );
}

#[test]
fn rpc_sender_preserves_fifo_and_ignores_closed_receiver() {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    send_rpc_response(&tx, "first".to_string(), Ok(serde_json::json!(1)));
    send_rpc_response(&tx, "second".to_string(), Err(serde_json::json!("failed")));
    assert_eq!(
        rx.try_recv().expect("첫 RPC 응답 누락"),
        ("first".to_string(), Ok(serde_json::json!(1)))
    );
    assert_eq!(
        rx.try_recv().expect("두 번째 RPC 응답 누락"),
        ("second".to_string(), Err(serde_json::json!("failed")))
    );

    drop(rx);
    send_rpc_response(&tx, "closed".to_string(), Ok(Value::Null));
}
