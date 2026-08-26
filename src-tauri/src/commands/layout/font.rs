use serde::Serialize;
use std::{
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
};
use tauri::{Manager, WebviewWindow};

use crate::{
    commands::dialog::parented_file_dialog,
    errors::{CmdResult, CommandError},
    models::FontWeightRange,
    services::font_metadata::parse_font_metadata,
    state::image_asset::import_font_file,
};

/// 폰트 로드 결과 응답 타입
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weight_ranges: Vec<FontWeightRange>,
}

const INVALID_FONT_CONTENT: &str = "invalid-font-content";

/// 로컬 폰트 파일을 선택하고 폰트 이름/경로를 반환
/// 파일 경로만 저장하고, 프론트에서 `convertFileSrc` 기반으로 `@font-face`를 생성
#[tauri::command]
pub async fn font_load(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> CmdResult<FontLoadResponse> {
    let picked = parented_file_dialog(&window, "Fonts", &["ttf", "otf", "woff", "woff2"])
        .pick_file()
        .await;

    let Some(file) = picked else {
        return Ok(FontLoadResponse {
            success: false,
            error: None,
            error_code: None,
            font_name: None,
            font_path: None,
            weight_ranges: Vec::new(),
        });
    };
    let path = file.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || font_load_from_path(app, path))
        .await
        .map_err(|error| CommandError::msg(format!("font load task failed: {error}")))?
}

fn font_load_from_path(app: tauri::AppHandle, path: PathBuf) -> CmdResult<FontLoadResponse> {
    if !font_file_has_supported_content(&path)? {
        return Ok(FontLoadResponse {
            success: false,
            error: Some("Selected file is not valid font content".to_string()),
            error_code: Some(INVALID_FONT_CONTENT.to_string()),
            font_name: None,
            font_path: None,
            weight_ranges: Vec::new(),
        });
    }

    let metadata = match parse_font_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return Ok(FontLoadResponse {
                success: false,
                error: Some(format!("폰트 정보를 읽을 수 없습니다: {error}")),
                error_code: Some(INVALID_FONT_CONTENT.to_string()),
                font_name: None,
                font_path: None,
                weight_ranges: Vec::new(),
            });
        }
    };

    // asset protocol scope 호환 및 원본 파일 이동/삭제 대비를 위해
    // app data 디렉터리로 복사
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("ttf")
        .to_lowercase();

    let data_dir = app.path().app_data_dir()?;
    let fonts_dir = data_dir.join("fonts");
    let imported = import_font_file(&path, &fonts_dir, &ext)?;
    let dest_string = imported.path.to_string_lossy().to_string();

    // Macintosh 플랫폼 name 레코드만 가진 구형 폰트는 family 이름을 못 읽는다 - 파일명 폴백
    let font_name = metadata.family_name.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .map(str::trim)
            .filter(|stem| !stem.is_empty())
            .unwrap_or("Custom Font")
            .to_string()
    });

    Ok(FontLoadResponse {
        success: true,
        error: None,
        error_code: None,
        font_name: Some(font_name),
        font_path: Some(dest_string),
        weight_ranges: metadata.weight_ranges,
    })
}

fn font_file_has_supported_content(path: &Path) -> io::Result<bool> {
    let mut header = Vec::with_capacity(4);
    File::open(path)?.take(4).read_to_end(&mut header)?;
    Ok(font_bytes_have_supported_content(&header))
}

fn font_bytes_have_supported_content(bytes: &[u8]) -> bool {
    let Some(header) = bytes.get(..4) else {
        return false;
    };

    [
        b"\x00\x01\x00\x00",
        b"true",
        b"ttcf",
        b"OTTO",
        b"wOFF",
        b"wOF2",
    ]
    .iter()
    .any(|signature| header == *signature)
}

#[cfg(test)]
mod tests {
    use super::{font_bytes_have_supported_content, FontLoadResponse, INVALID_FONT_CONTENT};

    #[test]
    fn supported_sfnt_opentype_and_webfont_headers_are_accepted() {
        for header in [
            b"\x00\x01\x00\x00",
            b"true",
            b"ttcf",
            b"OTTO",
            b"wOFF",
            b"wOF2",
        ] {
            assert!(font_bytes_have_supported_content(header));
        }
    }

    #[test]
    fn arbitrary_bytes_are_rejected() {
        assert!(!font_bytes_have_supported_content(b"text"));
        assert!(!font_bytes_have_supported_content(b"\0\x01\0"));
    }

    #[test]
    fn response_serializes_error_code_and_keeps_cancellation_quiet() {
        let invalid = serde_json::to_value(FontLoadResponse {
            success: false,
            error: Some("invalid font".to_string()),
            error_code: Some(INVALID_FONT_CONTENT.to_string()),
            font_name: None,
            font_path: None,
            weight_ranges: Vec::new(),
        })
        .unwrap();
        assert_eq!(invalid["errorCode"], INVALID_FONT_CONTENT);

        let cancelled = serde_json::to_value(FontLoadResponse {
            success: false,
            error: None,
            error_code: None,
            font_name: None,
            font_path: None,
            weight_ranges: Vec::new(),
        })
        .unwrap();
        assert!(cancelled.get("error").is_none());
        assert!(cancelled.get("errorCode").is_none());
    }
}
