use super::*;
use tokio_tungstenite::{connect_async, MaybeTlsStream};

type TestWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn tcp_pair() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("TCP listener 바인딩 실패");
    let address = listener.local_addr().expect("TCP listener 주소 조회 실패");
    let (client, server) = tokio::join!(TcpStream::connect(address), listener.accept());
    (
        client.expect("TCP client 연결 실패"),
        server.expect("TCP server accept 실패").0,
    )
}

async fn receive_envelope(ws: &mut TestWebSocket, expected_type: &str) -> ObsEnvelope {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    let envelope =
                        serde_json::from_str::<ObsEnvelope>(&text).expect("OBS envelope 파싱 실패");
                    if envelope.msg_type == expected_type {
                        return envelope;
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(error)) => panic!("WS 메시지 수신 실패: {error}"),
                None => panic!("WS 연결이 예기치 않게 종료됨"),
            }
        }
    })
    .await
    .expect("WS 메시지 수신 타임아웃")
}

async fn connect_authenticated(port: u16, token: &str) -> TestWebSocket {
    let (mut ws, _) = connect_async(format!("ws://127.0.0.1:{port}"))
        .await
        .expect("WS 연결 실패");
    let hello = make_envelope(
        "hello",
        0,
        serde_json::json!({ "token": token, "protocol": OBS_PROTOCOL_VERSION }),
    );
    ws.send(Message::Text(hello.to_string()))
        .await
        .expect("hello 전송 실패");

    receive_envelope(&mut ws, "hello_ack").await;
    receive_envelope(&mut ws, "snapshot").await;
    ws
}

async fn assert_no_tauri_event(ws: &mut TestWebSocket) {
    let result = tokio::time::timeout(Duration::from_millis(100), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    let envelope =
                        serde_json::from_str::<ObsEnvelope>(&text).expect("OBS envelope 파싱 실패");
                    if envelope.msg_type == "tauri_event" {
                        return true;
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => return false,
            }
        }
    })
    .await;

    assert!(
        matches!(result, Err(_) | Ok(false)),
        "예상하지 않은 tauri_event 중복 수신"
    );
}

#[test]
fn websocket_allowlist_uses_exact_matching() {
    assert_eq!(ALLOWED_WS_COMMANDS.len(), 32);
    assert!(is_allowed_command("app_bootstrap"));
    assert!(is_allowed_command("editor_get"));
    assert!(!is_allowed_command("css_history_get"));
    assert!(is_allowed_command("sound_list"));
    assert!(is_allowed_command("sound_load_original"));
    assert!(!is_allowed_command("plugin_storage_clear"));
    assert!(!is_allowed_command("plugin_storage_clear_by_prefix"));
    assert!(!is_allowed_command("editor_commit"));
    assert!(!is_allowed_command("settings_update"));
    assert!(!is_allowed_command("keys_update"));
    assert!(!is_allowed_command("keys_update_with_positions"));
    assert!(!is_allowed_command("plugin_rpc_send"));
    assert!(!is_allowed_command("plugin_rpc_respond"));
    assert!(!is_allowed_command("plugin_instances_commit"));
    assert!(!is_allowed_command("plugin_instances_reconcile"));
    assert!(!is_allowed_command("plugin_authority_reset"));
    assert!(!is_allowed_command("app_bootstrap_extra"));
    assert!(!is_allowed_command("plugin:window|close"));
    assert_eq!(build_allowed_list().len(), ALLOWED_WS_COMMANDS.len());
}

#[test]
fn bridge_messages_targeting_main_are_not_forwarded_to_obs() {
    let broadcast = serde_json::json!({ "type": "PING", "data": null });
    assert!(is_forwarded_to_obs("plugin-bridge:message", &broadcast));
    let to_overlay = serde_json::json!({ "type": "PING", "target": "overlay" });
    assert!(is_forwarded_to_obs("plugin-bridge:message", &to_overlay));
    let to_main = serde_json::json!({ "type": "PING", "target": "main" });
    assert!(!is_forwarded_to_obs("plugin-bridge:message", &to_main));
    assert!(!is_forwarded_to_obs("app:close-requested", &broadcast));
}

