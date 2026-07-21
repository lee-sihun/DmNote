use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EditorCommitErrorCode {
    RevisionConflict,
    ValidationFailed,
    TooManyGestureIds,
    InvalidGestureId,
    PairedUpdateRequired,
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
