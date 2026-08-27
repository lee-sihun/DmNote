use once_cell::sync::Lazy;

use crate::models::{KeyMappings, KeyPositions, StatPositions};

static DEFAULT_KEYS_RAW: &str = include_str!("../default_keys.json");
static DEFAULT_POSITIONS_RAW: &str = include_str!("../default_positions.json");
static DEFAULT_STAT_POSITIONS_RAW: &str = include_str!("../default_stat_positions.json");

static DEFAULT_KEYS: Lazy<KeyMappings> = Lazy::new(|| {
    serde_json::from_str(DEFAULT_KEYS_RAW).expect("failed to parse default key mappings")
});

static DEFAULT_POSITIONS: Lazy<KeyPositions> = Lazy::new(|| {
    serde_json::from_str(DEFAULT_POSITIONS_RAW).expect("failed to parse default key positions")
});

static DEFAULT_STAT_POSITIONS: Lazy<StatPositions> = Lazy::new(|| {
    serde_json::from_str(DEFAULT_STAT_POSITIONS_RAW)
        .expect("failed to parse default stat positions")
});

/// 기본 키 매핑에 대한 참조 반환 (메모리 할당 없음)
pub fn default_keys() -> &'static KeyMappings {
    &DEFAULT_KEYS
}

/// 기본 키 위치에 대한 참조 반환 (메모리 할당 없음)
pub fn default_positions() -> &'static KeyPositions {
    &DEFAULT_POSITIONS
}

/// 기본 통계 위치에 대한 참조 반환 (메모리 할당 없음)
pub fn default_stat_positions() -> &'static StatPositions {
    &DEFAULT_STAT_POSITIONS
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

    use super::{default_keys, default_positions, default_stat_positions};

    #[test]
    fn default_key_mappings_and_positions_have_matching_modes_and_lengths() {
        assert_eq!(default_keys().len(), default_positions().len());
        for (mode, keys) in default_keys() {
            let positions = default_positions()
                .get(mode)
                .unwrap_or_else(|| panic!("missing default positions for {mode}"));
            assert_eq!(keys.len(), positions.len(), "length mismatch for {mode}");
        }
    }

    #[test]
    fn default_data_url_images_are_decodable_svg_documents() {
        fn assert_decodable_svg_images(
            collection: &str,
            mode: &str,
            index: usize,
            images: [&Option<String>; 2],
            data_url_count: &mut usize,
        ) {
            for image in images
                .into_iter()
                .flatten()
                .filter(|image| image.starts_with("data:"))
            {
                *data_url_count += 1;
                let (header, payload) = image
                    .split_once(',')
                    .unwrap_or_else(|| panic!("invalid data URL at {collection}.{mode}[{index}]"));
                assert_eq!(header, "data:image/svg+xml;base64");
                let bytes = BASE64_STANDARD.decode(payload).unwrap_or_else(|error| {
                    panic!("invalid base64 at {collection}.{mode}[{index}]: {error}")
                });
                let svg = std::str::from_utf8(&bytes).unwrap_or_else(|error| {
                    panic!("invalid SVG text at {collection}.{mode}[{index}]: {error}")
                });
                assert!(
                    svg.trim_start().starts_with("<svg") && svg.trim_end().ends_with("</svg>"),
                    "invalid SVG document at {collection}.{mode}[{index}]"
                );
            }
        }

        let mut data_url_count = 0;
        for (mode, positions) in default_positions() {
            for (index, position) in positions.iter().enumerate() {
                assert_decodable_svg_images(
                    "keyPositions",
                    mode,
                    index,
                    [&position.active_image, &position.inactive_image],
                    &mut data_url_count,
                );
            }
        }
        for (mode, positions) in default_stat_positions() {
            for (index, stat) in positions.iter().enumerate() {
                assert_decodable_svg_images(
                    "statPositions",
                    mode,
                    index,
                    [&stat.position.active_image, &stat.position.inactive_image],
                    &mut data_url_count,
                );
            }
        }
        assert!(
            data_url_count > 0,
            "default preset must exercise image migration"
        );
    }

    #[test]
    fn default_stats_exist_for_every_default_mode() {
        assert_eq!(default_keys().len(), default_stat_positions().len());
        for mode in default_keys().keys() {
            assert!(
                default_stat_positions()
                    .get(mode)
                    .is_some_and(|positions| !positions.is_empty()),
                "missing default stats for {mode}"
            );
        }
    }
}
