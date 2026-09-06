use quick_xml::{
    events::Event,
    name::{Namespace, ResolveResult},
    NsReader,
};
use serde::Serialize;
use std::{
    fs::File,
    io::{self, BufRead, BufReader, Cursor, Read, Seek},
    path::Path,
};
use tauri::{Manager, WebviewWindow};

use crate::{
    commands::dialog::parented_file_dialog,
    errors::{CmdResult, CommandError},
    state::assets::image_asset::{import_image_file, SUPPORTED_IMAGE_EXTENSIONS},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageLoadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
}

// infer의 시그니처 판정에 필요한 선두 바이트
const IMAGE_PREFIX_LENGTH: u64 = 8192;
// XML prolog는 스펙상 길이 상한이 없다 - 문서를 훑는 데 허용할 예산.
// 예산을 넘기면 루트까지만 확인하고 통과시킨다 (큰 SVG를 거절하지 않기 위해)
const SVG_PARSE_BUDGET: u64 = 16 << 20;
const SVG_NAMESPACE: Namespace<'static> = Namespace(b"http://www.w3.org/2000/svg");
const INVALID_IMAGE_CONTENT: &str = "invalid-image-content";

/// 로컬 이미지 파일을 선택해서 앱 데이터 디렉토리로 복사한 뒤 경로를 반환합니다.
/// 저장소에는 base64 대신 파일 경로만 저장해 직렬화/역직렬화 비용을 줄입니다.
#[tauri::command]
pub async fn image_load(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> CmdResult<ImageLoadResponse> {
    let picked = parented_file_dialog(&window, "Images", SUPPORTED_IMAGE_EXTENSIONS)
        .pick_file()
        .await;

    let Some(file) = picked else {
        return Ok(ImageLoadResponse {
            success: false,
            error: None,
            error_code: None,
            image_path: None,
        });
    };

    let source_path = file.path().to_path_buf();
    let extension =
        normalize_image_extension(source_path.extension().and_then(|value| value.to_str()));
    let images_dir = app.path().app_data_dir()?.join("images");
    let imported = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<_> {
        if !image_file_has_supported_content(&source_path)? {
            return Ok(None);
        }
        import_image_file(&source_path, &images_dir, &extension).map(Some)
    })
    .await
    .map_err(|error| CommandError::msg(format!("image import task failed: {error}")))??;

    let Some(imported) = imported else {
        return Ok(ImageLoadResponse {
            success: false,
            error: Some("Selected file is not valid image content".to_string()),
            error_code: Some(INVALID_IMAGE_CONTENT.to_string()),
            image_path: None,
        });
    };

    Ok(ImageLoadResponse {
        success: true,
        error: None,
        error_code: None,
        image_path: Some(imported.path.to_string_lossy().to_string()),
    })
}

fn image_file_has_supported_content(path: &Path) -> io::Result<bool> {
    let mut prefix = Vec::with_capacity(IMAGE_PREFIX_LENGTH as usize);
    File::open(path)?
        .take(IMAGE_PREFIX_LENGTH)
        .read_to_end(&mut prefix)?;
    if has_image_signature(&prefix) {
        return Ok(true);
    }
    Ok(is_svg_document(path))
}

fn has_image_signature(bytes: &[u8]) -> bool {
    infer::get(bytes).is_some_and(|kind| kind.matcher_type() == infer::MatcherType::Image)
}

/// SVG에는 매직넘버가 없다. RFC 7303 §9.1과 SVG 미디어 타입 등록서 모두 magic number를
/// 비워 두고 있고, XML prolog는 길이 상한이 없어 고정 prefix 스캔으로는 판정할 수 없다.
/// 그래서 실제로 파싱해 루트가 SVG namespace의 `svg`인지 확인한다
fn is_svg_document(path: &Path) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };

    let mut bom = [0u8; 2];
    let Ok(read) = read_prefix(&mut file, &mut bom) else {
        return false;
    };
    if file.rewind().is_err() {
        return false;
    }

    // quick-xml은 ASCII 호환 바이트를 전제하므로 UTF-16은 먼저 옮겨 담는다
    if read == 2 && (bom == [0xFF, 0xFE] || bom == [0xFE, 0xFF]) {
        let Some((utf8, truncated)) = transcode_utf16(file, bom[0] == 0xFF) else {
            return false;
        };
        // 옮겨 담으면 길이가 줄어 읽은 바이트로는 잘렸는지 알 수 없다 - 플래그로 전달한다
        return scan_svg(NsReader::from_reader(Cursor::new(utf8)), truncated);
    }

    let size = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    scan_svg(
        NsReader::from_reader(BufReader::new(file.take(SVG_PARSE_BUDGET))),
        size > SVG_PARSE_BUDGET,
    )
}

