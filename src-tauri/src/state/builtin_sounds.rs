use std::{fs, path::Path};

use crate::models::{AppStoreData, SoundLibraryEntry, SoundSource};

struct BuiltinSound {
    file_name: &'static str,
    display_name: &'static str,
    bytes: &'static [u8],
}

const BUILTIN_SOUNDS: [BuiltinSound; 2] = [
    BuiltinSound {
        file_name: "builtin-hait.wav",
        display_name: "하잇 (RiraN, Negoto Bunnyla)",
        bytes: include_bytes!("../../assets/sounds/builtin-hait.wav"),
    },
    BuiltinSound {
        file_name: "builtin-click.wav",
        display_name: "클릭음",
        bytes: include_bytes!("../../assets/sounds/builtin-click.wav"),
    },
];

/// 내장 키음을 appData/sounds에 시딩하고 sound_library 엔트리를 정합화.
/// 키 문자열은 commands/keys/sound.rs의 normalize_path_string(to_string_lossy)과
/// 동일해야 sound_list의 stale 정리에 걸리지 않는다.
pub(crate) fn seed_builtin_sounds(app_data_dir: &Path, data: &mut AppStoreData) -> bool {
    let sounds_dir = app_data_dir.join("sounds");
    if let Err(err) = fs::create_dir_all(&sounds_dir) {
        log::warn!("[BuiltinSound] 사운드 디렉토리 생성 실패: {err}");
        return false;
    }

    let mut changed = false;
    for sound in BUILTIN_SOUNDS.iter() {
        let dest = sounds_dir.join(sound.file_name);
        if !dest.exists() {
            if let Err(err) = fs::write(&dest, sound.bytes) {
                log::warn!("[BuiltinSound] {} 기록 실패: {err}", sound.file_name);
                continue;
            }
        }

        let key = dest.to_string_lossy().to_string();
        match data.sound_library.get_mut(&key) {
            Some(entry) => {
                // source/표시 이름만 갱신, 트림 메타데이터는 보존
                if entry.source != SoundSource::Builtin
                    || entry.display_name.as_deref() != Some(sound.display_name)
                {
                    entry.source = SoundSource::Builtin;
                    entry.display_name = Some(sound.display_name.to_string());
                    changed = true;
                }
            }
            None => {
                data.sound_library.insert(
                    key,
                    SoundLibraryEntry {
                        source: SoundSource::Builtin,
                        display_name: Some(sound.display_name.to_string()),
                        ..Default::default()
                    },
                );
                changed = true;
            }
        }
    }

    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_app_data_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "dmnote-builtin-sounds-test-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn seeds_files_and_entries_idempotently() {
        let dir = temp_app_data_dir();
        let mut data = AppStoreData::default();

        // 최초 시딩: 파일 생성 + Builtin 엔트리 삽입
        assert!(seed_builtin_sounds(&dir, &mut data));
        let sounds_dir = dir.join("sounds");
        for sound in BUILTIN_SOUNDS.iter() {
            let dest = sounds_dir.join(sound.file_name);
            assert!(dest.exists());
            let entry = data
                .sound_library
                .get(&dest.to_string_lossy().to_string())
                .expect("library entry missing");
            assert_eq!(entry.source, SoundSource::Builtin);
            assert_eq!(entry.display_name.as_deref(), Some(sound.display_name));
            assert!(entry.enabled);
        }

        // 재실행: 변경 없음 (멱등)
        assert!(!seed_builtin_sounds(&dir, &mut data));

        // 사용자 토글은 재시딩에도 보존
        for entry in data.sound_library.values_mut() {
            entry.enabled = false;
        }
        assert!(!seed_builtin_sounds(&dir, &mut data));
        assert!(data.sound_library.values().all(|entry| !entry.enabled));

        // Local로 오염된 source는 자가 치유
        for entry in data.sound_library.values_mut() {
            entry.source = SoundSource::Local;
        }
        assert!(seed_builtin_sounds(&dir, &mut data));
        assert!(data
            .sound_library
            .values()
            .all(|entry| entry.source == SoundSource::Builtin));

        let _ = fs::remove_dir_all(&dir);
    }
}
