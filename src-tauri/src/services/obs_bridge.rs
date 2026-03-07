use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use parking_lot::RwLock;
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, oneshot};
use tokio_tungstenite::tungstenite::Message;

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
    /// 빌드된 OBS 정적 파일 경로 (dist/renderer/obs)
    static_dir: RwLock<Option<PathBuf>>,
    server_version: String,
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
            static_dir: RwLock::new(None),
            server_version: version.to_string(),
        }
    }

    #[allow(dead_code)] // v2: HTTP 정적 서빙
    pub fn set_static_dir(&self, dir: PathBuf) {
        *self.static_dir.write() = Some(dir);
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn client_count(&self) -> u32 {
        self.client_count.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> ObsStatus {
        ObsStatus {
            running: self.is_running(),
            port: *self.port.read(),
            client_count: self.client_count(),
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

        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                self.running.store(false, Ordering::Relaxed);
                return Err(format!("포트 {port} 바인드 실패: {e}"));
            }
        };

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        *self.shutdown_tx.write() = Some(shutdown_tx);
        *self.port.write() = port;

        let bridge = Arc::clone(self);
        tokio::spawn(async move {
            bridge.server_loop(listener, shutdown_rx).await;
        });

        log::info!("[ObsBridge] 서버 시작: ws://127.0.0.1:{port}/ws");
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
        self.running.store(false, Ordering::Relaxed);
    }

    async fn handle_connection(self: &Arc<Self>, stream: TcpStream, addr: SocketAddr) {
        let ws_stream = match tokio_tungstenite::accept_async(stream).await {
            Ok(ws) => ws,
            Err(_) => {
                // WS 핸드셰이크 실패 (일반 HTTP 등) — 현재는 무시
                // HTTP 정적 파일 서빙은 후속 구현 (hyper/axum 통합)
                log::debug!("[ObsBridge] non-WS connection from {addr}");
                return;
            }
        };
        self.handle_ws_client(ws_stream, addr).await;
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

        let _hello = match hello_result {
            Ok(Some(envelope)) => envelope,
            _ => {
                log::warn!("[ObsBridge] {addr}: hello 타임아웃 또는 연결 종료");
                self.client_count.fetch_sub(1, Ordering::Relaxed);
                return;
            }
        };

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
