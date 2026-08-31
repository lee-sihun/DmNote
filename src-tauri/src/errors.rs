use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PanelDragErrorCode {
    InvalidGeometry,
    MonitorUnavailable,
    PanelNotOpen,
    PresentFailed,
    DragStartFailed,
    DragStartNotObserved,
}

impl PanelDragErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidGeometry => "INVALID_GEOMETRY",
            Self::MonitorUnavailable => "MONITOR_UNAVAILABLE",
            Self::PanelNotOpen => "PANEL_NOT_OPEN",
            Self::PresentFailed => "PRESENT_FAILED",
            Self::DragStartFailed => "DRAG_START_FAILED",
            Self::DragStartNotObserved => "DRAG_START_NOT_OBSERVED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanelDragError {
    pub error_code: PanelDragErrorCode,
    pub message: String,
}

impl PanelDragError {
    pub fn new(error_code: PanelDragErrorCode, message: impl Into<String>) -> Self {
        Self {
            error_code,
            message: format!("{}: {}", error_code.as_str(), message.into()),
        }
    }
}

impl std::fmt::Display for PanelDragError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for PanelDragError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EditorCommitErrorCode {
    RevisionConflict,
    PluginRevisionConflict,
    ValidationFailed,
    TooManyGestureIds,
    InvalidGestureId,
    PairedUpdateRequired,
    MultiKeyUnsupported,
    MutationIdReused,
    HistoryInProgress,
    HistoryEpochConflict,
    IoError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EditorCommitErrorDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_history_epoch: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCommitError {
    pub error_code: EditorCommitErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<EditorCommitErrorDetails>,
    pub retryable: bool,
}

impl EditorCommitError {
    pub fn revision_conflict(current_revision: u64) -> Self {
        Self {
            error_code: EditorCommitErrorCode::RevisionConflict,
            message: "editor revision conflict".to_string(),
            details: Some(EditorCommitErrorDetails {
                current_revision: Some(current_revision),
                ..EditorCommitErrorDetails::default()
            }),
            retryable: true,
        }
    }

    pub fn plugin_revision_conflict(current_plugin_model_revision: u64) -> Self {
        Self {
            error_code: EditorCommitErrorCode::PluginRevisionConflict,
            message: format!(
                "plugin model revision conflict at revision {current_plugin_model_revision}"
            ),
            details: None,
            retryable: true,
        }
    }

    pub fn validation(validation_code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error_code: EditorCommitErrorCode::ValidationFailed,
            message: message.into(),
            details: Some(EditorCommitErrorDetails {
                validation_code: Some(validation_code.into()),
                ..EditorCommitErrorDetails::default()
            }),
            retryable: false,
        }
    }

    pub fn too_many_gesture_ids(max: usize) -> Self {
        Self {
            error_code: EditorCommitErrorCode::TooManyGestureIds,
            message: format!("gesture ID count exceeds {max}"),
            details: None,
            retryable: false,
        }
    }

    pub fn invalid_gesture_id() -> Self {
        Self {
            error_code: EditorCommitErrorCode::InvalidGestureId,
            message: "gesture IDs must be UUIDs no longer than 64 bytes".to_string(),
            details: None,
            retryable: false,
        }
    }

    pub fn paired_update_required(field: impl Into<String>) -> Self {
        let field = field.into();
        Self {
            error_code: EditorCommitErrorCode::PairedUpdateRequired,
            message: format!("{field} must be updated with its paired field"),
            details: Some(EditorCommitErrorDetails {
                field: Some(field),
                ..EditorCommitErrorDetails::default()
            }),
            retryable: false,
        }
    }

    pub fn multi_key_unsupported() -> Self {
        Self {
            error_code: EditorCommitErrorCode::MultiKeyUnsupported,
            message: "multi-key mappings require an explicit multiKey capability".to_string(),
            details: None,
            retryable: false,
        }
    }

    pub fn mutation_id_reused() -> Self {
        Self {
            error_code: EditorCommitErrorCode::MutationIdReused,
            message: "mutationId was reused with a different request".to_string(),
            details: None,
            retryable: false,
        }
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self {
            error_code: EditorCommitErrorCode::IoError,
            message: message.into(),
            details: None,
            retryable: true,
        }
    }

    pub fn history_in_progress() -> Self {
        Self {
            error_code: EditorCommitErrorCode::HistoryInProgress,
            message: "history operation is in progress".to_string(),
            details: None,
            retryable: true,
        }
    }

    pub fn history_epoch_conflict(current_history_epoch: u64) -> Self {
        Self {
            error_code: EditorCommitErrorCode::HistoryEpochConflict,
            message: "history epoch conflict".to_string(),
            details: Some(EditorCommitErrorDetails {
                current_history_epoch: Some(current_history_epoch),
                ..EditorCommitErrorDetails::default()
            }),
            retryable: true,
        }
    }
}

impl std::fmt::Display for EditorCommitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for EditorCommitError {}