fn read_prefix(file: &mut File, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..])? {
            0 => break,
            count => filled += count,
        }
    }
    Ok(filled)
}

fn transcode_utf16(file: File, little_endian: bool) -> Option<(Vec<u8>, bool)> {
    let mut raw = Vec::new();
    file.take(SVG_PARSE_BUDGET).read_to_end(&mut raw).ok()?;
    // 예산에 걸려 잘린 경우에만 관대하게 본다. 온전한 파일은 엄격히 판정한다
    let truncated = raw.len() as u64 >= SVG_PARSE_BUDGET;
    let body = raw.get(2..)?;
    if !truncated && body.len() % 2 != 0 {
        return None;
    }

    let units = body
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| {
            let bytes = [pair[0], pair[1]];
            if little_endian {
                u16::from_le_bytes(bytes)
            } else {
                u16::from_be_bytes(bytes)
            }
        })
        .collect::<Vec<_>>();

    let text = if truncated {
        char::decode_utf16(units)
            .map(|unit| unit.unwrap_or(char::REPLACEMENT_CHARACTER))
            .collect::<String>()
    } else {
        char::decode_utf16(units)
            .collect::<Result<String, _>>()
            .ok()?
    };
    Some((text.into_bytes(), truncated))
}

fn scan_svg<R: BufRead>(mut reader: NsReader<R>, truncated: bool) -> bool {
    let mut buffer = Vec::new();
    let mut root_seen = false;
    let mut root_closed = false;
    let mut depth = 0_usize;

    loop {
        buffer.clear();
        match reader.read_resolved_event_into(&mut buffer) {
            Ok((namespace, Event::Start(tag))) => {
                // 루트가 닫힌 뒤의 요소는 두 번째 루트다
                if root_closed {
                    return false;
                }
                if !root_seen {
                    if !is_svg_root(namespace, tag.local_name().as_ref()) {
                        return false;
                    }
                    root_seen = true;
                }
                depth += 1;
            }
            Ok((namespace, Event::Empty(tag))) => {
                if root_closed {
                    return false;
                }
                if !root_seen {
                    if !is_svg_root(namespace, tag.local_name().as_ref()) {
                        return false;
                    }
                    // 빈 루트는 그 자리에서 닫힌다
                    root_seen = true;
                    root_closed = true;
                }
            }
            Ok((_, Event::End(_))) => {
                depth = depth.saturating_sub(1);
                if root_seen && depth == 0 {
                    root_closed = true;
                }
            }
            // 루트 바깥에 올 수 있는 것은 공백뿐이다 (XML 1.0 Misc)
            Ok((_, Event::Text(text))) => {
                if (!root_seen || root_closed) && !text.iter().all(u8::is_ascii_whitespace) {
                    return false;
                }
            }
            Ok((_, Event::CData(_))) => {
                if !root_seen || root_closed {
                    return false;
                }
            }
            // 예산에 걸려 잘린 문서는 뒷부분을 판정하지 않는다.
            // 루트를 이미 확인했으면 통과시킨다 - 큰 SVG를 거절하지 않기 위한 계약
            Ok((_, Event::Eof)) => return if truncated { root_seen } else { root_closed },
            // prolog(선언, PI, 주석, DOCTYPE)는 그대로 지나간다
            Ok(_) => {}
            // 예산 경계가 태그나 주석 한가운데를 자르면 파싱 오류로 나온다.
            // 잘린 문서의 오류는 문서가 잘못됐다는 근거가 아니다
            Err(_) => return truncated && root_seen,
        }
    }
}

