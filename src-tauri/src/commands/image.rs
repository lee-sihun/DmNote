use gif::Repeat;
use gif_dispose::Screen;
use rfd::FileDialog;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use uuid::Uuid;
use webp_animation::{AnimParams, Encoder, EncoderOptions, EncodingConfig, EncodingType, LossyEncodingConfig};

use crate::app_state::AppState;

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
///
/// GIF는 UX를 위해 즉시 원본 경로를 반환하고, 백그라운드에서 WebP 최적화를 수행한 뒤
/// 스토어의 이미지 경로를 자동으로 치환합니다.
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

    let dest_path = copy_image_to_app_data(&path, &images_dir, &ext)?;

    // GIF는 즉시 원본을 보여주고, 백그라운드 최적화 완료 후 자동 치환
    if ext == "gif" {
        schedule_gif_optimization(app.clone(), dest_path.clone(), images_dir.clone());
    }

    Ok(ImageLoadResponse {
        success: true,
        error: None,
        image_path: Some(dest_path.to_string_lossy().to_string()),
    })
}

fn schedule_gif_optimization(app: tauri::AppHandle, gif_path: PathBuf, images_dir: PathBuf) {
    std::thread::spawn(move || {
        let optimized_path = match try_convert_gif_to_cached_webp(&gif_path, &images_dir) {
            Ok(Some(path)) => path,
            Ok(None) => return,
            Err(error) => {
                log::warn!("[Image] 백그라운드 GIF 최적화 실패: {error}");
                return;
            }
        };

        if optimized_path == gif_path {
            return;
        }

        if let Err(error) =
            replace_store_image_path_references(&app, &gif_path, &optimized_path)
        {
            log::warn!("[Image] 최적화 이미지 경로 치환 실패: {error}");
        }
    });
}

fn copy_image_to_app_data(
    source_path: &Path,
    images_dir: &Path,
    extension: &str,
) -> Result<PathBuf, String> {
    let dest_path = images_dir.join(format!("{}.{}", Uuid::new_v4(), extension));
    fs::copy(source_path, &dest_path).map_err(|e| format!("이미지 파일 복사 실패: {e}"))?;
    Ok(dest_path)
}

fn replace_store_image_path_references(
    app: &tauri::AppHandle,
    from_path: &Path,
    to_path: &Path,
) -> Result<(), String> {
    let from = from_path.to_string_lossy().to_string();
    let to = to_path.to_string_lossy().to_string();
    if from == to {
        return Ok(());
    }

    let state = app.state::<AppState>();
    let snapshot = state.store.snapshot();
    let has_reference = snapshot.key_positions.values().any(|positions| {
        positions.iter().any(|position| {
            position.active_image.as_deref() == Some(from.as_str())
                || position.inactive_image.as_deref() == Some(from.as_str())
        })
    }) || snapshot.stat_positions.values().any(|positions| {
        positions.iter().any(|stat_position| {
            stat_position.position.active_image.as_deref() == Some(from.as_str())
                || stat_position.position.inactive_image.as_deref() == Some(from.as_str())
        })
    });

    if !has_reference {
        // 아직 저장되지 않은(편집 중인) 참조일 수 있음
        let _ = app.emit(
            "image:optimized",
            serde_json::json!({ "fromPath": from, "toPath": to }),
        );
        return Ok(());
    }

    let mut changed = false;

    let updated = state
        .store
        .update(|store| {
            for positions in store.key_positions.values_mut() {
                for position in positions.iter_mut() {
                    if position.active_image.as_deref() == Some(from.as_str()) {
                        position.active_image = Some(to.clone());
                        changed = true;
                    }
                    if position.inactive_image.as_deref() == Some(from.as_str()) {
                        position.inactive_image = Some(to.clone());
                        changed = true;
                    }
                }
            }

            for positions in store.stat_positions.values_mut() {
                for stat_position in positions.iter_mut() {
                    if stat_position.position.active_image.as_deref() == Some(from.as_str()) {
                        stat_position.position.active_image = Some(to.clone());
                        changed = true;
                    }
                    if stat_position.position.inactive_image.as_deref() == Some(from.as_str()) {
                        stat_position.position.inactive_image = Some(to.clone());
                        changed = true;
                    }
                }
            }
        })
        .map_err(|error| format!("스토어 업데이트 실패: {error}"))?;

    if !changed {
        // snapshot 이후 참조가 사라진 레이스 케이스
        let _ = app.emit(
            "image:optimized",
            serde_json::json!({ "fromPath": from, "toPath": to }),
        );
        return Ok(());
    }

    app.emit("positions:changed", &updated.key_positions)
        .map_err(|error| format!("positions:changed emit 실패: {error}"))?;
    app.emit("statPositions:changed", &updated.stat_positions)
        .map_err(|error| format!("statPositions:changed emit 실패: {error}"))?;
    let _ = app.emit(
        "image:optimized",
        serde_json::json!({ "fromPath": from, "toPath": to }),
    );

    Ok(())
}

