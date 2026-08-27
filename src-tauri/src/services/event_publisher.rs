use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

pub fn publish_event<T: Serialize>(app: &AppHandle, event: &str, payload: T) {
    let value = match serde_json::to_value(payload) {
        Ok(value) => value,
        Err(error) => {
            log::error!("[EventPublisher] {event} payload serialization failed: {error}");
            return;
        }
    };

    if let Err(error) = app.emit(event, &value) {
        log::error!("[EventPublisher] Tauri emit failed for {event}: {error}");
    }

    if let Some(state) = app.try_state::<AppState>() {
        state.obs_bridge.publish(event, value);
    }
}
