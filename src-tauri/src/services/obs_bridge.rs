use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use parking_lot::RwLock;
use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Manager, Wry};
#[cfg(test)]
use tokio::io::AsyncReadExt;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, oneshot};
#[cfg(test)]
use tokio_tungstenite::tungstenite::http::{header, StatusCode};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{Request as WsRequest, Response as WsResponse},
        Message,
    },
    WebSocketStream,
};

use crate::models::obs::{
    make_envelope, HelloAckPayload, InvokeRequestPayload, ObsBroadcast, ObsEnvelope, ObsStatus,
    OBS_PROTOCOL_VERSION,
};

mod transport;

use transport::{
    bind_address, has_allowed_http_host, http_header_end, is_local_machine_ip,
    is_websocket_upgrade_request, read_http_request_headers, validate_websocket_request,
    websocket_forbidden_response, write_empty_http_response, PrefixedStream,
};
#[cfg(test)]
use transport::{http_header_values, is_allowed_host_header};

/// OBS 클라이언트에서 실행 가능한 커맨드 목록
const ALLOWED_WS_COMMANDS: &[&str] = &[
    "app_bootstrap",
    "settings_get",
    "editor_get",
    "layer_groups_get",
    "note_tab_get_all",
    "note_tab_get",
    "css_get",
    "css_get_use",
    "css_tab_get_all",
    "css_tab_get",
    "js_get",
    "js_get_use",
    "get_cursor_settings",
    "keys_get",
    "keys_get_counters",
    "positions_get",
    "stat_positions_get",
    "graph_positions_get",
    "knob_positions_get",
    "custom_tabs_list",
    "sound_list",
    "sound_load_original",
    "counter_animation_list",
    "plugin_bridge_send",
    "plugin_bridge_send_to",
    "raw_input_subscribe",
    "raw_input_unsubscribe",
    "plugin_storage_get",
    "plugin_storage_set",
    "plugin_storage_remove",
    "plugin_storage_keys",
    "plugin_storage_has_data",
    // 파괴적 bulk 삭제는 plugin_storage_clear와 동일하게 원격 차단
];

// OBS 브라우저 소스는 overlay 창을 대신한다 - main만을 향한 브릿지 메시지는 전달하지 않는다
fn is_forwarded_to_obs(event: &str, data: &Value) -> bool {
    if !FORWARDED_EVENTS.contains(&event) {
        return false;
    }
    !(event == "plugin-bridge:message"
        && data.get("target").and_then(Value::as_str) == Some("main"))
}

const FORWARDED_EVENTS: &[&str] = &[
    "settings:changed",
    "editor:committed",
    "keys:state",
    "keys:reset",
    "keys:changed",
    "keys:counters",
    "keys:counter",
    "keys:counters-state",
    "keys:mode-changed",
    "customTabs:changed",
    "positions:changed",
    "statPositions:changed",
    "graphPositions:changed",
    "knobPositions:changed",
    "layerGroups:changed",
    "overlay:visibility",
    "overlay:lock",
    "overlay:anchor",
    "overlay:resized",
    "input:raw",
    "input:press",
    "input:axis",
    "css:use",
    "css:content",
    "js:use",
    "js:content",
    "tabNote:changed",
    "tabNote:changed_all",
    "tabCss:changed",
    "counterAnimation:changed",
    "preset:snapshot",
    "plugin-bridge:message",
];

fn is_allowed_command(command: &str) -> bool {
    ALLOWED_WS_COMMANDS.contains(&command)
}

fn build_allowed_list() -> Vec<String> {
    ALLOWED_WS_COMMANDS
        .iter()
        .map(|command| command.to_string())
        .collect()
}

/// 임베딩 에셋 조회 함수 타입 (path → Option<(bytes, mime_type)>)
pub type AssetFetcher = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;

