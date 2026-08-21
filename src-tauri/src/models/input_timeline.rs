use serde::Serialize;

use super::KeyCounters;

pub const CANONICAL_INPUT_TIMELINE_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalInputTimelineBatch {
    pub version: u8,
    pub stream_id: String,
    /// batch 연속성 검사용 revision. JavaScript 정밀도 보존을 위해 문자열 사용.
    pub revision: String,
    /// batch가 포함하는 source watermark revision.
    pub source_revision: String,
    /// 데몬 source monotonic 시각(us). JavaScript 정밀도 보존을 위해 문자열 사용.
    pub safe_through_us: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline: Option<CanonicalInputTimelineBaseline>,
    pub actions: Vec<CanonicalInputTimelineAction>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalInputTimelineBaseline {
    pub mode: String,
    pub active_keys: Vec<String>,
    pub counters: KeyCounters,
    pub counter_session_id: String,
    pub counter_revision: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CanonicalInputTimelineAction {
    State {
        press_id: String,
        mode: String,
        key: String,
        state: CanonicalInputState,
        event_time_us: String,
    },
    Counter {
        mode: String,
        key: String,
        count: u32,
        counter_session_id: String,
        counter_revision: String,
        event_time_us: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum CanonicalInputState {
    Down,
    Up,
}