#[test]
fn public_overlay_events_are_forwarded_to_obs_clients() {
    assert_eq!(FORWARDED_EVENTS.len(), 32);
    for event in [
        "customTabs:changed",
        "overlay:resized",
        "counterAnimation:changed",
        "preset:snapshot",
    ] {
        assert!(FORWARDED_EVENTS.contains(&event), "missing event: {event}");
    }
}

#[tokio::test]
async fn publish_is_noop_while_server_is_stopped() {
    let bridge = ObsBridgeService::new("test");
    let mut receiver = bridge.broadcast_tx.subscribe();

    bridge.publish("settings:changed", serde_json::json!({ "enabled": true }));

    assert!(
        tokio::time::timeout(Duration::from_millis(50), receiver.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn publish_with_no_receivers_keeps_running_server_healthy() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 시작 실패");

    assert_ne!(port, 0);
    assert_eq!(bridge.broadcast_tx.receiver_count(), 0);
    bridge.publish("settings:changed", serde_json::json!({ "enabled": true }));
    assert!(bridge.is_running());

    bridge.stop();
}

#[tokio::test]
async fn publish_forwards_supported_events_to_authenticated_client() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 시작 실패");
    let mut ws = connect_authenticated(port, "token").await;

    for (event_name, data) in [
        ("settings:changed", serde_json::json!({ "theme": "dark" })),
        ("overlay:lock", serde_json::json!({ "locked": true })),
        ("css:content", serde_json::json!({ "content": "body {}" })),
    ] {
        bridge.publish(event_name, data.clone());
        let event = receive_envelope(&mut ws, "tauri_event").await;
        assert_eq!(
            event.payload,
            serde_json::json!({ "event": event_name, "data": data })
        );
    }

    bridge.stop();
}

#[tokio::test]
async fn publish_ignores_events_outside_forwarded_allowlist() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 시작 실패");
    let mut ws = connect_authenticated(port, "token").await;

    bridge.publish("history:status", serde_json::json!({ "canUndo": true }));
    bridge.publish("settings:changed", serde_json::json!({ "marker": true }));

    let event = receive_envelope(&mut ws, "tauri_event").await;
    assert_eq!(
        event.payload,
        serde_json::json!({
            "event": "settings:changed",
            "data": { "marker": true }
        })
    );
    assert_no_tauri_event(&mut ws).await;

    bridge.stop();
}

#[tokio::test]
async fn publish_reaches_multiple_authenticated_clients_once_each() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 시작 실패");
    let mut first = connect_authenticated(port, "token").await;
    let mut second = connect_authenticated(port, "token").await;

    bridge.publish("overlay:lock", serde_json::json!({ "locked": false }));

    for ws in [&mut first, &mut second] {
        let event = receive_envelope(ws, "tauri_event").await;
        assert_eq!(
            event.payload,
            serde_json::json!({
                "event": "overlay:lock",
                "data": { "locked": false }
            })
        );
        assert_no_tauri_event(ws).await;
    }

    bridge.stop();
}

#[tokio::test]
async fn publish_after_stop_start_has_no_missing_or_duplicate_event() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let first_port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 시작 실패");
    let mut first = connect_authenticated(first_port, "token").await;

    bridge.publish("settings:changed", serde_json::json!({ "cycle": 1 }));
    let first_event = receive_envelope(&mut first, "tauri_event").await;
    assert_eq!(first_event.payload["data"]["cycle"], 1);

    bridge.stop();
    drop(first);

    let second_port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 재시작 실패");
    let mut second = connect_authenticated(second_port, "token").await;

    bridge.publish("settings:changed", serde_json::json!({ "cycle": 2 }));
    let second_event = receive_envelope(&mut second, "tauri_event").await;
    assert_eq!(second_event.payload["data"]["cycle"], 2);
    assert_no_tauri_event(&mut second).await;

    bridge.stop();
}

