use super::*;

pub(super) fn read_preset_file(path: &Path) -> CmdResult<PresetFile> {
    let content = fs::read_to_string(path)?;
    let mut value: serde_json::Value =
        serde_json::from_str(&content).map_err(|_| CommandError::msg("invalid-preset"))?;
    scrub_removed_text_outline_fields(&mut value);
    if let Some(detail) = invalid_position_style_detail(&value) {
        return Err(CommandError::msg(format!("invalid-preset: {detail}")));
    }
    default_preset_note_gradient_multipliers(&mut value);
    serde_json::from_value(value).map_err(|_| CommandError::msg("invalid-preset"))
}

fn default_preset_note_gradient_multipliers(value: &mut serde_json::Value) {
    for collection in POSITION_COLLECTION_FIELDS {
        let Some(modes) = value
            .get_mut(collection)
            .and_then(serde_json::Value::as_object_mut)
        else {
            continue;
        };
        for position in modes
            .values_mut()
            .filter_map(serde_json::Value::as_array_mut)
            .flatten()
        {
            default_missing_note_gradient_multipliers(position);
        }
    }
}

pub(super) fn invalid_position_style_detail(preset: &serde_json::Value) -> Option<String> {
    const ELEMENT_FIELDS: [&str; 9] = [
        "backgroundGradient",
        "activeBackgroundGradient",
        "borderGradient",
        "activeBorderGradient",
        "fontGradient",
        "activeFontGradient",
        "noteBorderGradient",
        "noteGradient",
        "noteGlowGradient",
    ];
    const COUNTER_FIELDS: [&str; 2] = ["fillIdleGradient", "fillActiveGradient"];
    const SHADOW_FIELDS: [&str; 2] = ["shadow", "activeShadow"];
    const IMAGE_TRANSFORM_FIELDS: [&str; 2] = ["idleImageTransform", "activeImageTransform"];

    for collection_name in POSITION_COLLECTION_FIELDS {
        let Some(modes) = preset
            .get(collection_name)
            .and_then(serde_json::Value::as_object)
        else {
            continue;
        };
        for (mode, entries) in modes {
            let Some(entries) = entries.as_array() else {
                continue;
            };
            for (index, entry) in entries.iter().enumerate() {
                let Some(entry) = entry.as_object() else {
                    continue;
                };
                for field in ELEMENT_FIELDS {
                    let error = match field {
                        "noteBorderGradient" => invalid_note_gradient_error(
                            entry.get(field),
                            "unsupported note border color",
                        ),
                        "noteGradient" | "noteGlowGradient" => invalid_note_gradient_error(
                            entry.get(field),
                            "unsupported note gradient color",
                        ),
                        _ => invalid_gradient_error(entry.get(field)),
                    };
                    if let Some(error) = error {
                        return Some(format!(
                            "{collection_name}[{mode:?}][{index}].{field}: {error}"
                        ));
                    }
                }
                for field in SHADOW_FIELDS {
                    // null은 Option 역직렬화와 동일하게 "값 없음" 취급
                    let Some(value) = entry.get(field).filter(|value| !value.is_null()) else {
                        continue;
                    };
                    if let Some((suffix, error)) = invalid_shadow_error(value) {
                        return Some(format!(
                            "{collection_name}[{mode:?}][{index}].{field}{suffix}: {error}"
                        ));
                    }
                }
                for field in IMAGE_TRANSFORM_FIELDS {
                    let Some(value) = entry.get(field).filter(|value| !value.is_null()) else {
                        continue;
                    };
                    if let Some((suffix, error)) = invalid_image_transform_error(value) {
                        return Some(format!(
                            "{collection_name}[{mode:?}][{index}].{field}{suffix}: {error}"
                        ));
                    }
                }
                let Some(counter) = entry.get("counter").and_then(serde_json::Value::as_object)
                else {
                    continue;
                };
                for field in COUNTER_FIELDS {
                    if let Some(error) = invalid_gradient_error(counter.get(field)) {
                        return Some(format!(
                            "{collection_name}[{mode:?}][{index}].counter.{field}: {error}"
                        ));
                    }
                }
            }
        }
    }
    None
}

