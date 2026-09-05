use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::Arc,
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::ipc::Channel;
use uuid::Uuid;

use crate::state::history::{HistoryAdmission, HistoryAdmissionGate};

const PREVIEW_SCHEMA_VERSION: u16 = 1;
const MAX_PREVIEW_BYTES: usize = 64 * 1024;
const MAX_PREVIEW_TARGETS: usize = 512;
const TOMBSTONE_CAPACITY: usize = 1_024;
const MAX_ACTIVE_PREVIEW_SESSIONS: usize = TOMBSTONE_CAPACITY;

// keyPositionSchema(src/types/key/keys.ts) 필드와 동기 유지
// 제외: count(런타임 파생), layerName·groupId(식별자, 프리뷰 대상 아님)
const KEY_POSITION_PATCH_FIELDS: &[&str] = &[
    "dx",
    "dy",
    "width",
    "height",
    "hidden",
    "activeImage",
    "inactiveImage",
    "soundEnabled",
    "soundPath",
    "soundVolume",
    "activeTransparent",
    "idleTransparent",
    "noteColor",
    "noteOpacity",
    "noteOpacityTop",
    "noteOpacityBottom",
    "noteBorderRadius",
    "noteWidth",
    "noteAlignment",
    "noteEffectEnabled",
    "noteGlowEnabled",
    "noteGlowSyncPaint",
    "noteGlowSize",
    "noteGlowOpacity",
    "noteGlowOpacityTop",
    "noteGlowOpacityBottom",
    "noteGlowColor",
    "noteAutoYCorrection",
    "noteOffsetX",
    "noteOffsetY",
    "noteBorderWidth",
    "noteBorderColor",
    "noteBorderOpacity",
    "noteBorderSide",
    "className",
    "zIndex",
    "counter",
    "backgroundColor",
    "activeBackgroundColor",
    "borderColor",
    "activeBorderColor",
    "backgroundGradient",
    "activeBackgroundGradient",
    "borderGradient",
    "activeBorderGradient",
    "borderWidth",
    "borderRadius",
    "shadow",
    "activeShadow",
    "fontSize",
    "fontColor",
    "activeFontColor",
    "fontGradient",
    "activeFontGradient",
    "graphAnimationEnabled",
    "fontFamily",
    "idleImageFit",
    "activeImageFit",
    "imageFit",
    "idleImageTransform",
    "activeImageTransform",
    "useInlineStyles",
    "displayText",
    "fontWeight",
    "fontItalic",
    "fontUnderline",
    "fontStrikethrough",
];

const SPRITE_POSITION_PATCH_FIELDS: &[&str] = &[
    "dx",
    "dy",
    "width",
    "height",
    "pivot",
    "idleTransform",
    "poses",
    "pressDurationMs",
    "transitionMs",
    "transitionEasing",
    "baseImage",
    "referenceNaturalSize",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewKind {
    Patch,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::enum_variant_names)]