/// OBS WebSocket 서버
pub struct ObsBridgeService {
    running: AtomicBool,
    port: RwLock<u16>,
    client_count: AtomicU32,
    cached_snapshot: RwLock<Value>,
    broadcast_tx: broadcast::Sender<ObsBroadcast>,
    shutdown_tx: RwLock<Option<oneshot::Sender<()>>>,
    /// 서버 루프 태스크 핸들 (stop→start 경쟁 조건 방지)
    server_handle: tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Tauri 임베딩 에셋 조회 (포터블 exe용)
    asset_fetcher: RwLock<Option<AssetFetcher>>,
    /// dev 모드 Vite dev server URL (예: "http://localhost:3400")
    dev_url: RwLock<Option<String>>,
    server_version: String,
    /// 세션 보안 토큰 (서버 시작 시 랜덤 생성)
    session_token: RwLock<String>,
    /// Tauri AppHandle (invoke_request 디스패치용)
    app_handle: RwLock<Option<AppHandle<Wry>>>,
}

impl ObsBridgeService {
    pub fn new(version: &str) -> Self {
        let (broadcast_tx, _) = broadcast::channel(256);
        Self {
            running: AtomicBool::new(false),
            port: RwLock::new(0),
            client_count: AtomicU32::new(0),
            cached_snapshot: RwLock::new(Value::Null),
            broadcast_tx,
            shutdown_tx: RwLock::new(None),
            server_handle: tokio::sync::Mutex::new(None),
            asset_fetcher: RwLock::new(None),
            dev_url: RwLock::new(None),
            server_version: version.to_string(),
            session_token: RwLock::new(String::new()),
            app_handle: RwLock::new(None),
        }
    }

    pub fn set_asset_fetcher(&self, fetcher: AssetFetcher) {
        *self.asset_fetcher.write() = Some(fetcher);
    }

    pub fn set_dev_url(&self, url: String) {
        *self.dev_url.write() = Some(url);
    }

