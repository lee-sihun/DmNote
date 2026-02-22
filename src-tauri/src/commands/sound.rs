use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::app_state::AppState;

const SUPPORTED_SOUND_EXTENSIONS: [&str; 8] =
    ["wav", "mp3", "ogg", "flac", "m4a", "aac", "aif", "aiff"];
const SOUND_LIBRARY_FILE_NAME: &str = ".sound-library.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SoundSource {
    Builtin,
    Local,
}

fn default_sound_source() -> SoundSource {
    SoundSource::Local
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SoundLibraryEntry {
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default = "default_sound_source")]
    source: SoundSource,
}

impl Default for SoundLibraryEntry {
    fn default() -> Self {
        Self {
            enabled: true,
            source: SoundSource::Local,
        }
    }
}

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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSaveProcessedWavRequest {
    pub wav_base64: String,
    pub file_name: Option<String>,
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
#[tauri::command(permission = "dmnote-allow-all")]
pub fn sound_load(app: tauri::AppHandle) -> Result<SoundLoadResponse, String> {
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
    upsert_sound_library_entry(
        &sounds_dir,
        &dest_path_str,
        SoundLibraryEntry {
            enabled: true,
            source: SoundSource::Local,
        },
    )?;

    Ok(SoundLoadResponse {
        success: true,
        error: None,
        sound_path: Some(dest_path_str),
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn sound_list(app: tauri::AppHandle) -> Result<Vec<SoundListItem>, String> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let mut items = Vec::new();
    let mut library = load_sound_library(&sounds_dir);
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
        save_sound_library(&sounds_dir, &library)?;
    }

    items.sort_by(|a, b| {
        b.modified_at_ms
            .unwrap_or_default()
            .cmp(&a.modified_at_ms.unwrap_or_default())
            .then_with(|| a.file_name.cmp(&b.file_name))
    });

    Ok(items)
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn sound_set_enabled(
    app: tauri::AppHandle,
    sound_path: String,
    enabled: bool,
) -> Result<SoundSetEnabledResponse, String> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    if !validated_path.exists() {
        return Err("대상 사운드 파일이 존재하지 않습니다.".to_string());
    }

    let path_key = normalize_path_string(&validated_path);
    upsert_sound_library_entry(
        &sounds_dir,
        &path_key,
        SoundLibraryEntry {
            enabled,
            source: SoundSource::Local,
        },
    )?;

    Ok(SoundSetEnabledResponse {
        success: true,
        sound_path: path_key,
        enabled,
    })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn sound_delete(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    sound_path: String,
) -> Result<SoundDeleteResponse, String> {
    let sounds_dir = ensure_sounds_dir(&app)?;
    let validated_path = validate_sound_path(&sounds_dir, &sound_path)?;
    let path_key = normalize_path_string(&validated_path);

    if validated_path.exists() {
        fs::remove_file(&validated_path).map_err(|e| format!("사운드 파일 삭제 실패: {e}"))?;
    }

    let mut library = load_sound_library(&sounds_dir);
    if library.remove(&path_key).is_some() {
        save_sound_library(&sounds_dir, &library)?;
    }

    clear_deleted_sound_references(&state, &app, &path_key)?;

    Ok(SoundDeleteResponse { success: true })
}

#[tauri::command(permission = "dmnote-allow-all")]
pub fn sound_save_processed_wav(
    app: tauri::AppHandle,
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
                .map(|c| if c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|' { '_' } else { c })
                .collect();
            sanitized
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut dest_path = sounds_dir.join(format!("{}.wav", base_name));
    if dest_path.exists() {
        dest_path = sounds_dir.join(format!("{}_{}.wav", base_name, Uuid::new_v4()));
    }
    fs::write(&dest_path, wav_bytes).map_err(|e| format!("편집된 사운드 저장 실패: {e}"))?;

    let dest_path_str = normalize_path_string(&dest_path);
    upsert_sound_library_entry(
        &sounds_dir,
        &dest_path_str,
        SoundLibraryEntry {
            enabled: true,
            source: SoundSource::Local,
        },
    )?;

    Ok(SoundSaveProcessedWavResponse {
        success: true,
        error: None,
        sound_path: Some(dest_path_str),
    })
}

fn clear_deleted_sound_references(
    state: &State<'_, AppState>,
    app: &tauri::AppHandle,
    deleted_path: &str,
) -> Result<(), String> {
    let mut changed = false;
    let updated = state
        .store
        .update(|store| {
            for positions in store.key_positions.values_mut() {
                for position in positions.iter_mut() {
                    if position.sound_path.as_deref() == Some(deleted_path) {
                        position.sound_path = None;
                        position.sound_enabled = Some(false);
                        changed = true;
                    }
                }
            }

            for positions in store.stat_positions.values_mut() {
                for stat_position in positions.iter_mut() {
                    if stat_position.position.sound_path.as_deref() == Some(deleted_path) {
                        stat_position.position.sound_path = None;
                        stat_position.position.sound_enabled = Some(false);
                        changed = true;
                    }
                }
            }

            for positions in store.graph_positions.values_mut() {
                for graph_position in positions.iter_mut() {
                    if graph_position.position.sound_path.as_deref() == Some(deleted_path) {
                        graph_position.position.sound_path = None;
                        graph_position.position.sound_enabled = Some(false);
                        changed = true;
                    }
                }
            }
        })
        .map_err(|e| format!("사운드 참조 정리 실패: {e}"))?;

    if changed {
        app.emit("positions:changed", &updated.key_positions)
            .map_err(|e| format!("positions:changed emit 실패: {e}"))?;
        app.emit("statPositions:changed", &updated.stat_positions)
            .map_err(|e| format!("statPositions:changed emit 실패: {e}"))?;
        app.emit("graphPositions:changed", &updated.graph_positions)
            .map_err(|e| format!("graphPositions:changed emit 실패: {e}"))?;
    }

    Ok(())
}

fn sound_library_path(sounds_dir: &Path) -> PathBuf {
    sounds_dir.join(SOUND_LIBRARY_FILE_NAME)
}

fn load_sound_library(sounds_dir: &Path) -> HashMap<String, SoundLibraryEntry> {
    let path = sound_library_path(sounds_dir);
    if !path.exists() {
        return HashMap::new();
    }

    let raw = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(error) => {
            log::warn!("[Sound] failed to read sound library file: {error}");
            return HashMap::new();
        }
    };

    serde_json::from_str::<HashMap<String, SoundLibraryEntry>>(&raw).unwrap_or_else(|error| {
        log::warn!("[Sound] failed to parse sound library file: {error}");
        HashMap::new()
    })
}

fn save_sound_library(sounds_dir: &Path, library: &HashMap<String, SoundLibraryEntry>) -> Result<(), String> {
    let path = sound_library_path(sounds_dir);
    let serialized =
        serde_json::to_string_pretty(library).map_err(|e| format!("사운드 라이브러리 직렬화 실패: {e}"))?;
    fs::write(path, serialized).map_err(|e| format!("사운드 라이브러리 저장 실패: {e}"))?;
    Ok(())
}

fn upsert_sound_library_entry(
    sounds_dir: &Path,
    sound_path: &str,
    entry: SoundLibraryEntry,
) -> Result<(), String> {
    let mut library = load_sound_library(sounds_dir);
    library.insert(sound_path.to_string(), entry);
    save_sound_library(sounds_dir, &library)
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

fn is_supported_sound_file(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
        return false;
    };
    SUPPORTED_SOUND_EXTENSIONS
        .iter()
        .any(|allowed| ext.eq_ignore_ascii_case(allowed))
}