pub enum PreviewDomain {
    KeyPosition,
    StatPosition,
    GraphPosition,
    KnobPosition,
    SpritePosition,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewEnvelope {
    pub schema_version: u16,
    pub session_id: String,
    pub seq: u64,
    pub kind: PreviewKind,
    pub source_label: String,
    pub domain: PreviewDomain,
    pub mode: String,
    pub targets: Vec<u32>,
    pub patch: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewPublishRequest {
    pub schema_version: u16,
    pub session_id: String,
    pub seq: u64,
    #[serde(default = "patch_kind")]
    pub kind: PreviewKind,
    pub domain: PreviewDomain,
    pub mode: String,
    pub targets: Vec<u32>,
    pub patch: Map<String, Value>,
}

struct ChannelRegistration {
    generation: u64,
    channel: Channel<PreviewEnvelope>,
}

struct PreviewSession {
    owner: String,
    generation: u64,
    last_seq: u64,
}

#[derive(Default)]
struct BrokerState {
    next_generation: u64,
    channels: HashMap<String, ChannelRegistration>,
    sessions: HashMap<String, PreviewSession>,
    tombstones: HashSet<String>,
    tombstone_order: VecDeque<String>,
}

pub struct PreviewBroker {
    state: Mutex<BrokerState>,
    history_gate: Arc<HistoryAdmissionGate>,
}

fn patch_kind() -> PreviewKind {
    PreviewKind::Patch
}

impl PreviewBroker {
    #[allow(dead_code)]
    pub(crate) fn new(history_gate: Arc<HistoryAdmissionGate>) -> Self {
        Self {
            state: Mutex::new(BrokerState::default()),
            history_gate,
        }
    }

    pub fn subscribe(&self, label: &str, channel: Channel<PreviewEnvelope>) -> Result<u64, String> {
        let admission = self.history_gate.try_admit()?;
        self.subscribe_after_admission(label, channel, admission)
    }

    fn subscribe_after_admission(
        &self,
        label: &str,
        channel: Channel<PreviewEnvelope>,
        admission: HistoryAdmission,
    ) -> Result<u64, String> {
        let (generation, recipients, cancellations) = {
            let mut state = self.state.lock();
            self.history_gate.revalidate(admission)?;
            let generation = state
                .next_generation
                .checked_add(1)
                .ok_or_else(|| "preview registration generation overflow".to_string())?;
            state.next_generation = generation;
            state.channels.insert(
                label.to_string(),
                ChannelRegistration {
                    generation,
                    channel,
                },
            );

            let cancellations = cancel_owned_sessions(&mut state, label, Some(generation));
            let recipients = clone_channels(&state, None);
            (generation, recipients, cancellations)
        };

        send_envelopes(&recipients, &cancellations);
        Ok(generation)
    }

    pub fn publish(&self, label: &str, request: PreviewPublishRequest) -> Result<(), String> {
        validate_publish_request(&request)?;
        let envelope = PreviewEnvelope {
            schema_version: request.schema_version,
            session_id: request.session_id.clone(),
            seq: request.seq,
            kind: request.kind,
            source_label: label.to_string(),
            domain: request.domain,
            mode: request.mode,
            targets: request.targets,
            patch: request.patch,
        };
        validate_payload_size(&envelope)?;

        let admission = self.history_gate.try_admit()?;
        self.publish_after_admission(label, envelope, admission)
    }

    fn publish_after_admission(
        &self,
        label: &str,
        envelope: PreviewEnvelope,
        admission: HistoryAdmission,
    ) -> Result<(), String> {
        let recipients = {
            let mut state = self.state.lock();
            self.history_gate.revalidate(admission)?;
            if state.tombstones.contains(&envelope.session_id) {
                return Err("preview session has already ended".to_string());
            }

            let generation = state
                .channels
                .get(label)
                .map(|registration| registration.generation)
                .ok_or_else(|| "preview publisher is not subscribed".to_string())?;

            match state.sessions.get_mut(&envelope.session_id) {
                Some(session) => {
                    if session.owner != label {
                        return Err("preview session is owned by another window".to_string());
                    }
                    if session.generation != generation {
                        return Err("preview session registration is stale".to_string());
                    }
                    if envelope.seq <= session.last_seq {
                        return Err("preview sequence must increase monotonically".to_string());
                    }
                    session.last_seq = envelope.seq;
                }
                None => {
                    if state.sessions.len() >= MAX_ACTIVE_PREVIEW_SESSIONS {
                        return Err(format!(
                            "active preview session count exceeds {MAX_ACTIVE_PREVIEW_SESSIONS}"
                        ));
                    }
                    state.sessions.insert(
                        envelope.session_id.clone(),
                        PreviewSession {
                            owner: label.to_string(),
                            generation,
                            last_seq: envelope.seq,
                        },
                    );
                }
            }

            clone_channels(&state, Some(label))
        };

        send_envelopes(&recipients, &[envelope]);
        Ok(())
    }

    pub(crate) fn cancel_all(&self) -> usize {
        let (recipients, cancellations) = {
            let mut state = self.state.lock();
            let session_ids = state.sessions.keys().cloned().collect::<Vec<_>>();
            let cancellations = session_ids
                .into_iter()
                .filter_map(|session_id| {
                    let session = state.sessions.remove(&session_id)?;
                    insert_tombstone(&mut state, session_id.clone());
                    Some(cancellation_envelope(&session_id, &session))
                })
                .collect::<Vec<_>>();
            let recipients = clone_channels(&state, None);
            (recipients, cancellations)
        };
        let cancelled = cancellations.len();
        send_envelopes(&recipients, &cancellations);
        cancelled
    }

    pub fn cancel(&self, label: &str, session_id: &str) -> Result<(), String> {
        validate_session_id(session_id)?;
        let (recipients, envelope) = {
            let mut state = self.state.lock();
            if state.tombstones.contains(session_id) {
                return Err("preview session has already ended".to_string());
            }
            let session = match state.sessions.get(session_id) {
                Some(session) => {
                    if session.owner != label {
                        return Err("preview session is owned by another window".to_string());
                    }
                    state
                        .sessions
                        .remove(session_id)
                        .expect("preview session exists after ownership validation")
                }
                None => {
                    let generation = state
                        .channels
                        .get(label)
                        .map(|registration| registration.generation)
                        .ok_or_else(|| "preview canceller is not subscribed".to_string())?;
                    PreviewSession {
                        owner: label.to_string(),
                        generation,
                        last_seq: 0,
                    }
                }
            };
            insert_tombstone(&mut state, session_id.to_string());
            let recipients = clone_channels(&state, Some(label));
            (recipients, cancellation_envelope(session_id, &session))
        };

        send_envelopes(&recipients, &[envelope]);
        Ok(())
    }

    pub fn finish_committed_session(
        &self,
        label: &str,
        session_id: &str,
        broadcast_cancel: bool,
    ) -> Result<bool, String> {
        if Uuid::parse_str(session_id).is_err() {
            return Ok(false);
        }
        let (recipients, cancellation) = {
            let mut state = self.state.lock();
            if state.tombstones.contains(session_id) {
                return Ok(false);
            }
            let session = match state.sessions.get(session_id) {
                Some(session) => {
                    if session.owner != label {
                        return Err("preview session is owned by another window".to_string());
                    }
                    state
                        .sessions
                        .remove(session_id)
                        .expect("preview session exists after ownership validation")
                }
                None => PreviewSession {
                    owner: label.to_string(),
                    generation: state
                        .channels
                        .get(label)
                        .map_or(0, |registration| registration.generation),
                    last_seq: 0,
                },
            };
            insert_tombstone(&mut state, session_id.to_string());
            let recipients = if broadcast_cancel {
                clone_channels(&state, Some(label))
            } else {
                Vec::new()
            };
            let cancellation =
                broadcast_cancel.then(|| cancellation_envelope(session_id, &session));
            (recipients, cancellation)
        };

        if let Some(cancellation) = cancellation {
            send_envelopes(&recipients, &[cancellation]);
        }
        Ok(true)
    }

    pub fn remove_label(&self, label: &str) {
        let (recipients, cancellations) = {
            let mut state = self.state.lock();
            state.channels.remove(label);
            let cancellations = cancel_owned_sessions(&mut state, label, None);
            let recipients = clone_channels(&state, None);
            (recipients, cancellations)
        };

        send_envelopes(&recipients, &cancellations);
    }
}

#[cfg(test)]
impl Default for PreviewBroker {
    fn default() -> Self {
        Self::new(Arc::new(HistoryAdmissionGate::default()))
    }
}

fn validate_publish_request(request: &PreviewPublishRequest) -> Result<(), String> {
    if request.schema_version != PREVIEW_SCHEMA_VERSION {
        return Err("unsupported preview schema version".to_string());
    }
    if request.kind != PreviewKind::Patch {
        return Err("editor_preview_publish only accepts patch messages".to_string());
    }
    validate_session_id(&request.session_id)?;
    if request.targets.len() > MAX_PREVIEW_TARGETS {
        return Err(format!(
            "preview target count exceeds {MAX_PREVIEW_TARGETS}"
        ));
    }
    let allowed_fields = match request.domain {
        PreviewDomain::SpritePosition => SPRITE_POSITION_PATCH_FIELDS,
        _ => KEY_POSITION_PATCH_FIELDS,
    };
    if let Some(field) = request
        .patch
        .keys()
        .find(|field| !allowed_fields.contains(&field.as_str()))
    {
        return Err(format!("preview patch field '{field}' is not allowed"));
    }
    for (field, value) in &request.patch {
        if field.ends_with("Gradient") {
            validate_preview_gradient(field, value)?;
        }
    }
    validate_payload_size(request)
}

// 그라데이션 프리뷰 구조 검증 - 커밋 검증(validate_paint_gradient)의 프리뷰 대응.
// 수신 창이 stops를 그대로 CSS로 그리므로 형태가 깨진 값은 여기서 끊는다.
// 드래그 중 draft는 각도·순서가 canonical 이전일 수 있어 범위·정렬은 강제하지 않는다
fn validate_preview_gradient(field: &str, value: &Value) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    let Some(spec) = value.as_object() else {
        return Err(format!(
            "preview field '{field}' must be null or a gradient object"
        ));
    };
    let angle_ok = spec
        .get("angle")
        .and_then(Value::as_f64)
        .is_some_and(f64::is_finite);
    if !angle_ok {
        return Err(format!("preview field '{field}' must carry a finite angle"));
    }
    let Some(stops) = spec.get("stops").and_then(Value::as_array) else {
        return Err(format!("preview field '{field}' must carry gradient stops"));
    };
    if !(2..=8).contains(&stops.len()) {
        return Err(format!(
            "preview field '{field}' must contain between 2 and 8 stops"
        ));
    }
    for stop in stops {
        let color_ok = stop
            .get("color")
            .and_then(Value::as_str)
            .is_some_and(|color| !color.trim().is_empty());
        let pos_ok = stop
            .get("pos")
            .and_then(Value::as_f64)
            .is_some_and(|pos| pos.is_finite() && (0.0..=1.0).contains(&pos));
        if !color_ok || !pos_ok {
            return Err(format!(
                "preview field '{field}' stops must carry a color and a pos between 0 and 1"
            ));
        }
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    Uuid::parse_str(session_id)
        .map(|_| ())
        .map_err(|_| "preview sessionId must be a UUID".to_string())
}

fn validate_payload_size(payload: &impl Serialize) -> Result<(), String> {
    let size = serde_json::to_vec(payload)
        .map_err(|error| format!("failed to serialize preview payload: {error}"))?
        .len();
    if size > MAX_PREVIEW_BYTES {
        return Err(format!(
            "preview payload exceeds the {MAX_PREVIEW_BYTES} byte limit"
        ));
    }
    Ok(())
}

fn clone_channels(
    state: &BrokerState,
    excluded_label: Option<&str>,
) -> Vec<Channel<PreviewEnvelope>> {
    state
        .channels
        .iter()
        .filter(|(label, _)| excluded_label != Some(label.as_str()))
        .map(|(_, registration)| registration.channel.clone())
        .collect()
}

fn cancel_owned_sessions(
    state: &mut BrokerState,
    label: &str,
    current_generation: Option<u64>,
) -> Vec<PreviewEnvelope> {
    let session_ids: Vec<String> = state
        .sessions
        .iter()
        .filter(|(_, session)| {
            session.owner == label && current_generation != Some(session.generation)
        })
        .map(|(session_id, _)| session_id.clone())
        .collect();

    session_ids
        .into_iter()
        .filter_map(|session_id| {
            let session = state.sessions.remove(&session_id)?;
            insert_tombstone(state, session_id.clone());
            Some(cancellation_envelope(&session_id, &session))
        })
        .collect()
}

fn cancellation_envelope(session_id: &str, session: &PreviewSession) -> PreviewEnvelope {
    PreviewEnvelope {
        schema_version: PREVIEW_SCHEMA_VERSION,
        session_id: session_id.to_string(),
        seq: session.last_seq.saturating_add(1),
        kind: PreviewKind::Cancel,
        source_label: session.owner.clone(),
        domain: PreviewDomain::KeyPosition,
        mode: String::new(),
        targets: Vec::new(),
        patch: Map::new(),
    }
}

fn insert_tombstone(state: &mut BrokerState, session_id: String) {
    if !state.tombstones.insert(session_id.clone()) {
        return;
    }
    state.tombstone_order.push_back(session_id);
    while state.tombstone_order.len() > TOMBSTONE_CAPACITY {
        if let Some(expired) = state.tombstone_order.pop_front() {
            state.tombstones.remove(&expired);
        }
    }
}

fn send_envelopes(recipients: &[Channel<PreviewEnvelope>], envelopes: &[PreviewEnvelope]) {
    for envelope in envelopes {
        for recipient in recipients {
            if let Err(error) = recipient.send(envelope.clone()) {
                log::warn!("failed to send editor preview: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests;
