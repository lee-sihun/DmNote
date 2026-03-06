use serde::Serialize;

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
        serializer.serialize_str(&self.to_string())
    }
}

/// 커맨드 반환 타입 별칭
pub type CmdResult<T> = Result<T, CommandError>;