#[tokio::test]
async fn lagged_publish_burst_recovers_with_latest_snapshot() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let expected_snapshot = serde_json::json!({ "revision": 300 });
    bridge.update_snapshot(expected_snapshot.clone());
    let port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 시작 실패");
    let mut ws = connect_authenticated(port, "token").await;

    for revision in 0..300 {
        bridge.publish(
            "settings:changed",
            serde_json::json!({ "revision": revision }),
        );
    }

    let snapshot = receive_envelope(&mut ws, "snapshot").await;
    assert_eq!(snapshot.payload, expected_snapshot);

    bridge.stop();
}

#[test]
fn host_header_allows_only_ip_literals_and_localhost() {
    for allowed in [
        "localhost",
        "LOCALHOST:34891",
        "127.0.0.1",
        "127.0.0.1:34891",
        "192.168.0.10:80",
        "::1",
        "[::1]",
        "[2001:db8::1]:34891",
    ] {
        assert!(is_allowed_host_header(allowed), "{allowed}");
    }

    for rejected in [
        "",
        "example.com",
        "example.com:34891",
        "localhost.example.com",
        "localhost:invalid",
        "[localhost]:34891",
        "127.0.0.1:99999",
    ] {
        assert!(!is_allowed_host_header(rejected), "{rejected}");
    }
}

#[test]
fn http_host_validation_rejects_missing_or_duplicate_headers() {
    assert!(has_allowed_http_host(
        "GET / HTTP/1.1\r\nHost: localhost:34891\r\n\r\n"
    ));
    assert!(!has_allowed_http_host("GET / HTTP/1.1\r\n\r\n"));
    assert!(!has_allowed_http_host(
        "GET / HTTP/1.1\r\nHost: localhost\r\nHost: example.com\r\n\r\n"
    ));
}

#[test]
fn http_header_parser_stops_at_the_first_empty_line_and_preserves_upgrade_tokens() {
    let headers =
        "GET / HTTP/1.1\r\nhOsT: localhost:34891\r\nUpgrade: keep-alive, WebSocket\r\n\r\n";
    let request = format!("{headers}Host: example.com\r\n");

    assert_eq!(http_header_end(request.as_bytes()), Some(headers.len()));
    assert_eq!(
        http_header_values(&request, "host"),
        vec!["localhost:34891"]
    );
    assert!(is_websocket_upgrade_request(&request));
    assert_eq!(http_header_end(b"GET / HTTP/1.1\n\n"), None);
}

#[test]
fn websocket_validation_reports_host_before_origin_and_uses_forbidden_status() {
    let invalid_host_and_origin = WsRequest::builder()
        .header(header::HOST, "example.com")
        .header(header::ORIGIN, "https://example.com")
        .body(())
        .unwrap();
    assert_eq!(
        validate_websocket_request(&invalid_host_and_origin),
        Err("Invalid Host header")
    );

    let duplicate_origin = WsRequest::builder()
        .header(header::HOST, "localhost:34891")
        .header(header::ORIGIN, "http://localhost:3400")
        .header(header::ORIGIN, "http://127.0.0.1:3400")
        .body(())
        .unwrap();
    assert_eq!(
        validate_websocket_request(&duplicate_origin),
        Err("Invalid Origin header")
    );

    let response = websocket_forbidden_response("Invalid Host header");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response.body().as_deref(), Some("Invalid Host header"));
}