fn is_svg_root(namespace: ResolveResult, local_name: &[u8]) -> bool {
    matches!(namespace, ResolveResult::Bound(value) if value == SVG_NAMESPACE)
        && local_name == b"svg"
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
    use super::{image_file_has_supported_content, normalize_image_extension};
    use super::{ImageLoadResponse, INVALID_IMAGE_CONTENT, SVG_PARSE_BUDGET};
    use std::fs;
    use uuid::Uuid;

    struct Fixture {
        directory: std::path::PathBuf,
        path: std::path::PathBuf,
    }

    impl Fixture {
        fn new(name: &str, bytes: &[u8]) -> Self {
            let directory = std::env::temp_dir().join(format!("dmnote-image-{}", Uuid::new_v4()));
            fs::create_dir_all(&directory).unwrap();
            let path = directory.join(name);
            fs::write(&path, bytes).unwrap();
            Self { directory, path }
        }

        fn accepted(&self) -> bool {
            image_file_has_supported_content(&self.path).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn gif_extension_is_kept_without_format_conversion() {
        assert_eq!(normalize_image_extension(Some("GIF")), "gif");
    }

    #[test]
    fn unknown_extension_uses_existing_png_fallback() {
        assert_eq!(normalize_image_extension(Some("unknown")), "png");
        assert_eq!(normalize_image_extension(None), "png");
    }

    #[test]
    fn binary_image_signatures_are_accepted() {
        assert!(Fixture::new("a.png", b"\x89PNG\r\n\x1a\n").accepted());
        assert!(Fixture::new("a.gif", b"GIF89a").accepted());
    }

    #[test]
    fn text_file_with_png_extension_is_rejected() {
        assert!(!Fixture::new("not-an-image.png", b"plain text").accepted());
    }

    #[test]
    fn long_non_markup_file_is_rejected() {
        let bytes = "plain text ".repeat(2000);
        assert!(!Fixture::new("not-an-image.png", bytes.as_bytes()).accepted());
    }

    #[test]
    fn plain_svg_root_is_accepted() {
        let svg =
            br#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64"/></svg>"#;
        assert!(Fixture::new("a.svg", svg).accepted());
    }

    #[test]
    fn svg_after_declaration_comment_and_doctype_is_accepted() {
        let svg = br#"<?xml version="1.0" encoding="UTF-8"?>
<!-- icon -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg"/>"#;
        assert!(Fixture::new("a.svg", svg).accepted());
    }

    // XML prolog는 스펙상 길이 상한이 없다 - 고정 prefix로 판정하던 시절의 오탐 회귀
    #[test]
    fn svg_behind_a_comment_longer_than_the_signature_prefix_is_accepted() {
        let mut svg = format!("<!--{}-->", "c".repeat(9000)).into_bytes();
        svg.extend_from_slice(br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#);
        assert!(Fixture::new("a.svg", &svg).accepted());
    }

    #[test]
    fn svg_behind_whitespace_longer_than_the_signature_prefix_is_accepted() {
        let mut svg = " ".repeat(9000).into_bytes();
        svg.extend_from_slice(br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#);
        assert!(Fixture::new("a.svg", &svg).accepted());
    }

    #[test]
    fn svg_with_utf8_bom_is_accepted() {
        let mut svg = b"\xef\xbb\xbf".to_vec();
        svg.extend_from_slice(br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#);
        assert!(Fixture::new("a.svg", &svg).accepted());
    }

    #[test]
    fn namespace_prefixed_svg_root_is_accepted() {
        let svg = br#"<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>"#;
        assert!(Fixture::new("a.svg", svg).accepted());
    }

    // local name만 보면 통과하지만 SVG namespace가 아니면 브라우저도 그리지 못한다
    #[test]
    fn svg_local_name_in_a_foreign_namespace_is_rejected() {
        let svg = br#"<foo:svg xmlns:foo="http://example.com/not-svg"/>"#;
        assert!(!Fixture::new("a.svg", svg).accepted());
    }

    #[test]
    fn svg_without_namespace_is_rejected() {
        assert!(!Fixture::new("a.svg", br#"<svg><rect/></svg>"#).accepted());
    }

    #[test]
    fn second_root_element_is_rejected() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>"#;
        assert!(!Fixture::new("a.svg", svg).accepted());
    }

    #[test]
    fn trailing_text_after_the_root_is_rejected() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>trailing"#;
        assert!(!Fixture::new("a.svg", svg).accepted());
    }

    #[test]
    fn trailing_whitespace_and_comment_after_the_root_are_allowed() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>
<!-- done -->
"#;
        assert!(Fixture::new("a.svg", svg).accepted());
    }

    #[test]
    fn utf16_with_an_odd_trailing_byte_is_rejected() {
        let text = r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#;
        let mut bytes = vec![0xFF, 0xFE];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.push(0x20);
        assert!(!Fixture::new("a.svg", &bytes).accepted());
    }

    #[test]
    fn utf16_with_a_lone_surrogate_is_rejected() {
        let text = r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#;
        let mut bytes = vec![0xFF, 0xFE];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        // 짝 없는 high surrogate
        bytes.extend_from_slice(&0xD800_u16.to_le_bytes());
        assert!(!Fixture::new("a.svg", &bytes).accepted());
    }

    #[test]
    fn truncated_document_after_the_root_is_rejected() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><g>"#;
        assert!(!Fixture::new("a.svg", svg).accepted());
    }

    #[test]
    fn utf16le_svg_is_accepted() {
        let text = r#"<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>"#;
        let mut bytes = vec![0xFF, 0xFE];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        assert!(Fixture::new("a.svg", &bytes).accepted());
    }

    #[test]
    fn utf16be_svg_is_accepted() {
        let text = r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#;
        let mut bytes = vec![0xFE, 0xFF];
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        assert!(Fixture::new("a.svg", &bytes).accepted());
    }

    #[test]
    fn multibyte_content_does_not_break_detection() {
        let mut svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><text>"#.to_vec();
        svg.extend_from_slice("가".repeat(4096).as_bytes());
        svg.extend_from_slice(b"</text></svg>");
        assert!(Fixture::new("a.svg", &svg).accepted());
    }

    #[test]
    fn markup_whose_root_is_not_svg_is_rejected() {
        assert!(!Fixture::new("a.svg", br#"<html><svg></svg></html>"#).accepted());
    }

    // 예산을 넘겨도 루트를 이미 확인했으면 통과시킨다 - 큰 SVG를 거절하지 않는 계약
    #[test]
    fn document_larger_than_the_parse_budget_is_accepted_after_the_root() {
        let mut svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><text>"#.to_vec();
        svg.resize(SVG_PARSE_BUDGET as usize + 4096, b'x');
        assert!(Fixture::new("a.svg", &svg).accepted());
    }

    // 지도나 트레이스 내보내기는 path 하나가 예산을 넘는다.
    // 경계가 속성값 한가운데면 파서가 오류를 내는데 그건 문서가 잘못된 것이 아니다
    #[test]
    fn budget_boundary_inside_an_attribute_still_accepts() {
        let mut svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><path d=""#.to_vec();
        svg.resize(SVG_PARSE_BUDGET as usize + 4096, b'1');
        svg.extend_from_slice(br#""/></svg>"#);
        assert!(Fixture::new("a.svg", &svg).accepted());
    }

    #[test]
    fn budget_boundary_inside_a_comment_still_accepts() {
        let mut svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><!--"#.to_vec();
        svg.resize(SVG_PARSE_BUDGET as usize + 4096, b'c');
        svg.extend_from_slice(br#"--></svg>"#);
        assert!(Fixture::new("a.svg", &svg).accepted());
    }

    #[test]
    fn utf16_document_larger_than_the_budget_is_accepted_after_the_root() {
        let head = r#"<svg xmlns="http://www.w3.org/2000/svg"><text>"#;
        let mut bytes = vec![0xFF, 0xFE];
        for unit in head.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        while (bytes.len() as u64) < SVG_PARSE_BUDGET + 4096 {
            bytes.extend_from_slice(&(b'x' as u16).to_le_bytes());
        }
        assert!(Fixture::new("a.svg", &bytes).accepted());
    }

    // 잘리지 않은 문서의 파싱 오류는 그대로 거절이어야 한다
    #[test]
    fn malformed_small_document_is_still_rejected() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><path d="unclosed"#;
        assert!(!Fixture::new("a.svg", svg).accepted());
    }

    #[test]
    fn prolog_beyond_the_parse_budget_is_rejected() {
        let mut svg = format!("<!--{}-->", "c".repeat(SVG_PARSE_BUDGET as usize)).into_bytes();
        svg.extend_from_slice(br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#);
        assert!(!Fixture::new("a.svg", &svg).accepted());
    }

    #[test]
    fn response_serializes_error_code_and_keeps_cancellation_quiet() {
        let invalid = serde_json::to_value(ImageLoadResponse {
            success: false,
            error: Some("invalid image".to_string()),
            error_code: Some(INVALID_IMAGE_CONTENT.to_string()),
            image_path: None,
        })
        .unwrap();
        assert_eq!(invalid["errorCode"], INVALID_IMAGE_CONTENT);

        let cancelled = serde_json::to_value(ImageLoadResponse {
            success: false,
            error: None,
            error_code: None,
            image_path: None,
        })
        .unwrap();
        assert!(cancelled.get("errorCode").is_none());
        assert!(cancelled.get("error").is_none());
    }
}
