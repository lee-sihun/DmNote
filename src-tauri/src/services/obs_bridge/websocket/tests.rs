use super::*;

fn assert_envelope(envelope: &Value, msg_type: &str, sequence: u64, payload: &Value) {
    assert_eq!(envelope["type"], msg_type);
    assert_eq!(envelope["seq"], sequence);
    assert_eq!(&envelope["payload"], payload);
}

#[test]
fn session_protocol_projects_every_envelope_with_one_monotonic_sequence() {
    let mut protocol = WebSocketSessionProtocol::new();

    let ack = protocol.hello_ack("2.0.1".to_string());
    assert_eq!(ack["type"], "hello_ack");
    assert_eq!(ack["seq"], 0);
    assert_eq!(ack["payload"]["serverVersion"], "2.0.1");
    assert_eq!(ack["payload"]["obsMode"], true);
    assert_eq!(
        ack["payload"]["allowedList"],
        serde_json::to_value(build_allowed_list()).expect("allowlist 직렬화 실패")
    );

    let snapshot_payload = serde_json::json!({ "revision": 1 });
    let snapshot = protocol.snapshot(snapshot_payload.clone());
    assert_envelope(&snapshot, "snapshot", 1, &snapshot_payload);

    let broadcast_snapshot_payload = serde_json::json!({ "revision": 2 });
    let broadcast_snapshot =
        protocol.broadcast(&ObsBroadcast::Snapshot(broadcast_snapshot_payload.clone()));
    assert_envelope(
        &broadcast_snapshot,
        "snapshot",
        2,
        &broadcast_snapshot_payload,
    );

    let event = protocol.broadcast(&ObsBroadcast::TauriEvent {
        event: "settings:changed".to_string(),
        data: serde_json::json!({ "theme": "dark" }),
    });
    assert_envelope(
        &event,
        "tauri_event",
        3,
        &serde_json::json!({
            "event": "settings:changed",
            "data": { "theme": "dark" },
        }),
    );

    let pong = protocol.pong();
    assert_envelope(&pong, "pong", 4, &Value::Null);

    let success = protocol.invoke_response("success".to_string(), Ok(serde_json::json!(3)));
    assert_envelope(
        &success,
        "invoke_response",
        5,
        &serde_json::json!({ "requestId": "success", "result": 3 }),
    );

    let error = protocol.invoke_response(
        "error".to_string(),
        Err(serde_json::json!({ "code": "FAILED" })),
    );
    assert_envelope(
        &error,
        "invoke_response",
        6,
        &serde_json::json!({
            "requestId": "error",
            "error": { "code": "FAILED" },
        }),
    );

    let ping = protocol.ping();
    assert_envelope(&ping, "ping", 7, &Value::Null);
}

#[test]
#[should_panic(expected = "Shutdown은 직접 처리됨")]
fn shutdown_broadcast_remains_unreachable_in_projection() {
    let mut protocol = WebSocketSessionProtocol::new();
    let _ = protocol.broadcast(&ObsBroadcast::Shutdown);
}