    pub fn set_app_handle(&self, handle: AppHandle<Wry>) {
        *self.app_handle.write() = Some(handle);
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn client_count(&self) -> u32 {
        self.client_count.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> ObsStatus {
        let token = {
            let t = self.session_token.read();
            if t.is_empty() {
                None
            } else {
                Some(t.clone())
            }
        };
        // 같은 네트워크의 다른 PC 접속 안내용 LAN IP (조회 실패 시 프론트가 localhost로 fallback)
        let local_ip = local_ip_address::local_ip().ok().map(|ip| ip.to_string());
        ObsStatus {
            running: self.is_running(),
            port: *self.port.read(),
            client_count: self.client_count(),
            token,
            local_ip,
        }
    }

    pub fn update_snapshot(&self, snapshot: Value) {
        *self.cached_snapshot.write() = snapshot;
    }

    pub fn publish(&self, event: &str, data: Value) {
        if !self.is_running() || !is_forwarded_to_obs(event, &data) {
            return;
        }

        let receiver_count = self.broadcast_tx.receiver_count();
        if self
            .broadcast_tx
            .send(ObsBroadcast::TauriEvent {
                event: event.to_string(),
                data,
            })
            .is_err()
            && receiver_count > 0
        {
            log::warn!("[ObsBridge] {event} 전송 실패: receiver_count={receiver_count}");
        }
    }

    /// 전체 스냅샷 재전송 (프리셋 로드 등 대규모 변경 시)
    pub fn broadcast_snapshot(&self) {
        let snapshot = self.cached_snapshot.read().clone();
        let _ = self.broadcast_tx.send(ObsBroadcast::Snapshot(snapshot));
    }

    /// WS 서버 시작 (토큰은 호출자가 전달, 포트 자동 fallback)
    pub async fn start(self: &Arc<Self>, port: u16, token: String) -> Result<u16, String> {
        // 원자적 check-and-set
        if self
            .running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_err()
        {
            return Err("OBS bridge already running".to_string());
        }

        // 이전 서버 태스크 종료 대기 (stop→start 경쟁 조건 방지)
        {
            let mut handle = self.server_handle.lock().await;
            if let Some(h) = handle.take() {
                let _ = h.await;
            }
        }

        // 세션 토큰 설정 (호출자가 생성/재사용 결정)
        *self.session_token.write() = token;

        // 포트 자동 fallback: 기본 포트 → +1 ~ +9 순차 시도
        let mut listener = None;
        let mut last_err = String::new();
        for offset in 0u16..10 {
            let try_port = port.saturating_add(offset);
            let addr = bind_address(try_port);
            match TcpListener::bind(addr).await {
                Ok(l) => {
                    if offset > 0 {
                        log::info!("[ObsBridge] 포트 {port} 사용 불가, {try_port}로 fallback");
                    }
                    listener = Some(l);
                    break;
                }
                Err(e) => {
                    last_err = format!("포트 {try_port} 바인드 실패: {e}");
                }
            }
        }
        let listener = match listener {
            Some(l) => l,
            None => {
                self.running.store(false, Ordering::Relaxed);
                return Err(last_err);
            }
        };

        // 실제 바인딩된 포트 저장 (port=0인 경우 OS 할당 포트 반영)
        let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        *self.shutdown_tx.write() = Some(shutdown_tx);
        *self.port.write() = actual_port;

        let bridge = Arc::clone(self);
        let handle = tokio::spawn(async move {
            bridge.server_loop(listener, shutdown_rx).await;
        });
        *self.server_handle.lock().await = Some(handle);

        log::info!("[ObsBridge] 서버 시작: http://0.0.0.0:{actual_port}");
        Ok(actual_port)
    }

    /// 서버 종료
    pub fn stop(&self) {
        if !self.running.load(Ordering::Relaxed) {
            return;
        }
        // 기존 클라이언트 세션에 종료 신호 전송
        let _ = self.broadcast_tx.send(ObsBroadcast::Shutdown);
        if let Some(tx) = self.shutdown_tx.write().take() {
            let _ = tx.send(());
        }
        self.running.store(false, Ordering::Relaxed);
        // 토큰은 유지 (재시작 시 동일 토큰 재사용)
        log::info!("[ObsBridge] 서버 종료");
    }

    /// 세션 토큰 교체 (실행 중 호출 가능)
    pub fn set_token(&self, token: String) {
        *self.session_token.write() = token;
        // 기존 인증 세션 종료
        let _ = self.broadcast_tx.send(ObsBroadcast::Shutdown);
    }

    fn is_current_session_token(&self, token: &str) -> bool {
        self.session_token.read().as_str() == token
    }

    async fn server_loop(
        self: &Arc<Self>,
        listener: TcpListener,
        mut shutdown_rx: oneshot::Receiver<()>,
    ) {
        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            // 작은 키 이벤트 연속 전송의 Nagle 지연 방지
                            if let Err(error) = stream.set_nodelay(true) {
                                log::warn!(
                                    "[ObsBridge] TCP_NODELAY 설정 실패 from {addr}: {error}"
                                );
                            }
                            let bridge = Arc::clone(self);
                            tokio::spawn(async move {
                                bridge.handle_connection(stream, addr).await;
                            });
                        }
                        Err(e) => {
                            log::warn!("[ObsBridge] accept 실패: {e}");
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    log::info!("[ObsBridge] shutdown 신호 수신");
                    break;
                }
            }
        }
        // running 플래그는 stop()에서 관리 (server_loop에서 해제하면 restart 시 경쟁 조건 발생)
    }

    async fn handle_connection(self: &Arc<Self>, mut stream: TcpStream, addr: SocketAddr) {
        let request_bytes = match tokio::time::timeout(
            Duration::from_secs(5),
            read_http_request_headers(&mut stream),
        )
        .await
        {
            Ok(Ok(request)) => request,
            Ok(Err(error)) => {
                log::debug!("[ObsBridge] HTTP 요청 헤더 파싱 실패 from {addr}: {error}");
                write_empty_http_response(&mut stream, "400 Bad Request").await;
                return;
            }
            Err(_) => {
                log::debug!("[ObsBridge] HTTP 요청 헤더 타임아웃 from {addr}");
                write_empty_http_response(&mut stream, "408 Request Timeout").await;
                return;
            }
        };

        let header_end = http_header_end(&request_bytes).unwrap_or(request_bytes.len());
        let request = match std::str::from_utf8(&request_bytes[..header_end]) {
            Ok(request) => request,
            Err(error) => {
                log::debug!("[ObsBridge] HTTP 요청 헤더 인코딩 오류 from {addr}: {error}");
                write_empty_http_response(&mut stream, "400 Bad Request").await;
                return;
            }
        };

        if is_websocket_upgrade_request(request) {
            // WebSocket 핸드셰이크
            #[allow(clippy::result_large_err)]
            let callback = move |request: &WsRequest, response: WsResponse| {
                if let Err(reason) = validate_websocket_request(request) {
                    log::warn!("[ObsBridge] WS 요청 거부 from {addr}: {reason}");
                    return Err(websocket_forbidden_response(reason));
                }
                Ok(response)
            };
            let prefixed_stream = PrefixedStream::new(request_bytes, stream);
            let ws_stream = match accept_hdr_async(prefixed_stream, callback).await {
                Ok(ws) => ws,
                Err(e) => {
                    log::debug!("[ObsBridge] WS 핸드셰이크 실패 from {addr}: {e}");
                    return;
                }
            };
            self.handle_ws_client(ws_stream, addr).await;
        } else {
            // HTTP 정적 파일 서빙
            self.handle_http_request(&mut stream, addr, request).await;
        }
    }

    /// HTTP GET 요청에 대해 정적 파일 서빙
    async fn handle_http_request(&self, stream: &mut TcpStream, addr: SocketAddr, request: &str) {
        if !has_allowed_http_host(request) {
            log::warn!("[ObsBridge] HTTP 요청 거부 from {addr}: 허용되지 않은 Host");
            write_empty_http_response(stream, "403 Forbidden").await;
            return;
        }

        // GET 경로 파싱
        let path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/");
        let route = path.split('?').next().unwrap_or(path);
        let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");

        // /media/<base64-encoded-path>?token=xxx — 사용자 로컬 미디어 파일 서빙
        // dev 리다이렉트보다 먼저 처리 — 미디어는 Vite가 아니라 브릿지가 직접 서빙
        if let Some(rest) = path.strip_prefix("/media/") {
            self.handle_media_request(stream, rest).await;
            return;
        }

        // dev 모드: Vite dev server로 리다이렉트
        let dev_url = self.dev_url.read().clone();
        if let Some(dev_base) = &dev_url {
            // 리다이렉트가 token을 쿼리로 전달하므로 이 머신 자신의 요청에만 허용 —
            // 원격 LAN peer가 debug 서버에서 무인증 토큰을 얻는 경로 차단.
            // 같은 PC가 자기 LAN IP로 접속하는 경우(URL 복사 기본값)는 peer도 로컬 인터페이스 IP라 유지됨
            if !is_local_machine_ip(&addr.ip()) {
                log::warn!("[ObsBridge] dev 리다이렉트 거부 from {addr}: 원격 peer");
                write_empty_http_response(stream, "403 Forbidden").await;
                return;
            }
            let is_root_route = route == "/" || route.is_empty();
            let redirect_path = if is_root_route {
                if query.is_empty() {
                    "/obs/index.html".to_string()
                } else {
                    format!("/obs/index.html?{query}")
                }
            } else if path.starts_with("/obs/") {
                path.to_string()
            } else {
                format!("/obs{path}")
            };
            // WS 연결에 필요한 port/token을 query param으로 전달
            // (Vite dev server 포트 ≠ OBS bridge 포트)
            let port = *self.port.read();
            let token = self.session_token.read().clone();
            let location = if redirect_path.contains('?') {
                format!("{dev_base}{redirect_path}&port={port}&token={token}")
            } else {
                format!("{dev_base}{redirect_path}?port={port}&token={token}")
            };
            let response = format!(
                "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = stream.write_all(response.as_bytes()).await;
            return;
        }

        // 경로 정규화: "/" → "obs/index.html"
        let normalized = if route == "/" || route.is_empty() {
            "obs/index.html"
        } else {
            route.trim_start_matches('/')
        };

        // 경로 탐색 공격 방지 (.., 절대경로, 드라이브 경로 거부)
        if normalized.contains("..")
            || normalized.starts_with('/')
            || normalized.starts_with('\\')
            || normalized.contains(':')
        {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            return;
        }

        // 에셋 조회: 1) Tauri 임베딩 에셋 2) 디스크 정적 파일
        if let Some((content, mime)) = self.resolve_asset(normalized).await {
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                content.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.write_all(&content).await;
            return;
        }

        // SPA fallback: 확장자 없는 경로 → obs/index.html
        let has_extension = normalized
            .rsplit('/')
            .next()
            .is_some_and(|filename| filename.contains('.'));
        if !has_extension {
            if let Some((content, mime)) = self.resolve_asset("obs/index.html").await {
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                    content.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.write_all(&content).await;
                return;
            }
        }

        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
    }

    /// Tauri 임베딩 에셋 조회
    async fn resolve_asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
        let fetcher = self.asset_fetcher.read().clone();
        if let Some(ref f) = fetcher {
            return f(path);
        }
        None
    }

    async fn handle_ws_client<S>(self: &Arc<Self>, ws: WebSocketStream<S>, addr: SocketAddr)
    where
        S: AsyncRead + AsyncWrite + Unpin + Send,
    {
        self.client_count.fetch_add(1, Ordering::Relaxed);
        log::info!(
            "[ObsBridge] 클라이언트 연결: {addr} (총 {})",
            self.client_count()
        );

        let (mut ws_tx, mut ws_rx) = ws.split();
        let mut broadcast_rx = self.broadcast_tx.subscribe();

        // 클라이언트별 시퀀스 카운터
        let mut client_seq: u64 = 0;
        let mut next_seq = || {
            let s = client_seq;
            client_seq += 1;
            s
        };

        // hello 핸드셰이크 대기 (5초 타임아웃)
        let hello_result = tokio::time::timeout(Duration::from_secs(5), async {
            while let Some(msg) = ws_rx.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(envelope) = serde_json::from_str::<ObsEnvelope>(&text) {
                            if envelope.msg_type == "hello" {
                                return Some(envelope);
                            }
                        }
                    }
                    Ok(Message::Close(_)) => return None,
                    _ => {}
                }
            }
            None
        })
        .await;

        let hello = match hello_result {
            Ok(Some(envelope)) => envelope,
            _ => {
                log::warn!("[ObsBridge] {addr}: hello 타임아웃 또는 연결 종료");
                self.client_count.fetch_sub(1, Ordering::Relaxed);
                return;
            }
        };

        // 프로토콜 버전 검증 — handshake 계약이 다른 클라이언트는 fail-closed로 거부
        let client_protocol = hello.payload.get("protocol").and_then(Value::as_u64);
        if hello.v != OBS_PROTOCOL_VERSION
            || client_protocol != Some(u64::from(OBS_PROTOCOL_VERSION))
        {
            log::warn!(
                "[ObsBridge] {addr}: 프로토콜 버전 불일치 (v={}, protocol={client_protocol:?}), 연결 거부",
                hello.v
            );
            let err_msg = make_envelope(
                "error",
                0,
                serde_json::json!({
                    "code": "PROTOCOL_MISMATCH",
                    "message": format!(
                        "Unsupported protocol version (expected {OBS_PROTOCOL_VERSION})"
                    ),
                }),
            );
            let _ = ws_tx.send(Message::Text(err_msg.to_string())).await;
            self.client_count.fetch_sub(1, Ordering::Relaxed);
            return;
        }

        // 보안 토큰 검증
        let expected_token = self.session_token.read().clone();
        if !expected_token.is_empty() {
            let client_token = hello
                .payload
                .get("token")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if client_token != expected_token {
                log::warn!("[ObsBridge] {addr}: 토큰 불일치, 연결 거부");
                let err_msg = make_envelope(
                    "error",
                    0,
                    serde_json::json!({"code": "AUTH_FAILED", "message": "Invalid token"}),
                );
                let _ = ws_tx.send(Message::Text(err_msg.to_string())).await;
                self.client_count.fetch_sub(1, Ordering::Relaxed);
                return;
            }
        }

        // hello_ack 전송 (allowlist 포함)
        if !self.is_current_session_token(&expected_token) {
            self.client_count.fetch_sub(1, Ordering::Relaxed);
            return;
        }
        let ack_payload = serde_json::to_value(HelloAckPayload {
            server_version: self.server_version.clone(),
            obs_mode: true,
            allowed_list: build_allowed_list(),
        })
        .unwrap_or_default();
        let ack_msg = make_envelope("hello_ack", next_seq(), ack_payload);
        if ws_tx
            .send(Message::Text(ack_msg.to_string()))
            .await
            .is_err()
        {
            self.client_count.fetch_sub(1, Ordering::Relaxed);
            return;
        }

        // snapshot 전송
        if !self.is_current_session_token(&expected_token) {
            self.client_count.fetch_sub(1, Ordering::Relaxed);
            return;
        }
        let snapshot = self.cached_snapshot.read().clone();
        let snapshot_msg = make_envelope("snapshot", next_seq(), snapshot);
        if ws_tx
            .send(Message::Text(snapshot_msg.to_string()))
            .await
            .is_err()
        {
            self.client_count.fetch_sub(1, Ordering::Relaxed);
            return;
        }

        // RPC 응답 채널 (invoke_request → invoke_response)
        let (rpc_tx, mut rpc_rx) =
            tokio::sync::mpsc::unbounded_channel::<(String, Result<Value, Value>)>();

        // 메인 루프: broadcast 수신 + 클라이언트 메시지 수신 + RPC 응답
        let mut ping_interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            tokio::select! {
                // broadcast 채널에서 메시지 수신 → 클라이언트에 전송
                result = broadcast_rx.recv() => {
                    if !self.is_current_session_token(&expected_token) {
                        break;
                    }
                    match result {
                        Ok(ObsBroadcast::Shutdown) => break,
                        Ok(broadcast) => {
                            let msg = broadcast_to_envelope(&broadcast, next_seq());
                            if ws_tx.send(Message::Text(msg.to_string())).await.is_err() {
                                break;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            log::warn!("[ObsBridge] {addr}: {n}개 메시지 누락, 스냅샷 재전송");
                            let snapshot = self.cached_snapshot.read().clone();
                            let msg = make_envelope("snapshot", next_seq(), snapshot);
                            if ws_tx.send(Message::Text(msg.to_string())).await.is_err() {
                                break;
                            }
                        }
                        // broadcast 채널 닫힘 = 서버 종료
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
                // 클라이언트에서 메시지 수신
                msg = ws_rx.next() => {
                    if !self.is_current_session_token(&expected_token) {
                        break;
                    }
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(envelope) = serde_json::from_str::<ObsEnvelope>(&text) {
                                match envelope.msg_type.as_str() {
                                    "ping" => {
                                        let pong = make_envelope("pong", next_seq(), Value::Null);
                                        if ws_tx.send(Message::Text(pong.to_string())).await.is_err() {
                                            break;
                                        }
                                    }
                                    "resync_request" => {
                                        let snapshot = self.cached_snapshot.read().clone();
                                        let msg = make_envelope("snapshot", next_seq(), snapshot);
                                        if ws_tx.send(Message::Text(msg.to_string())).await.is_err() {
                                            break;
                                        }
                                    }
                                    "invoke_request" => {
                                        self.handle_invoke_request(
                                            &envelope.payload,
                                            &addr,
                                            rpc_tx.clone(),
                                        );
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Ok(Message::Ping(data))) => {
                            let _ = ws_tx.send(Message::Pong(data)).await;
                        }
                        _ => {}
                    }
                }
                // RPC 응답 전송 (invoke_request → invoke_response)
                Some((request_id, result)) = rpc_rx.recv() => {
                    if !self.is_current_session_token(&expected_token) {
                        break;
                    }
                    let payload = match result {
                        Ok(data) => serde_json::json!({ "requestId": request_id, "result": data }),
                        Err(err) => serde_json::json!({ "requestId": request_id, "error": err }),
                    };
                    let msg = make_envelope("invoke_response", next_seq(), payload);
                    if ws_tx.send(Message::Text(msg.to_string())).await.is_err() {
                        break;
                    }
                }
                // 서버 주도 ping (연결 유지)
                _ = ping_interval.tick() => {
                    if !self.is_current_session_token(&expected_token) {
                        break;
                    }
                    let ping_msg = make_envelope("ping", next_seq(), Value::Null);
                    if ws_tx.send(Message::Text(ping_msg.to_string())).await.is_err() {
                        break;
                    }
                }
            }
        }

        self.client_count.fetch_sub(1, Ordering::Relaxed);
        log::info!(
            "[ObsBridge] 클라이언트 연결 종료: {addr} (남은 {})",
            self.client_count()
        );
    }

    /// invoke_request 처리: webview.on_message()로 Tauri 커맨드 파이프라인에 주입
    fn handle_invoke_request(
        &self,
        payload: &Value,
        addr: &SocketAddr,
        rpc_tx: tokio::sync::mpsc::UnboundedSender<(String, Result<Value, Value>)>,
    ) {
        let req: InvokeRequestPayload = match serde_json::from_value(payload.clone()) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[ObsBridge] {addr}: invoke_request 파싱 실패: {e}");
                // requestId를 추출 시도하여 에러 응답 전송 (파싱 실패여도 클라이언트 대기 방지)
                if let Some(request_id) = payload.get("requestId").and_then(|v| v.as_str()) {
                    let _ = rpc_tx.send((
                        request_id.to_string(),
                        Err(serde_json::json!(format!("Invalid invoke_request: {e}"))),
                    ));
                }
                return;
            }
        };

        // allowlist 검사 (클라이언트 검사와 별도인 백엔드 안전망)
        if !is_allowed_command(&req.command) {
            log::debug!("[ObsBridge] {addr}: 허용되지 않은 cmd={}", req.command);
            let _ = rpc_tx.send((
                req.request_id,
                Err(serde_json::json!(format!(
                    "Command not allowed: {}",
                    req.command
                ))),
            ));
            return;
        }

        // AppHandle에서 overlay webview 가져오기
        let app_handle = match self.app_handle.read().clone() {
            Some(h) => h,
            None => {
                log::warn!("[ObsBridge] {addr}: AppHandle 미설정");
                let _ = rpc_tx.send((
                    req.request_id,
                    Err(serde_json::json!("AppHandle not available")),
                ));
                return;
            }
        };

        // OBS 모드에서 오버레이가 destroy된 상태일 수 있으므로 main window로 fallback
        let webview_window = match app_handle
            .get_webview_window("overlay")
            .or_else(|| app_handle.get_webview_window("main"))
        {
            Some(w) => w,
            None => {
                log::warn!("[ObsBridge] {addr}: webview 없음 (overlay/main 모두)");
                let _ = rpc_tx.send((
                    req.request_id,
                    Err(serde_json::json!("No webview window available")),
                ));
                return;
            }
        };

        // InvokeRequest 구성
        // 플랫폼별 로컬 URL (Windows: http://tauri.localhost, macOS/Linux: tauri://localhost)
        let local_url = if cfg!(windows) || cfg!(target_os = "android") {
            tauri::Url::parse("http://tauri.localhost").unwrap()
        } else {
            tauri::Url::parse("tauri://localhost").unwrap()
        };
        let invoke_key = app_handle.invoke_key().to_string();
        let request = InvokeRequest {
            cmd: req.command.clone(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: local_url,
            body: InvokeBody::Json(req.args),
            headers: Default::default(),
            invoke_key,
        };

        let request_id = req.request_id;
        let cmd = req.command.clone();
        let addr_clone = *addr;

        // OwnedInvokeResponder: 응답을 rpc_tx 채널로 전송
        let responder: Box<tauri::ipc::OwnedInvokeResponder<Wry>> =
            Box::new(move |_webview, _cmd, response, _callback, _error| {
                let result = match response {
                    InvokeResponse::Ok(body) => {
                        let value = match body {
                            InvokeResponseBody::Json(json_str) => {
                                serde_json::from_str(&json_str).unwrap_or(Value::Null)
                            }
                            InvokeResponseBody::Raw(bytes) => {
                                // Raw bytes → base64 인코딩
                                use base64::Engine;
                                Value::String(
                                    base64::engine::general_purpose::STANDARD.encode(&bytes),
                                )
                            }
                        };
                        Ok(value)
                    }
                    InvokeResponse::Err(err) => Err(err.0),
                };
                let _ = rpc_tx.send((request_id, result));
            });

        log::debug!("[ObsBridge] {addr_clone}: invoke cmd={cmd}");
        webview_window.on_message(request, responder);
    }

    /// /media/<base64url-encoded-path>?token=xxx — 사용자 로컬 미디어 파일 서빙
    async fn handle_media_request(&self, stream: &mut TcpStream, rest: &str) {
        use base64::Engine;

        // 경로와 쿼리 분리: "base64path?token=xxx"
        let (encoded, query) = rest.split_once('?').unwrap_or((rest, ""));

        // 토큰 검증
        let expected_token = self.session_token.read().clone();
        if !expected_token.is_empty() {
            let client_token = query
                .split('&')
                .find_map(|pair| pair.strip_prefix("token="))
                .unwrap_or("");
            if client_token != expected_token {
                let _ = stream
                    .write_all(
                        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
                return;
            }
        }

        // URL 디코딩 (%2F 등) + base64url → 절대 파일 경로
        let decoded_url = percent_decode(encoded);
        let file_path = match base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(decoded_url.as_bytes())
        {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(path) => PathBuf::from(path),
                Err(_) => {
                    let _ = stream
                        .write_all(
                            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .await;
                    return;
                }
            },
            Err(_) => {
                let _ = stream
                    .write_all(
                        b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
                return;
            }
        };

        if !file_path.is_absolute() {
            write_empty_http_response(stream, "403 Forbidden").await;
            return;
        }

        let app_data_dir = self
            .app_handle
            .read()
            .clone()
            .and_then(|app| app.path().app_data_dir().ok());
        let Some(app_data_dir) = app_data_dir else {
            write_empty_http_response(stream, "403 Forbidden").await;
            return;
        };
        let canonical_app_data = match tokio::fs::canonicalize(app_data_dir).await {
            Ok(path) => path,
            Err(error) => {
                log::warn!("[ObsBridge] app data 경로 확인 실패: {error}");
                write_empty_http_response(stream, "403 Forbidden").await;
                return;
            }
        };
        let canonical_file_path = match tokio::fs::canonicalize(&file_path).await {
            Ok(path) => path,
            Err(_) => {
                write_empty_http_response(stream, "404 Not Found").await;
                return;
            }
        };
        if !canonical_file_path.starts_with(&canonical_app_data) {
            log::warn!(
                "[ObsBridge] app data 밖 media 요청 차단: {}",
                file_path.display()
            );
            write_empty_http_response(stream, "403 Forbidden").await;
            return;
        }

        // 허용 확장자 화이트리스트 (미디어/폰트 파일만)
        let ext = canonical_file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            ext.as_str(),
            "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "svg"
                | "mp4"
                | "webm"
                | "ogg"
                | "woff"
                | "woff2"
                | "ttf"
                | "otf"
        ) {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            return;
        }

        // 파일 읽기 및 서빙
        match tokio::fs::read(&canonical_file_path).await {
            Ok(content) => {
                let mime = guess_mime(&canonical_file_path.to_string_lossy());
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: max-age=3600\r\nConnection: close\r\n\r\n",
                    content.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.write_all(&content).await;
            }
            Err(_) => {
                let _ = stream
                    .write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
            }
        }
    }
}

/// 파일 확장자로 MIME 타입 추정
fn guess_mime(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ogg" => "video/ogg",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// 간단한 percent-decoding (%XX → 바이트)
fn percent_decode(input: &str) -> String {
    let mut result = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                result.push(byte);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&result).into_owned()
}

/// ObsBroadcast → JSON envelope 변환
fn broadcast_to_envelope(broadcast: &ObsBroadcast, seq: u64) -> Value {
    match broadcast {
        ObsBroadcast::Snapshot(snapshot) => make_envelope("snapshot", seq, snapshot.clone()),
        ObsBroadcast::TauriEvent { event, data } => make_envelope(
            "tauri_event",
            seq,
            serde_json::json!({ "event": event, "data": data }),
        ),
        ObsBroadcast::Shutdown => unreachable!("Shutdown은 직접 처리됨"),
    }
}

#[cfg(test)]
mod tests;