#[tokio::test]
async fn prefixed_stream_replays_partial_prefix_before_socket_bytes() {
    let (mut client, server) = tcp_pair().await;
    client
        .write_all(b"socket")
        .await
        .expect("socket 바이트 전송 실패");

    let mut stream = PrefixedStream::new(b"header".to_vec(), server);
    let mut first = [0u8; 2];
    stream
        .read_exact(&mut first)
        .await
        .expect("prefix 첫 조각 수신 실패");
    assert_eq!(&first, b"he");

    let mut remaining = [0u8; 10];
    stream
        .read_exact(&mut remaining)
        .await
        .expect("prefix와 socket 바이트 수신 실패");
    assert_eq!(&remaining, b"adersocket");
}

#[tokio::test]
async fn transport_io_preserves_incomplete_header_error_and_empty_response_bytes() {
    let (mut incomplete_client, mut incomplete_server) = tcp_pair().await;
    incomplete_client
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost")
        .await
        .expect("미완성 header 전송 실패");
    incomplete_client
        .shutdown()
        .await
        .expect("미완성 header 연결 종료 실패");

    let error = read_http_request_headers(&mut incomplete_server)
        .await
        .expect_err("미완성 header가 허용됨");
    assert_eq!(error.kind(), std::io::ErrorKind::UnexpectedEof);
    assert_eq!(error.to_string(), "incomplete HTTP request headers");

    let (mut response_client, mut response_server) = tcp_pair().await;
    write_empty_http_response(&mut response_server, "400 Bad Request").await;
    drop(response_server);

    let mut response = Vec::new();
    response_client
        .read_to_end(&mut response)
        .await
        .expect("빈 HTTP 응답 수신 실패");
    assert_eq!(
        response,
        b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
}

#[test]
fn websocket_origin_allows_absence_or_local_machine_hosts_only() {
    let no_origin = WsRequest::builder()
        .header(header::HOST, "127.0.0.1:34891")
        .body(())
        .unwrap();
    assert!(validate_websocket_request(&no_origin).is_ok());

    let local_origin = WsRequest::builder()
        .header(header::HOST, "localhost:34891")
        .header(header::ORIGIN, "http://[::1]:3400")
        .body(())
        .unwrap();
    assert!(validate_websocket_request(&local_origin).is_ok());

    // 이 머신에 할당된 LAN IP는 허용 (LAN 클라이언트가 접속에 쓰는 페이지 origin)
    if let Ok(lan_ip) = local_ip_address::local_ip() {
        let lan_origin = WsRequest::builder()
            .header(header::HOST, format!("{lan_ip}:34891"))
            .header(header::ORIGIN, format!("http://{lan_ip}:34891"))
            .body(())
            .unwrap();
        assert!(validate_websocket_request(&lan_origin).is_ok());
    }

    let domain_origin = WsRequest::builder()
        .header(header::HOST, "127.0.0.1:34891")
        .header(header::ORIGIN, "https://example.com")
        .body(())
        .unwrap();
    assert_eq!(
        validate_websocket_request(&domain_origin),
        Err("Invalid Origin header")
    );

    // 이 머신의 인터페이스가 아닌 임의 숫자 IP는 거부 (TEST-NET-3)
    let foreign_ip_origin = WsRequest::builder()
        .header(header::HOST, "127.0.0.1:34891")
        .header(header::ORIGIN, "http://203.0.113.7")
        .body(())
        .unwrap();
    assert_eq!(
        validate_websocket_request(&foreign_ip_origin),
        Err("Invalid Origin header")
    );
}

async fn http_get(host: &str, port: u16, path: &str) -> String {
    let mut stream = TcpStream::connect((host, port))
        .await
        .expect("TCP 연결 실패");
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .expect("요청 전송 실패");
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .await
        .expect("응답 수신 실패");
    String::from_utf8_lossy(&response).into_owned()
}

#[test]
fn local_machine_ip_rejects_foreign_addresses() {
    assert!(is_local_machine_ip(&"127.0.0.1".parse().unwrap()));
    assert!(is_local_machine_ip(&"::1".parse().unwrap()));
    // TEST-NET-3 — 로컬 인터페이스에 할당될 일 없는 주소
    assert!(!is_local_machine_ip(&"203.0.113.7".parse().unwrap()));
    if let Ok(lan_ip) = local_ip_address::local_ip() {
        assert!(is_local_machine_ip(&lan_ip));
    }
}

async fn media_response_without_app_handle(expected_token: &str, rest: &str) -> Vec<u8> {
    let bridge = ObsBridgeService::new("test");
    bridge.set_token(expected_token.to_string());
    let (mut client, mut server) = tcp_pair().await;

    bridge.handle_media_request(&mut server, rest).await;
    drop(server);

    let mut response = Vec::new();
    client
        .read_to_end(&mut response)
        .await
        .expect("media 응답 수신 실패");
    response
}

#[tokio::test]
async fn media_token_query_uses_the_first_exact_token_parameter() {
    for (rest, expected_status) in [
        ("*?token=secret", "400 Bad Request"),
        ("*?other=value&token=secret", "400 Bad Request"),
        ("*?token=wrong&token=secret", "403 Forbidden"),
        ("*?not-token=secret", "403 Forbidden"),
        ("*?token=secret%20", "403 Forbidden"),
        ("*?TOKEN=secret", "403 Forbidden"),
    ] {
        let response = media_response_without_app_handle("secret", rest).await;
        assert!(
            response.starts_with(format!("HTTP/1.1 {expected_status}").as_bytes()),
            "rest={rest}, response={}",
            String::from_utf8_lossy(&response)
        );
    }

    let response = media_response_without_app_handle("", "*").await;
    assert!(response.starts_with(b"HTTP/1.1 400 Bad Request"));
}

#[tokio::test]
async fn media_path_decode_preserves_malformed_input_status_order() {
    use base64::Engine as _;

    let invalid_utf8 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0xff]);
    let relative_path =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("images/preview.PNG");
    let absolute_path = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        std::env::temp_dir()
            .join("preview.PNG")
            .to_string_lossy()
            .as_bytes(),
    );

    for (rest, expected_status) in [
        ("%GG", "400 Bad Request"),
        ("%", "400 Bad Request"),
        (invalid_utf8.as_str(), "400 Bad Request"),
        (relative_path.as_str(), "403 Forbidden"),
        (absolute_path.as_str(), "403 Forbidden"),
    ] {
        let response = media_response_without_app_handle("", rest).await;
        assert!(
            response.starts_with(format!("HTTP/1.1 {expected_status}").as_bytes()),
            "rest={rest}, response={}",
            String::from_utf8_lossy(&response)
        );
    }
}

