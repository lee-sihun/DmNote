use rfd::AsyncFileDialog;
use serde::Serialize;
use tauri::{Manager, WebviewWindow};

use crate::{
    errors::{CmdResult, CommandError},
    state::image_asset::import_image_file,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
}

/// 선택과 파일 I/O를 메인 스레드 밖에서 처리
#[tauri::command]
pub async fn image_load(
    app: tauri::AppHandle,
    _window: WebviewWindow,
) -> CmdResult<ImageLoadResponse> {
    let picked = AsyncFileDialog::new()
        .add_filter(
            "Images",
            &[
                "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "ico", "avif",
            ],
        )
        .pick_file()
        .await;

    let Some(file) = picked else {
        return Ok(ImageLoadResponse {
            success: false,
            error: None,
            image_path: None,
        });
    };

    let source_path = file.path().to_path_buf();
    let extension =
        normalize_image_extension(source_path.extension().and_then(|value| value.to_str()));
    let images_dir = app.path().app_data_dir()?.join("images");
    let imported = tauri::async_runtime::spawn_blocking(move || {
        import_image_file(&source_path, &images_dir, &extension)
    })
    .await
    .map_err(|error| CommandError::msg(format!("image import task failed: {error}")))??;

    Ok(ImageLoadResponse {
        success: true,
        error: None,
        image_path: Some(imported.path.to_string_lossy().to_string()),
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

#[cfg(test)]
mod tests {
    use super::normalize_image_extension;

    #[test]
    fn gif_extension_is_kept_without_format_conversion() {
        assert_eq!(normalize_image_extension(Some("GIF")), "gif");
    }

    #[test]
    fn unknown_extension_uses_existing_png_fallback() {
        assert_eq!(normalize_image_extension(Some("unknown")), "png");
        assert_eq!(normalize_image_extension(None), "png");
    }
}
