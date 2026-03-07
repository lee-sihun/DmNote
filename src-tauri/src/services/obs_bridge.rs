use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use parking_lot::RwLock;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, oneshot};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

use crate::models::obs::{
    make_envelope, HelloAckPayload, KeyEventPayload, KeyState, ObsBroadcast, ObsEnvelope, ObsStatus,
};

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
    /// 빌드된 OBS 정적 파일 경로 (dist/renderer/obs)
    static_dir: RwLock<Option<PathBuf>>,
    /// dev 모드 Vite dev server URL (예: "http://localhost:3400")
    dev_url: RwLock<Option<String>>,
    server_version: String,
    /// 세션 보안 토큰 (서버 시작 시 랜덤 생성)
    session_token: RwLock<String>,
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
            static_dir: RwLock::new(None),
            dev_url: RwLock::new(None),
            server_version: version.to_string(),
            session_token: RwLock::new(String::new()),
        }
    }

    pub fn set_static_dir(&self, dir: PathBuf) {
        *self.static_dir.write() = Some(dir);
    }

    pub fn set_dev_url(&self, url: String) {
        *self.dev_url.write() = Some(url);
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
        ObsStatus {
            running: self.is_running(),
            port: *self.port.read(),
            client_count: self.client_count(),
            token,
        }
    }

    pub fn update_snapshot(&self, snapshot: Value) {
        *self.cached_snapshot.write() = snapshot;
    }

    pub fn broadcast_key_event(&self, key: String, state: KeyState, mode: String) {
        let _ = self
            .broadcast_tx
            .send(ObsBroadcast::KeyEvent { key, state, mode });
    }

    pub fn broadcast_settings_diff(&self, diff: Value) {
        let _ = self.broadcast_tx.send(ObsBroadcast::SettingsDiff(diff));
    }

    #[allow(dead_code)] // v2: layout 변경 broadcast
    pub fn broadcast_layout_diff(&self, diff: Value) {
        let _ = self.broadcast_tx.send(ObsBroadcast::LayoutDiff(diff));
    }

    pub fn broadcast_counter_update(&self, data: Value) {
        let _ = self.broadcast_tx.send(ObsBroadcast::CounterUpdate(data));
    }

    /// 전체 스냅샷 재전송 (프리셋 로드 등 대규모 변경 시)
    pub fn broadcast_snapshot(&self) {
        let snapshot = self.cached_snapshot.read().clone();
        let _ = self.broadcast_tx.send(ObsBroadcast::Snapshot(snapshot));
    }

    /// WS 서버 시작
    pub async fn start(self: &Arc<Self>, port: u16) -> Result<(), String> {
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

        // 세션 토큰 생성 (UUID v4, 하이픈 제거 = 32자 hex)
        *self.session_token.write() = Uuid::new_v4().simple().to_string();

        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                self.running.store(false, Ordering::Relaxed);
                self.session_token.write().clear();
                return Err(format!("포트 {port} 바인드 실패: {e}"));
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

        log::info!("[ObsBridge] 서버 시작: http://127.0.0.1:{actual_port}");
        Ok(())
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
        self.session_token.write().clear();
        log::info!("[ObsBridge] 서버 종료");
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
        // TCP 스트림을 peek하여 WebSocket upgrade 요청인지 판별
        let mut peek_buf = [0u8; 4096];
        let n = match stream.peek(&mut peek_buf).await {
            Ok(n) if n > 0 => n,
            _ => return,
        };

        let request_preview = String::from_utf8_lossy(&peek_buf[..n]);
        let is_websocket = request_preview.lines().any(|line| {
            line.to_ascii_lowercase().starts_with("upgrade:")
                && line.to_ascii_lowercase().contains("websocket")
        });

        if is_websocket {
            // WebSocket 핸드셰이크
            let ws_stream = match tokio_tungstenite::accept_async(stream).await {
                Ok(ws) => ws,
                Err(e) => {
                    log::debug!("[ObsBridge] WS 핸드셰이크 실패 from {addr}: {e}");
                    return;
                }
            };
            self.handle_ws_client(ws_stream, addr).await;
        } else {
            // HTTP 정적 파일 서빙
            self.handle_http_request(&mut stream, &request_preview)
                .await;
        }
    }

    /// HTTP GET 요청에 대해 정적 파일 서빙
    async fn handle_http_request(&self, stream: &mut TcpStream, request: &str) {
        // 요청 소비 (peek 데이터를 실제로 읽어야 함)
        let mut discard = vec![0u8; request.len()];
        let _ = stream.read(&mut discard).await;

        // RwLockReadGuard를 await 전에 해제하기 위해 즉시 clone
        let static_dir = self.static_dir.read().clone();
        let dev_url = self.dev_url.read().clone();
        let static_dir = match static_dir.as_ref() {
            Some(dir) => dir.clone(),
            None => {
                // dev 모드: Vite dev server로 리다이렉트
                if let Some(dev_base) = &dev_url {
                    let path = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("/");
                    // /media/ 경로는 이미 위에서 처리됨 → 정적 파일만 리다이렉트
                    let obs_path = if path == "/" || path.is_empty() {
                        "/obs/index.html"
                    } else {
                        path
                    };
                    // OBS 정적 파일 경로가 /obs/로 시작하지 않으면 추가
                    let redirect_path = if obs_path.starts_with("/obs/") {
                        obs_path.to_string()
                    } else {
                        format!("/obs{obs_path}")
                    };
                    let location = format!("{dev_base}{redirect_path}");
                    let response = format!(
                        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    return;
                }
                let body = "OBS bridge: static directory not configured";
                let response = format!(
                    "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes()).await;
                return;
            }
        };

        // GET 경로 파싱
        let path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/");

        // /media/<base64-encoded-path>?token=xxx — 사용자 로컬 미디어 파일 서빙
        if let Some(rest) = path.strip_prefix("/media/") {
            self.handle_media_request(stream, rest).await;
            return;
        }

        // 경로 정규화: "/" → "obs/index.html", 디렉토리 탐색 방지
        // static_dir은 dist/renderer/ (obs/index.html이 ../assets/ 참조하므로)
        let normalized = if path == "/" || path.is_empty() {
            "obs/index.html"
        } else {
            path.trim_start_matches('/')
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

        let file_path = static_dir.join(normalized);

        // canonicalize 후 static_dir 하위인지 재검증
        if let Ok(canonical) = file_path.canonicalize() {
            if !canonical.starts_with(&static_dir) {
                let _ = stream
                    .write_all(
                        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
                return;
            }
        }

        match tokio::fs::read(&file_path).await {
            Ok(content) => {
                let mime = guess_mime(normalized);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                    content.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.write_all(&content).await;
            }
            Err(_) => {
                // 확장자가 있는 정적 리소스 요청은 SPA fallback 하지 않음 (404)
                let has_extension = normalized
                    .rsplit('/')
                    .next()
                    .map_or(false, |filename| filename.contains('.'));
                if has_extension {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                    return;
                }

                // SPA fallback: 확장자 없는 경로 → obs/index.html
                let index_path = static_dir.join("obs/index.html");
                match tokio::fs::read(&index_path).await {
                    Ok(content) => {
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                            content.len()
                        );
                        let _ = stream.write_all(response.as_bytes()).await;
                        let _ = stream.write_all(&content).await;
                    }
                    Err(_) => {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                    }
                }
            }
        }
    }

    async fn handle_ws_client(
        self: &Arc<Self>,
        ws: tokio_tungstenite::WebSocketStream<TcpStream>,
        addr: SocketAddr,
    ) {
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

        // hello_ack 전송
        let ack_payload = serde_json::to_value(HelloAckPayload {
            server_version: self.server_version.clone(),
            obs_mode: true,
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

        // 메인 루프: broadcast 수신 + 클라이언트 메시지 수신
        let mut ping_interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            tokio::select! {
                // broadcast 채널에서 메시지 수신 → 클라이언트에 전송
                result = broadcast_rx.recv() => {
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
                // 서버 주도 ping (연결 유지)
                _ = ping_interval.tick() => {
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

        // 허용 확장자 화이트리스트 (미디어/폰트 파일만)
        let ext = file_path
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
        match tokio::fs::read(&file_path).await {
            Ok(content) => {
                let mime = guess_mime(&file_path.to_string_lossy());
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
        ObsBroadcast::KeyEvent { key, state, mode } => {
            let payload = serde_json::to_value(KeyEventPayload {
                key: key.clone(),
                state: state.clone(),
                mode: mode.clone(),
            })
            .unwrap_or_default();
            make_envelope("key_event", seq, payload)
        }
        ObsBroadcast::SettingsDiff(diff) => make_envelope("settings_diff", seq, diff.clone()),
        ObsBroadcast::LayoutDiff(diff) => make_envelope("layout_diff", seq, diff.clone()),
        ObsBroadcast::CounterUpdate(data) => make_envelope("counter_update", seq, data.clone()),
        ObsBroadcast::Snapshot(snapshot) => make_envelope("snapshot", seq, snapshot.clone()),
        ObsBroadcast::Shutdown => unreachable!("Shutdown은 직접 처리됨"),
    }
}
