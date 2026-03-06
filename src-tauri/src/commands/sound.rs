use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::app_state::AppState;
use crate::models::{SoundLibraryEntry, SoundSource};

const SUPPORTED_SOUND_EXTENSIONS: [&str; 8] =
    ["wav", "mp3", "ogg", "flac", "m4a", "aac", "aif", "aiff"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound_path: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SoundListItem {
    pub sound_path: String,
    pub file_name: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at_ms: Option<u64>,
    pub enabled: bool,
    pub source: SoundSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trim_start_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trim_end_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSaveProcessedWavRequest {
    pub wav_base64: String,
    pub file_name: Option<String>,
    pub original_base64: Option<String>,
    pub original_extension: Option<String>,
    pub trim_start_ratio: Option<f64>,
    pub trim_end_ratio: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSaveProcessedWavResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSetEnabledResponse {
    pub success: bool,
    pub sound_path: String,
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundDeleteResponse {
    pub success: bool,
}

/// 로컬 사운드 파일을 선택하고 appData/sounds 디렉토리로 복사한 뒤 경로 반환
#[tauri::command]
pub fn sound_load(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SoundLoadResponse, String> {
    let picked = FileDialog::new()
        .add_filter("Audio", &SUPPORTED_SOUND_EXTENSIONS)
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

    let sounds_dir = ensure_sounds_dir(&app)?;
    let dest_path = sounds_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
    fs::copy(&path, &dest_path).map_err(|e| format!("사운드 파일 복사 실패: {e}"))?;

    let dest_path_str = normalize_path_string(&dest_path);
    state
        .store
        .update(|s| {
            s.sound_library.insert(
                dest_path_str.clone(),
                SoundLibraryEntry {
                    enabled: true,
                    source: SoundSource::Local,
                    ..Default::default()
                },
            );
        })
        .map_err(|e| format!("사운드 라이브러리 저장 실패: {e}"))?;

    Ok(SoundLoadResponse {
        success: true,
        error: None,
        sound_path: Some(dest_path_str),
    })
}

#[tauri::command]
pub fn sound_list(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SoundListItem>, String> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let mut items = Vec::new();
    let mut library = state.store.with_state(|s| s.sound_library.clone());
    let mut seen_paths = HashSet::new();
    let mut library_mutated = false;

    let entries =
        fs::read_dir(&sounds_dir).map_err(|e| format!("사운드 디렉토리 읽기 실패: {e}"))?;

    for entry_result in entries {
        let Ok(entry) = entry_result else {
            continue;
        };

        let path = entry.path();
        if !path.is_file() || !is_supported_sound_file(&path) {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        if file_name.is_empty() {
            continue;
        }

        let path_key = normalize_path_string(&path);
        seen_paths.insert(path_key.clone());

        let entry_meta = library
            .entry(path_key.clone())
            .or_insert_with(|| {
                library_mutated = true;
                SoundLibraryEntry::default()
            })
            .clone();

        let modified_at_ms = metadata.modified().ok().and_then(|modified| {
            modified
                .duration_since(SystemTime::UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_millis() as u64)
        });

        items.push(SoundListItem {
            sound_path: path_key,
            file_name,
            size_bytes: metadata.len(),
            modified_at_ms,
            enabled: entry_meta.enabled,
            source: entry_meta.source,
            original_path: entry_meta.original_path,
            trim_start_ratio: entry_meta.trim_start_ratio,
            trim_end_ratio: entry_meta.trim_end_ratio,
            display_name: entry_meta.display_name,
        });
    }

    let stale_keys: Vec<String> = library
        .keys()
        .filter(|key| !seen_paths.contains(*key))
        .cloned()
        .collect();
    if !stale_keys.is_empty() {
        for key in stale_keys {
            library.remove(&key);
        }
        library_mutated = true;
    }

    if library_mutated {
        state
            .store
            .update(|s| {
                s.sound_library = library.clone();
            })
            .map_err(|e| format!("사운드 라이브러리 저장 실패: {e}"))?;
    }

    items.sort_by(|a, b| {
        b.modified_at_ms
            .unwrap_or_default()
            .cmp(&a.modified_at_ms.unwrap_or_default())
            .then_with(|| a.file_name.cmp(&b.file_name))
    });

    Ok(items)
}

#[tauri::command]
pub fn sound_set_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sound_path: String,
    enabled: bool,
) -> Result<SoundSetEnabledResponse, String> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    if !validated_path.exists() {
        return Err("대상 사운드 파일이 존재하지 않습니다.".to_string());
    }

    let path_key = normalize_path_string(&validated_path);
    state
        .store
        .update(|s| {
            s.sound_library.entry(path_key.clone()).or_default().enabled = enabled;
        })
        .map_err(|e| format!("사운드 라이브러리 저장 실패: {e}"))?;

    Ok(SoundSetEnabledResponse {
        success: true,
        sound_path: path_key,
        enabled,
    })
}

#[tauri::command]
pub fn sound_delete(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sound_path: String,
) -> Result<SoundDeleteResponse, String> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    let path_key = normalize_path_string(&validated_path);

    // 라이브러리에서 원본 경로를 먼저 조회
    let original_rel_path = state.store.with_state(|s| {
        s.sound_library
            .get(&path_key)
            .and_then(|entry| entry.original_path.clone())
    });

    if validated_path.exists() {
        fs::remove_file(&validated_path).map_err(|e| format!("사운드 파일 삭제 실패: {e}"))?;
    }

    // 원본 파일도 삭제
    if let Some(ref orig_rel) = original_rel_path {
        let orig_abs = sounds_dir.join(orig_rel);
        if orig_abs.exists() && orig_abs.starts_with(&sounds_dir) {
            if let Err(e) = fs::remove_file(&orig_abs) {
                log::warn!("[Sound] 원본 사운드 파일 삭제 실패: {e}");
            }
        }
    }

    // 라이브러리 엔트리 제거 + 키 참조 정리를 하나의 트랜잭션으로
    let mut references_changed = false;
    let updated = state
        .store
        .update(|store| {
            store.sound_library.remove(&path_key);

            for positions in store.key_positions.values_mut() {
                for position in positions.iter_mut() {
                    if position.sound_path.as_deref() == Some(&path_key) {
                        position.sound_path = None;
                        position.sound_enabled = Some(false);
                        references_changed = true;
                    }
                }
            }

            for positions in store.stat_positions.values_mut() {
                for stat_position in positions.iter_mut() {
                    if stat_position.position.sound_path.as_deref() == Some(&path_key) {
                        stat_position.position.sound_path = None;
                        stat_position.position.sound_enabled = Some(false);
                        references_changed = true;
                    }
                }
            }

            for positions in store.graph_positions.values_mut() {
                for graph_position in positions.iter_mut() {
                    if graph_position.position.sound_path.as_deref() == Some(&path_key) {
                        graph_position.position.sound_path = None;
                        graph_position.position.sound_enabled = Some(false);
                        references_changed = true;
                    }
                }
            }
        })
        .map_err(|e| format!("사운드 삭제 처리 실패: {e}"))?;

    if references_changed {
        app.emit("positions:changed", &updated.key_positions)
            .map_err(|e| format!("positions:changed emit 실패: {e}"))?;
        app.emit("statPositions:changed", &updated.stat_positions)
            .map_err(|e| format!("statPositions:changed emit 실패: {e}"))?;
        app.emit("graphPositions:changed", &updated.graph_positions)
            .map_err(|e| format!("graphPositions:changed emit 실패: {e}"))?;
    }

    Ok(SoundDeleteResponse { success: true })
}

#[tauri::command]
pub fn sound_save_processed_wav(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: SoundSaveProcessedWavRequest,
) -> Result<SoundSaveProcessedWavResponse, String> {
    let encoded = request.wav_base64.trim();
    if encoded.is_empty() {
        return Ok(SoundSaveProcessedWavResponse {
            success: false,
            error: Some("사운드 데이터가 비어 있습니다.".to_string()),
            sound_path: None,
        });
    }

    let wav_bytes = BASE64_STANDARD
        .decode(encoded)
        .map_err(|e| format!("사운드 데이터 디코딩 실패: {e}"))?;

    let is_valid_wav = wav_bytes.len() >= 12
        && wav_bytes.get(0..4) == Some(b"RIFF")
        && wav_bytes.get(8..12) == Some(b"WAVE");
    if !is_valid_wav {
        return Ok(SoundSaveProcessedWavResponse {
            success: false,
            error: Some("유효한 WAV 데이터가 아닙니다.".to_string()),
            sound_path: None,
        });
    }

    let sounds_dir = ensure_sounds_dir(&app)?;

    let base_name = request
        .file_name
        .as_deref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(|n| {
            let sanitized: String = n
                .chars()
                .map(|c| {
                    if c == '/'
                        || c == '\\'
                        || c == ':'
                        || c == '*'
                        || c == '?'
                        || c == '"'
                        || c == '<'
                        || c == '>'
                        || c == '|'
                    {
                        '_'
                    } else {
                        c
                    }
                })
                .collect();
            sanitized
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut dest_path = sounds_dir.join(format!("{}.wav", base_name));
    if dest_path.exists() {
        dest_path = sounds_dir.join(format!("{}_{}.wav", base_name, Uuid::new_v4()));
    }
    fs::write(&dest_path, wav_bytes).map_err(|e| format!("편집된 사운드 저장 실패: {e}"))?;

    // 원본 파일 저장
    let mut original_rel_path: Option<String> = None;
    if let Some(ref orig_b64) = request.original_base64 {
        let trimmed_orig = orig_b64.trim();
        if !trimmed_orig.is_empty() {
            let orig_bytes = BASE64_STANDARD
                .decode(trimmed_orig)
                .map_err(|e| format!("원본 사운드 데이터 디코딩 실패: {e}"))?;
            let orig_ext = request
                .original_extension
                .as_deref()
                .unwrap_or("wav")
                .to_lowercase();
            let originals_dir = ensure_originals_dir(&app)?;
            let orig_filename = format!("{}.{}", Uuid::new_v4(), orig_ext);
            let orig_path = originals_dir.join(&orig_filename);
            fs::write(&orig_path, orig_bytes).map_err(|e| format!("원본 사운드 저장 실패: {e}"))?;
            original_rel_path = Some(format!("originals/{}", orig_filename));
        }
    }

    let dest_path_str = normalize_path_string(&dest_path);
    state
        .store
        .update(|s| {
            s.sound_library.insert(
                dest_path_str.clone(),
                SoundLibraryEntry {
                    enabled: true,
                    source: SoundSource::Local,
                    original_path: original_rel_path.clone(),
                    trim_start_ratio: request.trim_start_ratio,
                    trim_end_ratio: request.trim_end_ratio,
                    display_name: request.file_name.clone(),
                },
            );
        })
        .map_err(|e| format!("사운드 라이브러리 저장 실패: {e}"))?;

    Ok(SoundSaveProcessedWavResponse {
        success: true,
        error: None,
        sound_path: Some(dest_path_str),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundLoadOriginalResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_extension: Option<String>,
}

/// 편집을 위해 원본 사운드 파일을 base64로 반환
#[tauri::command]
pub fn sound_load_original(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sound_path: String,
) -> Result<SoundLoadOriginalResponse, String> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    let path_key = normalize_path_string(&validated_path);

    let original_rel = state
        .store
        .with_state(|s| {
            s.sound_library
                .get(&path_key)
                .and_then(|e| e.original_path.clone())
        })
        .ok_or("원본 파일 정보가 없습니다.")?;

    let original_abs = sounds_dir.join(&original_rel);
    if !original_abs.starts_with(&sounds_dir) {
        return Err("잘못된 원본 경로입니다.".to_string());
    }
    if !original_abs.exists() {
        return Err("원본 파일이 존재하지 않습니다.".to_string());
    }

    let bytes = fs::read(&original_abs).map_err(|e| format!("원본 사운드 파일 읽기 실패: {e}"))?;
    let encoded = BASE64_STANDARD.encode(&bytes);

    let ext = original_abs
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());

    Ok(SoundLoadOriginalResponse {
        success: true,
        error: None,
        audio_base64: Some(encoded),
        original_extension: ext,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundUpdateProcessedWavRequest {
    pub sound_path: String,
    pub wav_base64: String,
    pub trim_start_ratio: Option<f64>,
    pub trim_end_ratio: Option<f64>,
    pub display_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundUpdateProcessedWavResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 기존 트리밍 파일을 새 WAV로 덮어쓰고 메타데이터 갱신
#[tauri::command]
pub fn sound_update_processed_wav(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: SoundUpdateProcessedWavRequest,
) -> Result<SoundUpdateProcessedWavResponse, String> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &request.sound_path)?;
    let path_key = normalize_path_string(&validated_path);

    let wav_bytes = BASE64_STANDARD
        .decode(request.wav_base64.trim())
        .map_err(|e| format!("사운드 데이터 디코딩 실패: {e}"))?;

    let is_valid_wav = wav_bytes.len() >= 12
        && wav_bytes.get(0..4) == Some(b"RIFF")
        && wav_bytes.get(8..12) == Some(b"WAVE");
    if !is_valid_wav {
        return Ok(SoundUpdateProcessedWavResponse {
            success: false,
            error: Some("유효한 WAV 데이터가 아닙니다.".to_string()),
        });
    }

    fs::write(&validated_path, wav_bytes).map_err(|e| format!("편집된 사운드 저장 실패: {e}"))?;

    state
        .store
        .update(|s| {
            if let Some(entry) = s.sound_library.get_mut(&path_key) {
                entry.trim_start_ratio = request.trim_start_ratio;
                entry.trim_end_ratio = request.trim_end_ratio;
                if let Some(ref name) = request.display_name {
                    entry.display_name = Some(name.clone());
                }
            }
        })
        .map_err(|e| format!("사운드 라이브러리 저장 실패: {e}"))?;

    // 키음 엔진 캐시에서 이전 디코딩 결과 무효화
    state.key_sound_invalidate_file_cache(&path_key);

    Ok(SoundUpdateProcessedWavResponse {
        success: true,
        error: None,
    })
}

fn validate_sound_path(sounds_dir: &Path, sound_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(sound_path);
    if !path.is_absolute() {
        return Err("절대 경로만 허용됩니다.".to_string());
    }
    if !path.starts_with(sounds_dir) {
        return Err("appData/sounds 외부 경로에는 접근할 수 없습니다.".to_string());
    }
    Ok(path)
}

fn normalize_path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn ensure_sounds_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 디렉토리 확인 실패: {e}"))?;
    let sounds_dir = data_dir.join("sounds");
    fs::create_dir_all(&sounds_dir).map_err(|e| format!("사운드 디렉토리 생성 실패: {e}"))?;
    Ok(sounds_dir)
}

fn ensure_originals_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let sounds_dir = ensure_sounds_dir(app)?;
    let originals_dir = sounds_dir.join("originals");
    fs::create_dir_all(&originals_dir)
        .map_err(|e| format!("원본 사운드 디렉토리 생성 실패: {e}"))?;
    Ok(originals_dir)
}

fn is_supported_sound_file(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    SUPPORTED_SOUND_EXTENSIONS
        .iter()
        .any(|allowed| ext.eq_ignore_ascii_case(allowed))
}
