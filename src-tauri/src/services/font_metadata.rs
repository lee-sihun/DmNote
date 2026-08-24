use std::path::Path;

use anyhow::{anyhow, Context, Result};
use ttf_parser::{name_id, Face, Tag};

use crate::models::FontWeightRange;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontMetadata {
    pub family_name: String,
    pub weight_ranges: Vec<FontWeightRange>,
}

fn decode_font_bytes(bytes: &[u8]) -> Result<Vec<u8>> {
    match bytes.get(..4) {
        Some(b"wOFF") => wuff::decompress_woff1(bytes)
            .map_err(|error| anyhow!("failed to decode WOFF font: {error}")),
        Some(b"wOF2") => wuff::decompress_woff2(bytes)
            .map_err(|error| anyhow!("failed to decode WOFF2 font: {error}")),
        _ => Ok(bytes.to_vec()),
    }
}

fn family_name(face: &Face<'_>) -> Option<String> {
    [name_id::TYPOGRAPHIC_FAMILY, name_id::FAMILY]
        .into_iter()
        .find_map(|target_id| {
            face.names()
                .into_iter()
                .filter(|name| name.name_id == target_id)
                .find_map(|name| name.to_string())
        })
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

fn font_weight_ranges(face: &Face<'_>) -> Vec<FontWeightRange> {
    if let Some(variable_weight) = face
        .variation_axes()
        .into_iter()
        .find(|axis| axis.tag == Tag::from_bytes(b"wght"))
        .map(|axis| {
            let min = axis.min_value.round().clamp(1.0, 1000.0) as u16;
            let max = axis.max_value.round().clamp(1.0, 1000.0) as u16;
            FontWeightRange {
                min: min.min(max),
                max: min.max(max),
            }
        })
    {
        return vec![variable_weight];
    }

    let weight = face.weight().to_number().clamp(1, 1000);
    vec![FontWeightRange {
        min: weight,
        max: weight,
    }]
}

pub fn parse_font_metadata_bytes(bytes: &[u8]) -> Result<FontMetadata> {
    let decoded = decode_font_bytes(bytes)?;
    let face = Face::parse(&decoded, 0).map_err(|error| anyhow!("invalid font: {error}"))?;
    let family_name = family_name(&face).ok_or_else(|| anyhow!("font family name is missing"))?;

    Ok(FontMetadata {
        family_name,
        weight_ranges: font_weight_ranges(&face),
    })
}

pub fn parse_font_metadata(path: &Path) -> Result<FontMetadata> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("failed to read font metadata from {}", path.display()))?;
    parse_font_metadata_bytes(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bundled_variable_woff2_metadata() {
        let bytes = include_bytes!("../../../src/renderer/assets/fonts/PretendardVariable.woff2");
        let metadata = parse_font_metadata_bytes(bytes).unwrap();

        assert!(metadata.family_name.contains("Pretendard"));
        assert_eq!(
            metadata.weight_ranges,
            vec![FontWeightRange { min: 45, max: 930 }]
        );
    }
}