fn invalid_gradient_error(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    let gradient = match serde_json::from_value::<Option<GradientSpec>>(value.clone()) {
        Ok(gradient) => gradient,
        Err(error) => return Some(error.to_string()),
    }?;
    // 공백 stop 색은 로드 복구가 수렴하지 않는 손상 값이라 문에서 거부
    gradient
        .stops
        .iter()
        .position(|stop| stop.color.trim().is_empty())
        .map(|index| format!("stops[{index}].color must not be blank"))
}

fn invalid_note_gradient_error(
    value: Option<&serde_json::Value>,
    color_error: &str,
) -> Option<String> {
    let value = value?;
    let gradient = match serde_json::from_value::<Option<GradientSpec>>(value.clone()) {
        Ok(gradient) => gradient,
        Err(error) => return Some(error.to_string()),
    }?;
    gradient
        .note_border_invalid_stop_index()
        .map(|index| format!("stops[{index}].color contains an {color_error}"))
}

fn invalid_shadow_error(value: &serde_json::Value) -> Option<(&'static str, &'static str)> {
    let Some(shadow) = value.as_object() else {
        return Some(("", "must be an object"));
    };
    if !shadow
        .get("enabled")
        .is_some_and(serde_json::Value::is_boolean)
    {
        return Some((".enabled", "must be a boolean"));
    }
    if shadow
        .get("color")
        .and_then(serde_json::Value::as_str)
        .is_none_or(str::is_empty)
    {
        return Some((".color", "must be a non-empty string"));
    }
    for field in ["offsetX", "offsetY"] {
        if !shadow
            .get(field)
            .and_then(serde_json::Value::as_f64)
            .is_some_and(|value| {
                value.is_finite() && (SHADOW_OFFSET_MIN..=SHADOW_OFFSET_MAX).contains(&value)
            })
        {
            let suffix = if field == "offsetX" {
                ".offsetX"
            } else {
                ".offsetY"
            };
            return Some((suffix, "must be a finite number between -100 and 100"));
        }
    }
    if !shadow
        .get("blur")
        .and_then(serde_json::Value::as_f64)
        .is_some_and(|value| {
            value.is_finite() && (SHADOW_BLUR_MIN..=SHADOW_BLUR_MAX).contains(&value)
        })
    {
        return Some((".blur", "must be a finite number between 0 and 100"));
    }
    None
}

// 이미지 변환은 그림자와 같은 정책으로 문에서 거부한다 - 문서 검증(editor.rs)과 같은 범위
fn invalid_image_transform_error(
    value: &serde_json::Value,
) -> Option<(&'static str, &'static str)> {
    use crate::models::{
        IMAGE_TRANSFORM_OFFSET_MAX, IMAGE_TRANSFORM_OFFSET_MIN, IMAGE_TRANSFORM_ROTATION_MAX,
        IMAGE_TRANSFORM_ROTATION_MIN, IMAGE_TRANSFORM_SCALE_MAX, IMAGE_TRANSFORM_SCALE_MIN,
    };
    let Some(transform) = value.as_object() else {
        return Some(("", "must be an object"));
    };
    for (field, suffix, min, max, error) in [
        (
            "offsetX",
            ".offsetX",
            IMAGE_TRANSFORM_OFFSET_MIN,
            IMAGE_TRANSFORM_OFFSET_MAX,
            "must be a finite number between -500 and 500",
        ),
        (
            "offsetY",
            ".offsetY",
            IMAGE_TRANSFORM_OFFSET_MIN,
            IMAGE_TRANSFORM_OFFSET_MAX,
            "must be a finite number between -500 and 500",
        ),
        (
            "rotation",
            ".rotation",
            IMAGE_TRANSFORM_ROTATION_MIN,
            IMAGE_TRANSFORM_ROTATION_MAX,
            "must be a finite number between -180 and 180",
        ),
        (
            "scale",
            ".scale",
            IMAGE_TRANSFORM_SCALE_MIN,
            IMAGE_TRANSFORM_SCALE_MAX,
            "must be a finite number between 0.1 and 10",
        ),
    ] {
        if !transform
            .get(field)
            .and_then(serde_json::Value::as_f64)
            .is_some_and(|value| value.is_finite() && (min..=max).contains(&value))
        {
            return Some((suffix, error));
        }
    }
    None
}

#[cfg(test)]
pub(crate) fn read_preset_file_for_simulation(path: &Path) -> CmdResult<PresetFile> {
    read_preset_file(path)
}
