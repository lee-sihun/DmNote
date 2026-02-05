use std::fs;

use base64::{engine::general_purpose::STANDARD, Engine};
use rfd::FileDialog;
use serde::Serialize;

/// 폰트 로드 결과 응답 타입
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css_content: Option<String>,
}

/// 폰트 파일 확장자에 따른 format 문자열 반환
fn get_font_format(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "otf" => "opentype",
        "woff" => "woff",
        "woff2" => "woff2",
        "ttf" | _ => "truetype",
    }
}

/// 파일 확장자에 따른 MIME 타입 반환
fn get_font_mime_type(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" | _ => "font/ttf",
    }
}

/// 로컬 폰트 파일을 선택하고 base64로 인코딩된 CSS를 반환
#[tauri::command(permission = "dmnote-allow-all")]
pub fn font_load() -> Result<FontLoadResponse, String> {
    let picked = FileDialog::new()
        .add_filter("Fonts", &["ttf", "otf", "woff", "woff2"])
        .pick_file();

    let Some(path) = picked else {
        return Ok(FontLoadResponse {
            success: false,
            error: None,
            font_name: None,
            font_path: None,
            css_content: None,
        });
    };

    let path_string = path.to_string_lossy().to_string();

    // 파일명에서 폰트 이름 추출
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown Font");

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("ttf");

    let font_name = file_name
        .trim_end_matches(&format!(".{}", ext))
        .to_string();

    // 폰트 파일 바이너리 읽기
    match fs::read(&path) {
        Ok(bytes) => {
            // Base64 인코딩
            let base64_data = STANDARD.encode(&bytes);

            // 폰트 포맷 결정
            let format = get_font_format(ext);
            let mime_type = get_font_mime_type(ext);

            // @font-face CSS 생성
            let css_content = format!(
                r#"@font-face {{
  font-family: '{}';
  src: url(data:{};base64,{}) format('{}');
  font-weight: normal;
  font-style: normal;
}}"#,
                font_name, mime_type, base64_data, format
            );

            Ok(FontLoadResponse {
                success: true,
                error: None,
                font_name: Some(font_name),
                font_path: Some(path_string),
                css_content: Some(css_content),
            })
        }
        Err(err) => Ok(FontLoadResponse {
            success: false,
            error: Some(format!("폰트 파일 읽기 실패: {}", err)),
            font_name: None,
            font_path: None,
            css_content: None,
        }),
    }
}
