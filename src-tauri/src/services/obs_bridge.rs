use std::io::Cursor;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use parking_lot::RwLock;
use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Manager, Wry};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, oneshot};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{ErrorResponse, Request as WsRequest, Response as WsResponse},
        http::{header, StatusCode},
        Message,
    },
    WebSocketStream,
};

use crate::models::obs::{
    make_envelope, HelloAckPayload, InvokeRequestPayload, ObsBroadcast, ObsEnvelope, ObsStatus,
    OBS_PROTOCOL_VERSION,
};

const MAX_HTTP_HEADER_SIZE: usize = 16 * 1024;

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

struct PrefixedStream {
    prefix: Cursor<Vec<u8>>,
    stream: TcpStream,
}

impl PrefixedStream {
    fn new(prefix: Vec<u8>, stream: TcpStream) -> Self {
        Self {
            prefix: Cursor::new(prefix),
            stream,
        }
    }
}

impl AsyncRead for PrefixedStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        let position = this.prefix.position() as usize;
        let prefix = this.prefix.get_ref();
        if position < prefix.len() {
            let count = (prefix.len() - position).min(buffer.remaining());
            buffer.put_slice(&prefix[position..position + count]);
            this.prefix.set_position((position + count) as u64);
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut this.stream).poll_read(cx, buffer)
    }
}

impl AsyncWrite for PrefixedStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.get_mut().stream).poll_write(cx, buffer)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_shutdown(cx)
    }
}

async fn read_http_request_headers(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];

    loop {
        if request.len() == MAX_HTTP_HEADER_SIZE {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "HTTP request headers too large",
            ));
        }

        let remaining = MAX_HTTP_HEADER_SIZE - request.len();
        let chunk_len = remaining.min(chunk.len());
        let read = stream.read(&mut chunk[..chunk_len]).await?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "incomplete HTTP request headers",
            ));
        }
        request.extend_from_slice(&chunk[..read]);

        if http_header_end(&request).is_some() {
            return Ok(request);
        }
    }
}

fn http_header_end(request: &[u8]) -> Option<usize> {
    request
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| position + 4)
}

fn http_header_values<'a>(request: &'a str, name: &str) -> Vec<&'a str> {
    request
        .lines()
        .skip(1)
        .take_while(|line| !line.trim_end_matches('\r').is_empty())
        .filter_map(|line| line.trim_end_matches('\r').split_once(':'))
        .filter_map(|(header_name, value)| {
            header_name
                .eq_ignore_ascii_case(name)
                .then_some(value.trim())
        })
        .collect()
}

fn is_websocket_upgrade_request(request: &str) -> bool {
    http_header_values(request, "upgrade").iter().any(|value| {
        value
            .split(',')
            .any(|token| token.trim().eq_ignore_ascii_case("websocket"))
    })
}

fn is_allowed_host_name(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    let ip_literal = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    ip_literal.parse::<IpAddr>().is_ok()
}

fn is_allowed_host_header(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }
    if is_allowed_host_name(value) {
        return true;
    }

    if let Some(closing_bracket) = value.find(']') {
        let (host, suffix) = value.split_at(closing_bracket + 1);
        return is_allowed_host_name(host)
            && suffix
                .strip_prefix(':')
                .is_some_and(|port| port.parse::<u16>().is_ok());
    }

    value
        .rsplit_once(':')
        .is_some_and(|(host, port)| is_allowed_host_name(host) && port.parse::<u16>().is_ok())
}

/// 이 머신 자신의 IP인지 판정 (loopback 또는 로컬 인터페이스에 실제 할당된 IP)
fn is_local_machine_ip(ip: &IpAddr) -> bool {
    if ip.is_loopback() {
        return true;
    }
    local_ip_address::list_afinet_netifas()
        .map(|interfaces| {
            interfaces
                .iter()
                .any(|(_, interface_ip)| interface_ip == ip)
        })
        .unwrap_or(false)
}

/// Origin은 브라우저가 강제하는 헤더 — 이 머신이 서빙한 페이지만 신뢰
/// (localhost/loopback 또는 로컬 인터페이스에 실제 할당된 IP만 허용, OWASP 권고 allowlist)
fn is_local_machine_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    let ip_literal = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    let Ok(ip) = ip_literal.parse::<IpAddr>() else {
        return false;
    };
    is_local_machine_ip(&ip)
}

fn is_allowed_origin(value: &str) -> bool {
    tauri::Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .is_some_and(|host| is_local_machine_host(&host))
}

fn has_allowed_http_host(request: &str) -> bool {
    let hosts = http_header_values(request, "host");
    hosts.len() == 1 && is_allowed_host_header(hosts[0])
}

fn validate_websocket_request(request: &WsRequest) -> Result<(), &'static str> {
    let hosts: Vec<_> = request.headers().get_all(header::HOST).iter().collect();
    if hosts.len() != 1 || !hosts[0].to_str().ok().is_some_and(is_allowed_host_header) {
        return Err("Invalid Host header");
    }

    let origins: Vec<_> = request.headers().get_all(header::ORIGIN).iter().collect();
    if origins.len() > 1
        || origins
            .first()
            .is_some_and(|origin| !origin.to_str().ok().is_some_and(is_allowed_origin))
    {
        return Err("Invalid Origin header");
    }

    Ok(())
}

fn websocket_forbidden_response(reason: &str) -> ErrorResponse {
    let mut response = ErrorResponse::new(Some(reason.to_string()));
    *response.status_mut() = StatusCode::FORBIDDEN;
    response
}

// OBS 모드는 같은 네트워크의 다른 PC 접속이 제품 계약 — 항상 전체 인터페이스에 바인딩
// (WS/미디어는 토큰 인증, 커맨드는 allowlist로 보호)
fn bind_address(port: u16) -> SocketAddr {
    SocketAddr::from(([0, 0, 0, 0], port))
}

async fn write_empty_http_response(stream: &mut TcpStream, status: &str) {
    let response = format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = stream.write_all(response.as_bytes()).await;
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
        if !self.is_running() || !FORWARDED_EVENTS.contains(&event) {
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
mod tests {
    use super::*;
    use tokio_tungstenite::{connect_async, MaybeTlsStream};

    type TestWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

    async fn receive_envelope(ws: &mut TestWebSocket, expected_type: &str) -> ObsEnvelope {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match ws.next().await {
                    Some(Ok(Message::Text(text))) => {
                        let envelope = serde_json::from_str::<ObsEnvelope>(&text)
                            .expect("OBS envelope 파싱 실패");
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
                        let envelope = serde_json::from_str::<ObsEnvelope>(&text)
                            .expect("OBS envelope 파싱 실패");
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
}