fn try_convert_gif_to_cached_webp(
    source_path: &Path,
    images_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let gif_bytes = fs::read(source_path).map_err(|e| format!("GIF 파일 읽기 실패: {e}"))?;
    if gif_bytes.is_empty() {
        return Ok(None);
    }

    let hash = sha256_hex(&gif_bytes);
    let cached_webp_path = images_dir.join(format!("gif-cache-{hash}.webp"));
    if cached_webp_path.exists() {
        return Ok(Some(cached_webp_path));
    }

    convert_gif_to_webp(&gif_bytes, &cached_webp_path)?;
    Ok(Some(cached_webp_path))
}

fn convert_gif_to_webp(gif_bytes: &[u8], output_path: &Path) -> Result<(), String> {
    let mut gif_opts = gif::DecodeOptions::new();
    // gif-dispose 사용 시 indexed 모드가 필요합니다.
    gif_opts.set_color_output(gif::ColorOutput::Indexed);

    let cursor = Cursor::new(gif_bytes);
    let mut decoder = gif_opts
        .read_info(cursor)
        .map_err(|e| format!("GIF 디코더 초기화 실패: {e}"))?;

    let width = decoder.width() as u32;
    let height = decoder.height() as u32;
    if width == 0 || height == 0 {
        return Err("유효하지 않은 GIF 크기입니다.".to_string());
    }

    let repeat = decoder.repeat();
    let mut screen = Screen::new_decoder(&decoder);

    let mut encoder_options = EncoderOptions::default();
    encoder_options.anim_params = AnimParams {
        loop_count: gif_repeat_to_loop_count(repeat),
    };
    encoder_options.allow_mixed = true;
    encoder_options.minimize_size = true;
    encoder_options.encoding_config = Some(EncodingConfig {
        encoding_type: EncodingType::Lossy(LossyEncodingConfig {
            alpha_compression: true,
            ..Default::default()
        }),
        quality: 78.0,
        method: 4,
    });

    let mut encoder = Encoder::new_with_options((width, height), encoder_options)
        .map_err(|e| format!("WebP 인코더 초기화 실패: {e}"))?;

    let mut frame_count = 0usize;
    let mut timestamp_ms = 0i32;

    loop {
        let frame_opt = decoder
            .read_next_frame()
            .map_err(|e| format!("GIF 프레임 읽기 실패: {e}"))?;
        let Some(frame) = frame_opt else {
            break;
        };

        screen
            .blit_frame(frame)
            .map_err(|e| format!("GIF 프레임 합성 실패: {e}"))?;

        let (rgba_pixels, _, _) = screen.pixels_rgba().to_contiguous_buf();
        let mut rgba_bytes = Vec::with_capacity(rgba_pixels.len() * 4);
        for px in rgba_pixels.iter() {
            rgba_bytes.extend_from_slice(&[px.r, px.g, px.b, px.a]);
        }

        encoder
            .add_frame(&rgba_bytes, timestamp_ms)
            .map_err(|e| format!("WebP 프레임 추가 실패: {e}"))?;

        let frame_delay_ms = i32::from(frame.delay.max(1)).saturating_mul(10);
        timestamp_ms = timestamp_ms.saturating_add(frame_delay_ms);
        frame_count += 1;
    }

    if frame_count == 0 {
        return Err("GIF 프레임이 없습니다.".to_string());
    }

    let final_timestamp_ms = timestamp_ms.max(10);
    let webp_data = encoder
        .finalize(final_timestamp_ms)
        .map_err(|e| format!("WebP 인코딩 마무리 실패: {e}"))?;

    fs::write(output_path, &webp_data[..])
        .map_err(|e| format!("변환된 WebP 파일 저장 실패: {e}"))?;

    Ok(())
}

fn gif_repeat_to_loop_count(repeat: Repeat) -> i32 {
    match repeat {
        Repeat::Infinite => 0,
        Repeat::Finite(0) => 1,
        Repeat::Finite(count) => i32::from(count),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
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