#[test]
fn media_percent_decoding_preserves_lossy_and_incomplete_sequences() {
    assert_eq!(percent_decode("abc%2Fdef%20ghi"), "abc/def ghi");
    assert_eq!(percent_decode("%2f%41"), "/A");
    assert_eq!(percent_decode("%GG%2"), "%GG%2");
    assert_eq!(percent_decode("%FF"), "\u{fffd}");
    assert_eq!(percent_decode("plus+sign"), "plus+sign");
}

#[test]
fn media_mime_mapping_is_case_insensitive_and_preserves_fallbacks() {
    for (path, expected) in [
        ("index.HTML", "text/html; charset=utf-8"),
        ("bundle.MJS", "application/javascript; charset=utf-8"),
        ("theme.Css", "text/css; charset=utf-8"),
        ("data.JSON", "application/json; charset=utf-8"),
        ("image.JPEG", "image/jpeg"),
        ("clip.OgG", "video/ogg"),
        ("font.WOFF2", "font/woff2"),
        ("module.WASM", "application/wasm"),
        ("no-extension", "application/octet-stream"),
        ("archive.exe", "application/octet-stream"),
    ] {
        assert_eq!(guess_mime(path), expected, "path={path}");
    }
}

// dev 리다이렉트(token 쿼리 포함)는 이 머신 자신의 peer에만 허용 —
// 같은 PC가 자기 LAN IP로 접속하는 URL 복사 경로는 유지되어야 함
#[tokio::test]
async fn dev_redirect_serves_only_local_machine_peers() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    bridge.set_dev_url("http://localhost:3400".to_string());
    let port = bridge
        .start(0, "dev-token".to_string())
        .await
        .expect("OBS bridge 시작 실패");

    // loopback peer → 기존 dev 부트스트랩(302 + token) 유지
    let response = http_get("127.0.0.1", port, "/").await;
    assert!(response.starts_with("HTTP/1.1 302"), "{response}");
    assert!(response.contains("token=dev-token"), "{response}");

    // 같은 머신의 LAN IP 경유 — peer도 로컬 인터페이스 IP이므로 유지되어야 함
    if let Ok(lan_ip) = local_ip_address::local_ip() {
        let response = http_get(&lan_ip.to_string(), port, "/").await;
        assert!(
            response.starts_with("HTTP/1.1 302"),
            "같은 PC의 LAN IP 접속이 깨지면 안 됨: {response}"
        );
    }

    bridge.stop();
}

