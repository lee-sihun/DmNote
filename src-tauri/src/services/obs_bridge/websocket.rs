use serde_json::Value;

use crate::models::obs::{make_envelope, HelloAckPayload, ObsBroadcast};

use super::rpc::{build_allowed_list, RpcResult};

pub(super) struct WebSocketSessionProtocol {
    next_sequence: u64,
}

impl WebSocketSessionProtocol {
    pub(super) fn new() -> Self {
        Self { next_sequence: 0 }
    }

    fn next_seq(&mut self) -> u64 {
        let seq = self.next_sequence;
        self.next_sequence += 1;
        seq
    }

    fn envelope(&mut self, msg_type: &str, payload: Value) -> Value {
        make_envelope(msg_type, self.next_seq(), payload)
    }

    pub(super) fn hello_ack(&mut self, server_version: String) -> Value {
        let payload = serde_json::to_value(HelloAckPayload {
            server_version,
            obs_mode: true,
            allowed_list: build_allowed_list(),
        })
        .unwrap_or_default();
        self.envelope("hello_ack", payload)
    }

    pub(super) fn snapshot(&mut self, snapshot: Value) -> Value {
        self.envelope("snapshot", snapshot)
    }

    pub(super) fn broadcast(&mut self, broadcast: &ObsBroadcast) -> Value {
        match broadcast {
            ObsBroadcast::Snapshot(snapshot) => self.envelope("snapshot", snapshot.clone()),
            ObsBroadcast::TauriEvent { event, data } => self.envelope(
                "tauri_event",
                serde_json::json!({ "event": event, "data": data }),
            ),
            ObsBroadcast::Shutdown => unreachable!("Shutdown은 직접 처리됨"),
        }
    }

    pub(super) fn pong(&mut self) -> Value {
        self.envelope("pong", Value::Null)
    }

    pub(super) fn invoke_response(&mut self, request_id: String, result: RpcResult) -> Value {
        let payload = match result {
            Ok(data) => serde_json::json!({ "requestId": request_id, "result": data }),
            Err(err) => serde_json::json!({ "requestId": request_id, "error": err }),
        };
        self.envelope("invoke_response", payload)
    }

    pub(super) fn ping(&mut self) -> Value {
        self.envelope("ping", Value::Null)
    }
}

#[cfg(test)]
mod tests;
