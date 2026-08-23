use std::{fs, path::Path};

use super::atomic_file::atomic_replace;
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

/// 디스크의 내장 키음이 번들 바이트와 다른지 판정.
/// 조회/읽기 실패 시 교체하지 않는다(fail-closed).
fn is_stale_builtin_file(dest: &Path, bundled: &[u8]) -> bool {
    match fs::metadata(dest) {
        Ok(meta) if meta.len() != bundled.len() as u64 => return true,
        Ok(_) => {}
        Err(err) => {
            log::warn!(
                "[BuiltinSound] {} 메타데이터 조회 실패: {err}",
                dest.display()
            );
            return false;
        }
    }

    match fs::read(dest) {
        Ok(current) => current != bundled,
        Err(err) => {
            log::warn!("[BuiltinSound] {} 읽기 실패: {err}", dest.display());
            false
        }
    }
}

/// 내장 키음을 appData/sounds에 시딩하고 sound_library 엔트리를 정합화.
/// 키 문자열은 commands/keys/sound.rs의 normalize_path_string(to_string_lossy)과
/// 동일해야 sound_list의 stale 정리에 걸리지 않는다.
///
/// 반환값은 store 데이터 변경 여부만 뜻한다. 파일 바이트 교체는 포함하지 않는다 —
/// 포함시키면 store.rs의 needs_persist를 통해 매 부팅 pre-migration 백업이 생성된다.
pub(crate) fn seed_builtin_sounds(app_data_dir: &Path, data: &mut AppStoreData) -> bool {
    let sounds_dir = app_data_dir.join("sounds");
    if let Err(err) = fs::create_dir_all(&sounds_dir) {
        log::warn!("[BuiltinSound] 사운드 디렉토리 생성 실패: {err}");
        return false;
    }

    let mut changed = false;
    for sound in BUILTIN_SOUNDS.iter() {
        let dest = sounds_dir.join(sound.file_name);
        let key = dest.to_string_lossy().to_string();

        if !dest.exists() {
            if let Err(err) = fs::write(&dest, sound.bytes) {
                log::warn!("[BuiltinSound] {} 기록 실패: {err}", sound.file_name);
                continue;
            }
        } else if is_stale_builtin_file(&dest, sound.bytes) {
            // 사용자 편집 흔적 보존 (앱에서 내장 사운드 편집은 봉쇄돼 있어 도달 불가)
            let user_edited = data.sound_library.get(&key).is_some_and(|entry| {
                entry.trim_start_ratio.is_some()
                    || entry.trim_end_ratio.is_some()
                    || entry.original_path.is_some()
            });

            if user_edited {
                log::warn!(
                    "[BuiltinSound] {} 사용자 편집 메타데이터 감지 — 재시드 건너뜀",
                    sound.file_name
                );
            } else if let Err(err) = atomic_replace(&dest, sound.bytes, "builtin-seed") {
                // 교체 실패를 부팅 실패로 승격하지 않는다 (구버전 파일 유지)
                log::warn!("[BuiltinSound] {} 재시드 실패: {err:#}", sound.file_name);
            } else {
                log::info!("[BuiltinSound] {} 번들 버전으로 재시드", sound.file_name);
            }
        }

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
        }

        for entry in data.sound_library.values_mut() {
            entry.hidden = true;
        }

        // 재실행: 변경 없음 (멱등)
        assert!(!seed_builtin_sounds(&dir, &mut data));
        assert!(data.sound_library.values().all(|entry| entry.hidden));

        // Local로 오염된 source는 자가 치유
        for entry in data.sound_library.values_mut() {
            entry.source = SoundSource::Local;
        }
        assert!(seed_builtin_sounds(&dir, &mut data));
        assert!(data
            .sound_library
            .values()
            .all(|entry| entry.source == SoundSource::Builtin));
        assert!(data.sound_library.values().all(|entry| entry.hidden));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replaces_stale_builtin_file_without_dirtying_store() {
        let dir = temp_app_data_dir();
        let mut data = AppStoreData::default();
        assert!(seed_builtin_sounds(&dir, &mut data));

        let sounds_dir = dir.join("sounds");
        // 길이 불일치(즉시 판정)와 동일 길이 내용 손상(바이트 비교 경로)을 모두 커버
        fs::write(sounds_dir.join(BUILTIN_SOUNDS[0].file_name), b"stale").unwrap();
        fs::write(
            sounds_dir.join(BUILTIN_SOUNDS[1].file_name),
            vec![0u8; BUILTIN_SOUNDS[1].bytes.len()],
        )
        .unwrap();
        for entry in data.sound_library.values_mut() {
            entry.hidden = true;
        }

        // 파일만 교체되고 store 데이터는 그대로 → changed == false
        assert!(!seed_builtin_sounds(&dir, &mut data));
        for sound in BUILTIN_SOUNDS.iter() {
            let current = fs::read(sounds_dir.join(sound.file_name)).unwrap();
            assert_eq!(current, sound.bytes, "{} 재시드 안 됨", sound.file_name);
        }
        assert!(data.sound_library.values().all(|entry| entry.hidden));
        // 임시 파일 잔류 없음
        assert!(!fs::read_dir(&sounds_dir).unwrap().any(|e| e
            .unwrap()
            .path()
            .extension()
            .is_some_and(|ext| ext == "tmp")));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_user_edited_builtin_file() {
        let markers: [fn(&mut SoundLibraryEntry); 3] = [
            |entry| entry.trim_start_ratio = Some(0.1),
            |entry| entry.trim_end_ratio = Some(0.9),
            |entry| entry.original_path = Some("originals/edited.wav".to_string()),
        ];

        let (marked, unmarked) = (&BUILTIN_SOUNDS[0], &BUILTIN_SOUNDS[1]);

        for apply_marker in markers {
            let dir = temp_app_data_dir();
            let mut data = AppStoreData::default();
            assert!(seed_builtin_sounds(&dir, &mut data));

            let sounds_dir = dir.join("sounds");
            let marked_path = sounds_dir.join(marked.file_name);
            let unmarked_path = sounds_dir.join(unmarked.file_name);
            fs::write(&marked_path, b"user edited").unwrap();
            fs::write(&unmarked_path, b"stale").unwrap();

            // 마커는 한쪽에만 — 가드가 엔트리별로 판정하는지 확인
            let marked_key = marked_path.to_string_lossy().to_string();
            apply_marker(data.sound_library.get_mut(&marked_key).unwrap());

            seed_builtin_sounds(&dir, &mut data);
            assert_eq!(
                fs::read(&marked_path).unwrap(),
                b"user edited",
                "{} 덮어써짐",
                marked.file_name
            );
            assert_eq!(
                fs::read(&unmarked_path).unwrap(),
                unmarked.bytes,
                "{} 재시드 안 됨",
                unmarked.file_name
            );

            let _ = fs::remove_dir_all(&dir);
        }
    }
}