// Game Bar 엔드포인트 제거 검증 — 어떤 경로도 무인증 HTTP 응답으로 토큰을 내주면 안 됨
#[tokio::test]
async fn gamebar_paths_no_longer_leak_token() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let port = bridge
        .start(0, "secret-token".to_string())
        .await
        .expect("OBS bridge 시작 실패");

    for path in ["/gamebar", "/gamebar/bootstrap.json"] {
        let mut stream = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("TCP 연결 실패");
        let request =
            format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
        stream
            .write_all(request.as_bytes())
            .await
            .expect("요청 전송 실패");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .expect("응답 수신 실패");
        let response = String::from_utf8_lossy(&response);
        assert!(
            !response.contains("secret-token"),
            "{path} 응답에 토큰 노출: {response}"
        );
    }

    bridge.stop();
}

// dev 모드에서도 /media는 Vite 리다이렉트가 아니라 브릿지가 직접 처리해야 함
#[tokio::test]
async fn media_requests_bypass_dev_redirect() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    bridge.set_dev_url("http://localhost:3400".to_string());
    let port = bridge
        .start(0, "media-token".to_string())
        .await
        .expect("OBS bridge 시작 실패");

    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("TCP 연결 실패");
    stream
        .write_all(
            b"GET /media/abc?token=wrong HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        )
        .await
        .expect("요청 전송 실패");
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .await
        .expect("응답 수신 실패");
    let response = String::from_utf8_lossy(&response);
    assert!(
        response.starts_with("HTTP/1.1 403"),
        "302 리다이렉트가 아닌 미디어 핸들러 403이어야 함: {response}"
    );

    bridge.stop();
}

#[tokio::test]
async fn protocol_mismatch_is_rejected_before_auth() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 시작 실패");

    let (mut ws, _) = connect_async(format!("ws://127.0.0.1:{port}"))
        .await
        .expect("WS 연결 실패");
    // 올바른 토큰이라도 프로토콜 버전이 다르면 거부되어야 함
    let hello = serde_json::json!({
        "v": 999,
        "type": "hello",
        "seq": 0,
        "payload": { "token": "token", "protocol": 999 },
    });
    ws.send(Message::Text(hello.to_string()))
        .await
        .expect("hello 전송 실패");

    let error = receive_envelope(&mut ws, "error").await;
    assert_eq!(
        error.payload.get("code").and_then(Value::as_str),
        Some("PROTOCOL_MISMATCH")
    );

    bridge.stop();
}

