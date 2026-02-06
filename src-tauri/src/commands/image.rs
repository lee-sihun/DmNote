use rfd::FileDialog;
use serde::Serialize;
use std::fs;
use tauri::Manager;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
}

/// 로컬 이미지 파일을 선택해서 앱 데이터 디렉토리로 복사한 뒤 경로를 반환합니다.
/// 저장소에는 base64 대신 파일 경로만 저장해 직렬화/역직렬화 비용을 줄입니다.
#[tauri::command(permission = "dmnote-allow-all")]
pub fn image_load(app: tauri::AppHandle) -> Result<ImageLoadResponse, String> {
    let picked = FileDialog::new()
        .add_filter(
            "Images",
            &["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "ico", "avif"],
        )
        .pick_file();

    let Some(path) = picked else {
        return Ok(ImageLoadResponse {
            success: false,
            error: None,
            image_path: None,
        });
    };

    let ext = normalize_image_extension(path.extension().and_then(|e| e.to_str()));

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 디렉토리 확인 실패: {e}"))?;
    let images_dir = data_dir.join("images");
    fs::create_dir_all(&images_dir)
        .map_err(|e| format!("이미지 디렉토리 생성 실패: {e}"))?;

    let dest_path = images_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
    fs::copy(&path, &dest_path).map_err(|e| format!("이미지 파일 복사 실패: {e}"))?;

    Ok(ImageLoadResponse {
        success: true,
        error: None,
        image_path: Some(dest_path.to_string_lossy().to_string()),
    })
}

fn normalize_image_extension(extension: Option<&str>) -> String {
    match extension
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" => "jpg".to_string(),
        "jpeg" => "jpeg".to_string(),
        "webp" => "webp".to_string(),
        "gif" => "gif".to_string(),
        "bmp" => "bmp".to_string(),
        "svg" => "svg".to_string(),
        "ico" => "ico".to_string(),
        "avif" => "avif".to_string(),
        "png" => "png".to_string(),
        _ => "png".to_string(),
    }
}
