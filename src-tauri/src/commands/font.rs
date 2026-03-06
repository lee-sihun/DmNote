use rfd::FileDialog;
use serde::Serialize;
use std::fs;
use tauri::Manager;
use uuid::Uuid;

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
}

/// 로컬 폰트 파일을 선택하고 폰트 이름/경로를 반환
/// 파일 경로만 저장하고, 프론트에서 `convertFileSrc` 기반으로 `@font-face`를 생성
#[tauri::command]
pub fn font_load(app: tauri::AppHandle) -> Result<FontLoadResponse, String> {
    let picked = FileDialog::new()
        .add_filter("Fonts", &["ttf", "otf", "woff", "woff2"])
        .pick_file();

    let Some(path) = picked else {
        return Ok(FontLoadResponse {
            success: false,
            error: None,
            font_name: None,
            font_path: None,
        });
    };

    // 파일명(확장자 제외)을 폰트 이름으로 사용
    let font_name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown Font")
        .to_string();

    // Copy into app data directory so it works with the asset protocol scope
    // and survives if the user moves/deletes the original file.
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("ttf")
        .to_lowercase();

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 디렉토리 확인 실패: {e}"))?;
    let fonts_dir = data_dir.join("fonts");
    fs::create_dir_all(&fonts_dir).map_err(|e| format!("폰트 디렉토리 생성 실패: {e}"))?;

    let dest_path = fonts_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
    fs::copy(&path, &dest_path).map_err(|e| format!("폰트 파일 복사 실패: {e}"))?;
    let dest_string = dest_path.to_string_lossy().to_string();

    Ok(FontLoadResponse {
        success: true,
        error: None,
        font_name: Some(font_name),
        font_path: Some(dest_string),
    })
}