// v1 번들은 KeySlot union 와이어 형식을 소비할 수 없으므로 handshake에서 결정적으로 거부
#[tokio::test]
async fn legacy_protocol_v1_hello_is_rejected() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    let port = bridge
        .start(0, "token".to_string())
        .await
        .expect("OBS bridge 시작 실패");

    let (mut ws, _) = connect_async(format!("ws://127.0.0.1:{port}"))
        .await
        .expect("WS 연결 실패");
    let hello = serde_json::json!({
        "v": 1,
        "type": "hello",
        "seq": 0,
        "payload": { "token": "token", "protocol": 1 },
    });
    ws.send(Message::Text(hello.to_string()))
        .await
        .expect("hello 전송 실패");

    let error = receive_envelope(&mut ws, "error").await;
    assert_eq!(
        error.payload.get("code").and_then(Value::as_str),
        Some("PROTOCOL_MISMATCH")
    );

    bridge.stop();
}

#[test]
fn binding_listens_on_all_interfaces_for_lan_access() {
    assert!(bind_address(34891).ip().is_unspecified());
    assert_eq!(bind_address(34891).port(), 34891);
}

// 같은 네트워크의 다른 PC 접속은 제품 계약 — LAN IP 경유 인증 접속이 실제로 성립해야 함
#[tokio::test]
async fn lan_address_accepts_authenticated_clients() {
    let Ok(lan_ip) = local_ip_address::local_ip() else {
        eprintln!("LAN IP 조회 불가 환경, 테스트 스킵");
        return;
    };

    let bridge = Arc::new(ObsBridgeService::new("test"));
    bridge.update_snapshot(serde_json::json!({ "source": "lan" }));
    let port = bridge
        .start(0, "lan-token".to_string())
        .await
        .expect("OBS bridge 시작 실패");

    assert_eq!(bridge.status().local_ip, Some(lan_ip.to_string()));

    let (mut ws, _) = connect_async(format!("ws://{lan_ip}:{port}"))
        .await
        .expect("LAN IP로 WS 연결 실패");
    let hello = make_envelope(
        "hello",
        0,
        serde_json::json!({ "token": "lan-token", "protocol": OBS_PROTOCOL_VERSION }),
    );
    ws.send(Message::Text(hello.to_string()))
        .await
        .expect("hello 전송 실패");
    receive_envelope(&mut ws, "hello_ack").await;
    let snapshot = receive_envelope(&mut ws, "snapshot").await;
    assert_eq!(snapshot.payload, serde_json::json!({ "source": "lan" }));

    bridge.stop();
}

#[tokio::test]
async fn token_rotation_disconnects_existing_sessions_and_keeps_server_running() {
    let bridge = Arc::new(ObsBridgeService::new("test"));
    bridge.update_snapshot(serde_json::json!({ "source": "initial" }));
    let port = bridge
        .start(0, "old-token".to_string())
        .await
        .expect("OBS bridge 시작 실패");
    let mut old_ws = connect_authenticated(port, "old-token").await;

    bridge.set_token("new-token".to_string());
    assert!(bridge.is_running());
    assert_eq!(bridge.status().port, port);

    let resync = make_envelope("resync_request", 1, Value::Null);
    let _ = old_ws.send(Message::Text(resync.to_string())).await;
    bridge.publish(
        "settings:changed",
        serde_json::json!({ "authenticated": false }),
    );

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match old_ws.next().await {
                Some(Ok(Message::Text(text))) => {
                    let envelope: ObsEnvelope =
                        serde_json::from_str(&text).expect("OBS envelope 파싱 실패");
                    assert_ne!(envelope.msg_type, "snapshot");
                    if envelope.msg_type == "tauri_event" {
                        assert_ne!(
                            envelope.payload.get("event").and_then(Value::as_str),
                            Some("settings:changed")
                        );
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            }
        }
    })
    .await
    .expect("구 토큰 세션이 종료되지 않음");

    let mut new_ws = connect_authenticated(port, "new-token").await;
    bridge.publish(
        "settings:changed",
        serde_json::json!({ "authenticated": true }),
    );
    let event = receive_envelope(&mut new_ws, "tauri_event").await;
    assert_eq!(
        event.payload,
        serde_json::json!({
            "event": "settings:changed",
            "data": { "authenticated": true }
        })
    );

    bridge.stop();
}