/// Tauri 커맨드 통합 에러 타입
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("{0}")]
    Message(String),

    #[error(transparent)]
    Anyhow(#[from] anyhow::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    #[error(transparent)]
    Editor(#[from] EditorCommitError),

    #[error(transparent)]
    PanelDrag(#[from] PanelDragError),
}

impl CommandError {
    /// 도메인 코드 문자열 에러 생성 ("invalid-preset", "not-found" 등)
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

// Tauri 커맨드는 에러 타입에 Serialize 필수
// 프론트 호환성을 위해 문자열로 직렬화
impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Editor(error) => error.serialize(serializer),
            _ => serializer.serialize_str(&self.to_string()),
        }
    }
}

/// 커맨드 반환 타입 별칭
pub type CmdResult<T> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use super::*;

    // TS 재시도 정책 테이블(src/types/editor.ts)과 공유하는 fixture
    const RETRY_FIXTURE: &str = include_str!("../../tests/fixtures/editor-error-retry.json");

    // TS 용량 코드 집합(src/types/editor.ts)과 공유하는 fixture
    const CAPACITY_FIXTURE: &str = include_str!("../../tests/fixtures/editor-capacity-codes.json");

    // VALIDATION_FAILED의 details.validationCode 중 "저장 한도 초과" 계열 전수.
    // 여기 없는 코드는 프론트에서 한도 안내 대신 일반 오류 안내로 표시된다
    const CAPACITY_VALIDATION_CODES: &[&str] = &[
        "COLLECTION_TOO_LARGE",
        "FROZEN_INSERT_BATCH_TOO_LARGE",
        "HISTORY_ENTRY_TOO_LARGE",
        "INVALID_ELEMENT_GROUP_TARGET_COUNT",
        "PLUGIN_INSTANCES_REQUEST_TOO_LARGE",
        "REORDER_BATCH_TOO_LARGE",
        "REQUEST_TOO_LARGE",
        "TOO_MANY_CUSTOM_TABS",
        "TOO_MANY_EDITOR_OPS",
        "TOO_MANY_LAYER_GROUPS",
        "TOO_MANY_MODES",
        "TOO_MANY_PLUGIN_INSTANCES",
        "TOO_MANY_RENDER_ITEMS",
        "TOO_MANY_SLOTS_PER_MEMBER",
    ];

    // 한도 헬퍼를 쓰는 소스. 손목록끼리만 대조하면 백엔드에 새 한도 코드가
    // 생겨도 전부 green이라, 실제 호출부를 스캔해 결합한다
    const EDITOR_SOURCE: &str = include_str!("state/editor.rs");
    const EDITOR_LIMITS_SOURCE: &str = include_str!("state/editor/limits.rs");
    const PLUGIN_SOURCE: &str = include_str!("state/plugin.rs");

    /// 용량 목록에 넣지 않는 한도 코드와 사유. 새 한도 코드는 목록에 넣거나
    /// 여기에 사유와 함께 등록해야 한다
    const NON_CAPACITY_LIMIT_CODES: &[(&str, &str)] = &[
        (
            "MODE_ID_TOO_LONG",
            "길이 한도 - 요소를 줄이라는 안내와 무관",
        ),
        ("GROUP_ID_TOO_LONG", "길이 한도"),
        ("GROUP_NAME_TOO_LONG", "길이 한도"),
        (
            "PLUGIN_INSTANCES_RECONCILE_REQUEST_TOO_LARGE",
            "reconcile 경로 - editor 커밋 오류로 승격되지 않음",
        ),
        (
            "STORED_PLUGIN_INSTANCES_TOO_LARGE",
            "저장 데이터 읽기 - INVALID_GESTURE_PLUGIN으로 덮임",
        ),
        (
            "PLUGIN_RPC_REQUEST_TOO_LARGE",
            "plugin RPC - CommandError로만 나감",
        ),
        (
            "PLUGIN_RPC_RESPONSE_TOO_LARGE",
            "plugin RPC - CommandError로만 나감",
        ),
    ];

    fn limit_codes_in(source: &str) -> Vec<String> {
        let mut codes = Vec::new();
        for helper in ["validate_count_limit(", "validate_compact_size("] {
            let mut rest = source;
            while let Some(at) = rest.find(helper) {
                rest = &rest[at + helper.len()..];
                let window = &rest[..rest.len().min(400)];
                if let Some(start) = window.find('"') {
                    let tail = &window[start + 1..];
                    if let Some(end) = tail.find('"') {
                        let literal = &tail[..end];
                        if !literal.is_empty()
                            && literal
                                .chars()
                                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                        {
                            codes.push(literal.to_string());
                        }
                    }
                }
            }
        }
        codes
    }

    #[test]
    fn every_limit_helper_code_is_classified() {
        let mut found = limit_codes_in(EDITOR_SOURCE);
        found.extend(limit_codes_in(EDITOR_LIMITS_SOURCE));
        found.extend(limit_codes_in(PLUGIN_SOURCE));
        found.sort();
        found.dedup();
        assert!(
            !found.is_empty(),
            "한도 헬퍼 호출부를 하나도 찾지 못했다 - 스캐너가 깨졌다"
        );
        for code in &found {
            let classified = CAPACITY_VALIDATION_CODES.contains(&code.as_str())
                || NON_CAPACITY_LIMIT_CODES
                    .iter()
                    .any(|(excluded, _)| excluded == code);
            assert!(
                classified,
                "한도 코드 {code}가 용량 목록에도 제외 목록에도 없다. \
                 사용자에게 한도 안내가 필요하면 CAPACITY_VALIDATION_CODES에, \
                 아니면 사유와 함께 NON_CAPACITY_LIMIT_CODES에 등록할 것"
            );
        }
    }

    #[test]
    fn capacity_fixture_matches_backend_capacity_codes() {
        let fixture: Vec<String> =
            serde_json::from_str(CAPACITY_FIXTURE).expect("fixture must be valid json");
        let mut expected: Vec<String> = CAPACITY_VALIDATION_CODES
            .iter()
            .map(|code| (*code).to_string())
            .collect();
        expected.sort();
        let mut actual = fixture;
        actual.sort();
        assert_eq!(actual, expected);
    }

    #[test]
    fn capacity_codes_serialize_as_validation_failed_with_their_code() {
        for code in CAPACITY_VALIDATION_CODES {
            let wire = serde_json::to_value(EditorCommitError::validation(*code, "sample"))
                .expect("error must serialize");
            assert_eq!(wire["errorCode"], "VALIDATION_FAILED");
            assert_eq!(wire["retryable"], false);
            assert_eq!(wire["details"]["validationCode"], *code);
        }
    }

    // 생성자 표본, variant 추가 시 match가 컴파일 에러로 등록을 강제한다
    fn sample(code: EditorCommitErrorCode) -> EditorCommitError {
        match code {
            EditorCommitErrorCode::RevisionConflict => EditorCommitError::revision_conflict(1),
            EditorCommitErrorCode::PluginRevisionConflict => {
                EditorCommitError::plugin_revision_conflict(1)
            }
            EditorCommitErrorCode::ValidationFailed => {
                EditorCommitError::validation("SAMPLE", "sample")
            }
            EditorCommitErrorCode::TooManyGestureIds => EditorCommitError::too_many_gesture_ids(4),
            EditorCommitErrorCode::InvalidGestureId => EditorCommitError::invalid_gesture_id(),
            EditorCommitErrorCode::PairedUpdateRequired => {
                EditorCommitError::paired_update_required("keys")
            }
            EditorCommitErrorCode::MultiKeyUnsupported => {
                EditorCommitError::multi_key_unsupported()
            }
            EditorCommitErrorCode::MutationIdReused => EditorCommitError::mutation_id_reused(),
            EditorCommitErrorCode::HistoryInProgress => EditorCommitError::history_in_progress(),
            EditorCommitErrorCode::HistoryEpochConflict => {
                EditorCommitError::history_epoch_conflict(1)
            }
            EditorCommitErrorCode::IoError => EditorCommitError::io("io failure"),
        }
    }

    const ALL_CODES: [EditorCommitErrorCode; 11] = [
        EditorCommitErrorCode::RevisionConflict,
        EditorCommitErrorCode::PluginRevisionConflict,
        EditorCommitErrorCode::ValidationFailed,
        EditorCommitErrorCode::TooManyGestureIds,
        EditorCommitErrorCode::InvalidGestureId,
        EditorCommitErrorCode::PairedUpdateRequired,
        EditorCommitErrorCode::MultiKeyUnsupported,
        EditorCommitErrorCode::MutationIdReused,
        EditorCommitErrorCode::HistoryInProgress,
        EditorCommitErrorCode::HistoryEpochConflict,
        EditorCommitErrorCode::IoError,
    ];

    #[test]
    fn retry_fixture_matches_every_error_constructor() {
        let fixture: serde_json::Value =
            serde_json::from_str(RETRY_FIXTURE).expect("fixture must be valid json");
        let fixture = fixture.as_object().expect("fixture must be an object");
        assert_eq!(
            fixture.len(),
            ALL_CODES.len(),
            "fixture code count must match enum variants"
        );
        for code in ALL_CODES {
            let error = sample(code);
            let wire = serde_json::to_value(&error).expect("error must serialize");
            let wire_code = wire["errorCode"]
                .as_str()
                .expect("errorCode must be a string");
            let expected = fixture
                .get(wire_code)
                .unwrap_or_else(|| panic!("fixture is missing {wire_code}"))
                .as_bool()
                .expect("fixture value must be a bool");
            assert_eq!(error.retryable, expected, "retryable drift for {wire_code}");
            assert_eq!(wire["retryable"], serde_json::json!(expected));
        }
    }
}
