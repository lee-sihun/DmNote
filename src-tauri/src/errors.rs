use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OverlayResizeErrorCode {
    OverlayDimensionExceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayResizeErrorDetails {
    pub desired_width: f64,
    pub desired_height: f64,
    pub max_width: f64,
    pub max_height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayResizeError {
    pub error_code: OverlayResizeErrorCode,
    pub details: OverlayResizeErrorDetails,
    pub retryable: bool,
}

impl OverlayResizeError {
    pub fn dimension_exceeded(
        desired_width: f64,
        desired_height: f64,
        max_width: f64,
        max_height: f64,
    ) -> Self {
        Self {
            error_code: OverlayResizeErrorCode::OverlayDimensionExceeded,
            details: OverlayResizeErrorDetails {
                desired_width,
                desired_height,
                max_width,
                max_height,
            },
            retryable: false,
        }
    }
}

impl std::fmt::Display for OverlayResizeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "overlay dimensions {}x{} exceed maximum {}x{}",
            self.details.desired_width,
            self.details.desired_height,
            self.details.max_width,
            self.details.max_height
        )
    }
}

impl std::error::Error for OverlayResizeError {}

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
    OverlayResize(#[from] OverlayResizeError),
}

impl CommandError {
    /// 도메인 코드 문자열 에러 생성 ("invalid-preset", "not-found" 등)
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

// Tauri 커맨드는 에러 타입에 Serialize 필수
// 기존 오류는 문자열, 구조화 도메인 오류는 객체로 직렬화
impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Editor(error) => error.serialize(serializer),
            Self::OverlayResize(error) => error.serialize(serializer),
            _ => serializer.serialize_str(&self.to_string()),
        }
    }
}

/// 커맨드 반환 타입 별칭
pub type CmdResult<T> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use super::{CommandError, OverlayResizeError};
    use serde_json::json;
    use tauri::ipc::{InvokeError, InvokeResponse};

    fn expected_overlay_resize_error() -> serde_json::Value {
        json!({
            "errorCode": "OVERLAY_DIMENSION_EXCEEDED",
            "details": {
                "desiredWidth": 4097.0,
                "desiredHeight": 5000.0,
                "maxWidth": 4096.0,
                "maxHeight": 4096.0
            },
            "retryable": false
        })
    }

    #[test]
    fn overlay_resize_error_round_trips_with_the_wire_contract() {
        let error = OverlayResizeError::dimension_exceeded(4097.0, 5000.0, 4096.0, 4096.0);
        let serialized = serde_json::to_value(error).unwrap();

        assert_eq!(serialized, expected_overlay_resize_error());
        assert_eq!(
            serde_json::from_value::<OverlayResizeError>(serialized).unwrap(),
            error
        );
    }

    #[test]
    fn overlay_resize_error_reaches_invoke_rejection_as_an_object() {
        let error = OverlayResizeError::dimension_exceeded(4097.0, 5000.0, 4096.0, 4096.0);
        let response: InvokeResponse =
            Result::<(), CommandError>::Err(CommandError::from(error)).into();

        let InvokeResponse::Err(InvokeError(value)) = response else {
            panic!("overlay resize failure must reject the invoke");
        };
        assert_eq!(value, expected_overlay_resize_error());
    }
}
