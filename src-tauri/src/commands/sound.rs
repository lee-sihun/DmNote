use rfd::FileDialog;
use serde::Serialize;
use std::fs;
use tauri::Manager;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound_path: Option<String>,
}

/// 로컬 사운드 파일을 선택하고 appData/sounds 디렉토리로 복사한 뒤 경로 반환
#[tauri::command(permission = "dmnote-allow-all")]
pub fn sound_load(app: tauri::AppHandle) -> Result<SoundLoadResponse, String> {
    let picked = FileDialog::new()
        .add_filter(
            "Audio",
            &["wav", "mp3", "ogg", "flac", "m4a", "aac", "aif", "aiff"],
        )
        .pick_file();

    let Some(path) = picked else {
        return Ok(SoundLoadResponse {
            success: false,
            error: None,
            sound_path: None,
        });
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("wav")
        .to_lowercase();

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 디렉토리 확인 실패: {e}"))?;
    let sounds_dir = data_dir.join("sounds");
    fs::create_dir_all(&sounds_dir).map_err(|e| format!("사운드 디렉토리 생성 실패: {e}"))?;

    let dest_path = sounds_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
    fs::copy(&path, &dest_path).map_err(|e| format!("사운드 파일 복사 실패: {e}"))?;

    Ok(SoundLoadResponse {
        success: true,
        error: None,
        sound_path: Some(dest_path.to_string_lossy().to_string()),
    })
}
