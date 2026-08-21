use serde::{Deserialize, Serialize};
use serde_json::Value;

/// WS 프로토콜 버전 (v3: canonical input timeline replay/rebase 추가)
pub const OBS_PROTOCOL_VERSION: u32 = 3;

/// 기본 OBS 포트
pub const DEFAULT_OBS_PORT: u16 = 34891;

// ── 공통 Envelope (수신 파싱용) ──

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct ObsEnvelope {
    #[serde(default)]
    pub v: u32,
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(default)]
    pub payload: Value,
}

// ── Payload 타입 ──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloAckPayload {
    pub server_version: String,
    pub obs_mode: bool,
    /// OBS 클라이언트에 전달할 정확 일치 allowlist
    pub allowed_list: Vec<String>,
}

/// invoke_request 페이로드 (클라이언트 → 서버)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeRequestPayload {
    pub request_id: String,
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

// ── 브로드캐스트 내부 메시지 (tokio::sync::broadcast용) ──

#[derive(Debug, Clone)]
pub enum ObsBroadcast {
    Snapshot(Value),
    /// 범용 Tauri 이벤트 포워딩 (event 이름 + JSON 데이터)
    TauriEvent {
        event: String,
        data: Value,
    },
    /// 서버 종료 신호 — 클라이언트 세션 종료용
    Shutdown,
}

/// OBS 연결 상태 (프론트엔드 표시용)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsStatus {
    pub running: bool,
    pub port: u16,
    pub client_count: u32,
    /// 세션 보안 토큰 (서버 시작 시 생성, WS hello에서 검증)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// 로컬 네트워크 IP (같은 네트워크 내 다른 PC 접속용)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_ip: Option<String>,
}

/// JSON envelope 생성 헬퍼
pub fn make_envelope(msg_type: &str, seq: u64, payload: Value) -> Value {
    serde_json::json!({
        "v": OBS_PROTOCOL_VERSION,
        "type": msg_type,
        "seq": seq,
        "ts": timestamp_ms(),
        "payload": payload,
    })
}

fn timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::HelloAckPayload;

    #[test]
    fn hello_ack_exposes_allowed_list() {
        let value = serde_json::to_value(HelloAckPayload {
            server_version: "test".to_string(),
            obs_mode: true,
            allowed_list: vec!["settings_get".to_string()],
        })
        .unwrap();

        assert_eq!(
            value.get("allowedList"),
            Some(&serde_json::json!(["settings_get"]))
        );
        assert!(value.get("denyList").is_none());
    }
}
