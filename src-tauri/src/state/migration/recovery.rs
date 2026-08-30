use super::*;

/// 레거시/비정상 store 파일 필드별 복구
pub(super) fn repair_legacy_state(value: Value) -> AppStoreData {
    let Value::Object(mut source) = value else {
        return normalize_state(AppStoreData::default());
    };
    migrate_legacy_repair_fields(&mut source);
    let source_keys = source.get("keys").cloned();
    let source_key_positions = source.get("keyPositions").cloned();

    let Value::Object(mut recovered) =
        serde_json::to_value(AppStoreData::default()).unwrap_or_else(|_| Value::Object(Map::new()))
    else {
        return normalize_state(AppStoreData::default());
    };

    for (field, value) in source {
        let previous = recovered.insert(field.clone(), value.clone());
        if serde_json::from_value::<AppStoreData>(Value::Object(recovered.clone())).is_err() {
            if let Some(partial) = recover_collection_field(&field, &value) {
                recovered.insert(field.clone(), partial);
                if serde_json::from_value::<AppStoreData>(Value::Object(recovered.clone())).is_ok()
                {
                    continue;
                }
            }

            log::warn!("[Store] Resetting invalid field to default: {field}");
            match previous {
                Some(value) => {
                    recovered.insert(field, value);
                }
                None => {
                    recovered.remove(&field);
                }
            }
        }
    }

    let mut data =
        serde_json::from_value::<AppStoreData>(Value::Object(recovered)).unwrap_or_default();
    migrate_legacy_knob_sensitivity(&mut data);
    repair_image_transforms(&mut data);
    repair_semantic_identities(&mut data);
    repair_custom_tab_key_layout_pairs(
        &mut data,
        source_keys.as_ref(),
        source_key_positions.as_ref(),
    );
    canonicalize_gradient_pairs(&mut data);
    canonicalize_image_modes(&mut data);
    migrate_custom_css_history_timestamps(&mut data.custom_css_history);
    normalize_state(data)
}

pub(super) fn repair_custom_tab_key_layout_pairs(
    data: &mut AppStoreData,
    source_keys: Option<&Value>,
    source_key_positions: Option<&Value>,
) -> bool {
    let tab_ids = data
        .custom_tabs
        .iter()
        .map(|tab| tab.id.clone())
        .collect::<Vec<_>>();
    let mut repaired = false;

    for mode in tab_ids {
        let source_keys = source_mode_array(source_keys, &mode);
        let source_positions = source_mode_array(source_key_positions, &mode);

        match (source_keys, source_positions) {
            (Some(_), Some(_)) => {}
            (None, Some(positions)) => {
                log::warn!(
                    "[Store] Rebuilding invalid keys mode '{mode}' with {} unassigned entries during recovery",
                    positions.len()
                );
                data.keys
                    .insert(mode, vec![KeySlot::default(); positions.len()]);
                repaired = true;
            }
            (Some(keys), None) => {
                log::warn!(
                    "[Store] Rebuilding invalid keyPositions mode '{mode}' with {} default entries during recovery",
                    keys.len()
                );
                data.key_positions
                    .insert(mode, vec![KeyPosition::default(); keys.len()]);
                repaired = true;
            }
            (None, None) => {
                log::warn!(
                    "[Store] Initializing missing keys and keyPositions modes '{mode}' during recovery"
                );
                data.keys.insert(mode.clone(), Vec::new());
                data.key_positions.insert(mode, Vec::new());
                repaired = true;
            }
        }
    }

    repaired
}

fn source_mode_array<'a>(collection: Option<&'a Value>, mode: &str) -> Option<&'a [Value]> {
    collection?
        .as_object()?
        .get(mode)?
        .as_array()
        .map(Vec::as_slice)
}

fn recover_collection_field(field: &str, value: &Value) -> Option<Value> {
    match field {
        "noteSettings" => recover_object_fields::<NoteSettings>(field, value),
        "customTabs" => recover_array_entries::<CustomTab>(field, value),
        "keys" => recover_key_mapping_entries(value),
        "soundLibrary" => recover_sound_library_entries(value),
        "keyPositions" => recover_key_position_entries(field, value),
        "statPositions" => recover_key_position_backed_entries::<StatPosition>(
            field,
            value,
            has_valid_stat_identity,
        ),
        "graphPositions" => recover_key_position_backed_entries::<GraphPosition>(
            field,
            value,
            has_valid_graph_identity,
        ),
        "knobPositions" => recover_key_position_backed_entries::<KnobPosition>(
            field,
            value,
            has_valid_knob_identity,
        ),
        "layerGroups" => recover_position_entries::<LayerGroupDef>(field, value),
        "keyCounters" => recover_key_counter_entries(value),
        "customCss" => recover_object_fields::<CustomCss>(field, value),
        "customCssHistory" => recover_array_entries::<CustomCssHistoryEntry>(field, value),
        "fontSettings" => recover_font_settings(value),
        "counterAnimationPresets" => recover_array_entries::<CounterAnimationPreset>(field, value),
        "tabCssOverrides" => recover_map_object_entries::<TabCss>(field, value),
        "tabNoteOverrides" => recover_map_object_entries::<TabNoteSettings>(field, value),
        "customJs" => recover_custom_js(value),
        "gridSettings" => recover_object_fields::<GridSettings>(field, value),
        "shortcuts" => recover_object_fields::<ShortcutsState>(field, value),
        _ => None,
    }
}

fn recover_object_fields<T>(field: &str, value: &Value) -> Option<Value>
where
    T: Default + DeserializeOwned + Serialize,
{
    let Value::Object(source) = value else {
        return None;
    };
    let Value::Object(mut recovered) = serde_json::to_value(T::default()).ok()? else {
        return None;
    };

    for (name, entry) in source {
        let previous = recovered.insert(name.clone(), entry.clone());
        if serde_json::from_value::<T>(Value::Object(recovered.clone())).is_err() {
            log::warn!(
                "[Store] Resetting invalid {field} child '{name}' to its default during recovery"
            );
            match previous {
                Some(value) => {
                    recovered.insert(name.clone(), value);
                }
                None => {
                    recovered.remove(name);
                }
            }
        }
    }
    Some(Value::Object(recovered))
}

fn recover_key_position_fields(field: &str, value: &Value) -> Option<Value> {
    let Value::Object(source) = value else {
        return None;
    };
    let Value::Object(mut recovered) = recover_object_fields::<KeyPosition>(field, value)? else {
        return None;
    };

    // sparse 폰트 필드는 부재 자체가 레거시 의미를 가진다
    if !source.contains_key("fontWeight") {
        recovered.remove("fontWeight");
    }
    let source_weight_is_valid = source
        .get("fontWeight")
        .is_none_or(|entry| serde_json::from_value::<Option<u32>>(entry.clone()).is_ok());
    if !source.contains_key("fontBold") && source_weight_is_valid {
        recovered.remove("fontBold");
    }

    Some(Value::Object(recovered))
}

fn recover_array_entries<T>(field: &str, value: &Value) -> Option<Value>
where
    T: DeserializeOwned,
{
    let Value::Array(entries) = value else {
        return None;
    };

    let mut recovered = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        match serde_json::from_value::<T>(entry.clone()) {
            Ok(_) => recovered.push(entry.clone()),
            Err(err) => {
                log::warn!(
                    "[Store] Removing invalid {field} entry '[{index}]' during recovery: {err}"
                );
            }
        }
    }
    Some(Value::Array(recovered))
}

pub(super) fn recover_key_mapping_entries(value: &Value) -> Option<Value> {
    let Value::Object(modes) = value else {
        return None;
    };

    let defaults = default_keys();
    let mut recovered_modes = Map::new();
    for (mode, entries) in modes {
        let recovered_entries = match entries {
            Value::Array(entries) => entries
                .iter()
                .map(|entry| {
                    serde_json::to_value(normalize_key_slot(entry.clone()))
                        .unwrap_or(Value::String(String::new()))
                })
                .collect(),
            _ => {
                log::warn!(
                    "[Store] Replacing invalid keys mode '{mode}' during recovery: expected an array"
                );
                defaults
                    .get(mode)
                    .map(|keys| {
                        keys.iter()
                            .filter_map(|slot| serde_json::to_value(slot).ok())
                            .collect()
                    })
                    .unwrap_or_default()
            }
        };
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }
    Some(Value::Object(recovered_modes))
}

fn recover_key_counter_entries(value: &Value) -> Option<Value> {
    let Value::Object(modes) = value else {
        return None;
    };

    let mut recovered_modes = Map::new();
    for (mode, counters) in modes {
        let Value::Object(counters) = counters else {
            log::warn!(
                "[Store] Replacing invalid keyCounters mode '{mode}' with an empty map during recovery"
            );
            recovered_modes.insert(mode.clone(), Value::Object(Map::new()));
            continue;
        };

        let mut recovered_counters = Map::new();
        for (key, count) in counters {
            if serde_json::from_value::<u32>(count.clone()).is_ok() {
                recovered_counters.insert(key.clone(), count.clone());
            } else {
                log::warn!(
                    "[Store] Removing invalid keyCounters entry '{mode}.{key}' during recovery"
                );
            }
        }
        recovered_modes.insert(mode.clone(), Value::Object(recovered_counters));
    }
    Some(Value::Object(recovered_modes))
}

fn recover_custom_js(value: &Value) -> Option<Value> {
    let Value::Object(settings) = value else {
        return None;
    };
    let mut candidate = settings.clone();
    if let Some(plugins) = settings.get("plugins") {
        let recovered_plugins = recover_array_entries::<JsPlugin>("customJs.plugins", plugins)
            .unwrap_or_else(|| Value::Array(Vec::new()));
        candidate.insert("plugins".to_string(), recovered_plugins);
    }
    recover_object_fields::<CustomJs>("customJs", &Value::Object(candidate))
}

pub(super) fn recover_sound_library_entries(value: &Value) -> Option<Value> {
    let Value::Object(entries) = value else {
        return None;
    };
    let default_entry = serde_json::to_value(SoundLibraryEntry::default()).ok()?;
    let mut recovered = Map::new();

    for (key, entry) in entries {
        if serde_json::from_value::<SoundLibraryEntry>(entry.clone()).is_ok() {
            recovered.insert(key.clone(), entry.clone());
            continue;
        }

        let entry_name = format!("soundLibrary.{key}");
        if let Some(partial) = recover_object_fields::<SoundLibraryEntry>(&entry_name, entry) {
            if serde_json::from_value::<SoundLibraryEntry>(partial.clone()).is_ok() {
                recovered.insert(key.clone(), partial);
                continue;
            }
        }

        // 외래 기기의 관리 사운드 경로 키도 재건 대상 — 삭제하면 재귀화 치유 기회가 사라짐
        let rebuildable_key = Path::new(key).is_absolute()
            || matches!(
                parse_portable_asset_reference(key),
                Some((AssetCategory::Sounds, _))
            );
        if rebuildable_key {
            log::warn!(
                "[Store] Rebuilding invalid soundLibrary entry '{key}' from its asset path during recovery"
            );
            recovered.insert(key.clone(), default_entry.clone());
        } else {
            log::warn!(
                "[Store] Removing invalid soundLibrary entry '{key}' with a non-absolute path during recovery"
            );
        }
    }

    Some(Value::Object(recovered))
}

fn recover_map_object_entries<T>(field: &str, value: &Value) -> Option<Value>
where
    T: Default + DeserializeOwned + Serialize,
{
    let Value::Object(entries) = value else {
        return None;
    };

    let mut recovered = Map::new();
    for (key, entry) in entries {
        if serde_json::from_value::<T>(entry.clone()).is_ok() {
            recovered.insert(key.clone(), entry.clone());
            continue;
        }

        let entry_name = format!("{field}.{key}");
        let Some(partial) = recover_object_fields::<T>(&entry_name, entry) else {
            log::warn!("[Store] Removing invalid {field} entry '{key}' during recovery");
            continue;
        };
        if serde_json::from_value::<T>(partial.clone()).is_ok() {
            recovered.insert(key.clone(), partial);
        } else {
            log::warn!("[Store] Removing unrecoverable {field} entry '{key}' during recovery");
        }
    }
    Some(Value::Object(recovered))
}

fn recover_key_position_backed_entries<T>(
    field: &str,
    value: &Value,
    has_valid_identity: fn(&Value) -> bool,
) -> Option<Value>
where
    T: DeserializeOwned,
{
    let Value::Object(modes) = value else {
        return None;
    };

    let mut recovered_modes = Map::new();
    for (mode, entries) in modes {
        let Value::Array(entries) = entries else {
            log::warn!(
                "[Store] Removing invalid {field} mode '{mode}' during recovery: expected an array"
            );
            continue;
        };

        let mut recovered_entries = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            if serde_json::from_value::<T>(entry.clone()).is_ok() {
                recovered_entries.push(entry.clone());
                continue;
            }

            let entry_name = format!("{field}.{mode}[{index}]");
            let mut candidate = entry.clone();
            recover_image_transform_children(&entry_name, &mut candidate);
            recover_invalid_counter_fill_gradient_children(&entry_name, &mut candidate);
            if serde_json::from_value::<T>(candidate.clone()).is_ok() {
                recovered_entries.push(candidate);
                continue;
            }

            if !has_valid_identity(&candidate) {
                log::warn!(
                    "[Store] Removing invalid {field} entry '{mode}[{index}]' with a damaged identity during recovery"
                );
                continue;
            }

            let Some(partial) = recover_key_position_fields(&entry_name, &candidate) else {
                log::warn!(
                    "[Store] Removing invalid {field} entry '{mode}[{index}]' during recovery"
                );
                continue;
            };
            if serde_json::from_value::<T>(partial.clone()).is_ok() {
                recovered_entries.push(partial);
            } else {
                log::warn!(
                    "[Store] Removing invalid {field} entry '{mode}[{index}]' with damaged non-layout fields during recovery"
                );
            }
        }
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }

    Some(Value::Object(recovered_modes))
}

fn value_field_deserializes<T>(value: &Value, field: &str) -> bool
where
    T: DeserializeOwned,
{
    value
        .get(field)
        .is_some_and(|entry| serde_json::from_value::<T>(entry.clone()).is_ok())
}

fn has_valid_stat_identity(value: &Value) -> bool {
    value_field_deserializes::<StatType>(value, "statType")
}

fn has_valid_graph_identity(value: &Value) -> bool {
    value_field_deserializes::<GraphStatType>(value, "statType")
        && value_field_deserializes::<GraphType>(value, "graphType")
}

fn has_valid_knob_identity(value: &Value) -> bool {
    value.get("axisId").is_none_or(Value::is_string)
}

fn recover_key_position_entries(field: &str, value: &Value) -> Option<Value> {
    let Value::Object(modes) = value else {
        return None;
    };
    let default_position = match serde_json::to_value(KeyPosition::default()) {
        Ok(value) => value,
        Err(err) => {
            log::warn!("[Store] Failed to serialize the default {field} entry: {err}");
            return None;
        }
    };

    let mut recovered_modes = Map::new();
    for (mode, entries) in modes {
        let Value::Array(entries) = entries else {
            log::warn!(
                "[Store] Removing invalid {field} mode '{mode}' during recovery: expected an array"
            );
            continue;
        };

        let mut recovered_entries = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            match serde_json::from_value::<KeyPosition>(entry.clone()) {
                Ok(_) => recovered_entries.push(entry.clone()),
                Err(err) => {
                    let entry_name = format!("{field}.{mode}[{index}]");
                    let mut candidate = entry.clone();
                    recover_image_transform_children(&entry_name, &mut candidate);
                    recover_invalid_counter_fill_gradient_children(&entry_name, &mut candidate);
                    let recovered = if serde_json::from_value::<KeyPosition>(candidate.clone())
                        .is_ok()
                    {
                        candidate
                    } else {
                        recover_key_position_fields(&entry_name, &candidate)
                        .filter(|candidate| {
                            serde_json::from_value::<KeyPosition>(candidate.clone()).is_ok()
                        })
                        .unwrap_or_else(|| {
                            log::warn!(
                                "[Store] Replacing invalid {field} entry '{mode}[{index}]' with default during recovery: {err}"
                            );
                            default_position.clone()
                        })
                    };
                    recovered_entries.push(recovered);
                }
            }
        }
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }
    Some(Value::Object(recovered_modes))
}

fn recover_image_transform_children(entry_name: &str, value: &mut Value) -> bool {
    let Some(position) = value.as_object_mut() else {
        return false;
    };
    let mut repaired = false;

    let invalid_mode = position
        .get("imageMode")
        .is_some_and(|mode| serde_json::from_value::<Option<ImageMode>>(mode.clone()).is_err());
    if invalid_mode {
        log::warn!("[Store] Resetting invalid {entry_name}.imageMode to None during recovery");
        position.remove("imageMode");
        repaired = true;
    }

    for field in ["idleImageTransform", "activeImageTransform"] {
        let invalid_object = position
            .get(field)
            .is_some_and(|transform| !transform.is_null() && !transform.is_object());
        if invalid_object {
            log::warn!("[Store] Resetting invalid {entry_name}.{field} to None during recovery");
            position.remove(field);
            repaired = true;
            continue;
        }
        let Some(transform) = position.get_mut(field).and_then(Value::as_object_mut) else {
            continue;
        };
        for (leaf, fallback, minimum, maximum) in [
            (
                "offsetX",
                0.0,
                IMAGE_TRANSFORM_OFFSET_MIN,
                IMAGE_TRANSFORM_OFFSET_MAX,
            ),
            (
                "offsetY",
                0.0,
                IMAGE_TRANSFORM_OFFSET_MIN,
                IMAGE_TRANSFORM_OFFSET_MAX,
            ),
            (
                "rotation",
                0.0,
                IMAGE_TRANSFORM_ROTATION_MIN,
                IMAGE_TRANSFORM_ROTATION_MAX,
            ),
            (
                "scale",
                1.0,
                IMAGE_TRANSFORM_SCALE_MIN,
                IMAGE_TRANSFORM_SCALE_MAX,
            ),
        ] {
            let invalid = transform
                .get(leaf)
                .and_then(Value::as_f64)
                .is_none_or(|value| !value.is_finite() || !(minimum..=maximum).contains(&value));
            if invalid {
                log::warn!(
                    "[Store] Resetting invalid {entry_name}.{field}.{leaf} to identity during recovery"
                );
                transform.insert(leaf.to_string(), serde_json::json!(fallback));
                repaired = true;
            }
        }
    }
    repaired
}

fn recover_invalid_counter_fill_gradient_children(entry_name: &str, value: &mut Value) -> bool {
    let Some(counter) = value.get_mut("counter").and_then(Value::as_object_mut) else {
        return false;
    };

    let mut changed = false;
    for field in ["fillIdleGradient", "fillActiveGradient"] {
        let invalid = counter.get(field).is_some_and(|gradient| {
            serde_json::from_value::<Option<GradientSpec>>(gradient.clone()).is_err()
        });
        if invalid {
            log::warn!(
                "[Store] Resetting invalid {entry_name}.counter.{field} to None during recovery"
            );
            counter.remove(field);
            changed = true;
        }
    }
    changed
}

fn recover_position_entries<T>(field: &str, value: &Value) -> Option<Value>
where
    T: DeserializeOwned,
{
    let Value::Object(modes) = value else {
        return None;
    };

    let mut recovered_modes = Map::new();
    for (mode, entries) in modes {
        let Value::Array(entries) = entries else {
            log::warn!(
                "[Store] Removing invalid {field} mode '{mode}' during recovery: expected an array"
            );
            continue;
        };

        let mut recovered_entries = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            match serde_json::from_value::<T>(entry.clone()) {
                Ok(_) => recovered_entries.push(entry.clone()),
                Err(err) => {
                    log::warn!(
                        "[Store] Removing invalid {field} entry '{mode}[{index}]' during recovery: {err}"
                    );
                }
            }
        }
        recovered_modes.insert(mode.clone(), Value::Array(recovered_entries));
    }
    Some(Value::Object(recovered_modes))
}

fn recover_font_settings(value: &Value) -> Option<Value> {
    let Value::Object(settings) = value else {
        return None;
    };
    let mut recovered = settings.clone();
    let Some(custom_fonts) = settings.get("customFonts") else {
        return Some(Value::Object(recovered));
    };
    let Value::Array(custom_fonts) = custom_fonts else {
        log::warn!(
            "[Store] Removing invalid fontSettings.customFonts collection during recovery: expected an array"
        );
        recovered.insert("customFonts".to_string(), Value::Array(Vec::new()));
        return Some(Value::Object(recovered));
    };

    let mut recovered_fonts = Vec::with_capacity(custom_fonts.len());
    for (index, font) in custom_fonts.iter().enumerate() {
        let mut candidate = font.clone();
        let invalid_weight_ranges = candidate.get("weightRanges").is_some_and(|ranges| {
            serde_json::from_value::<Vec<FontWeightRange>>(ranges.clone()).is_err()
        });
        if invalid_weight_ranges {
            if let Some(object) = candidate.as_object_mut() {
                object.remove("weightRanges");
            }
            log::warn!(
                "[Store] Resetting invalid fontSettings.customFonts entry '[{index}].weightRanges' during recovery"
            );
        }

        match serde_json::from_value::<CustomFont>(candidate.clone()) {
            Ok(_) => recovered_fonts.push(candidate),
            Err(err) => {
                if let Some(recovered) = recover_local_font_enabled(&candidate) {
                    log::warn!(
                        "[Store] Disabling fontSettings.customFonts entry '[{index}]' with an invalid enabled field during recovery"
                    );
                    recovered_fonts.push(recovered);
                } else {
                    log::warn!(
                        "[Store] Removing invalid fontSettings.customFonts entry '[{index}]' during recovery: {err}"
                    );
                }
            }
        }
    }
    recovered.insert("customFonts".to_string(), Value::Array(recovered_fonts));
    Some(Value::Object(recovered))
}

pub(super) fn recover_local_font_enabled(value: &Value) -> Option<Value> {
    let Value::Object(source) = value else {
        return None;
    };
    if source.get("enabled").is_some_and(Value::is_boolean) {
        return None;
    }
    let id = source.get("id").and_then(Value::as_str)?;
    let name = source.get("name").and_then(Value::as_str)?;
    if id.trim().is_empty() || name.trim().is_empty() {
        return None;
    }
    let font_type = source
        .get("type")
        .and_then(|font_type| serde_json::from_value::<FontType>(font_type.clone()).ok())?;
    if font_type != FontType::Local {
        return None;
    }
    let local_path = source.get("localPath").and_then(Value::as_str)?;
    let trimmed_path = local_path.trim();
    // 외래 기기의 관리 폰트 경로도 유효한 복구 정체성 — 항목 삭제 대신 비활성 복구
    let portable_font_path = matches!(
        parse_portable_asset_reference(trimmed_path),
        Some((AssetCategory::Fonts, _))
    );
    if trimmed_path.is_empty() || (!Path::new(trimmed_path).is_absolute() && !portable_font_path) {
        return None;
    }

    let mut candidate = source.clone();
    candidate.insert("enabled".to_string(), Value::Bool(false));
    serde_json::from_value::<CustomFont>(Value::Object(candidate.clone())).ok()?;
    Some(Value::Object(candidate))
}

fn migrate_legacy_repair_fields(fields: &mut Map<String, Value>) {
    promote_legacy_field(fields, "useCustomCss", "useCustomCSS");
    promote_legacy_field(fields, "customCss", "customCSS");
    promote_legacy_field(fields, "useCustomJs", "useCustomJS");
    promote_legacy_field(fields, "customJs", "customJS");

    let legacy_bounds = fields.remove("overlayWindowBounds");
    let legacy_position = fields.remove("overlayWindowPosition");
    if fields.contains_key("overlayBounds") {
        return;
    }
    if let Some(value) = legacy_bounds {
        if serde_json::from_value::<OverlayBounds>(value.clone()).is_ok() {
            fields.insert("overlayBounds".to_string(), value);
            return;
        }
    }
    if let Some(value) = legacy_position {
        if let Ok(position) = serde_json::from_value::<LegacyOverlayPosition>(value) {
            fields.insert(
                "overlayBounds".to_string(),
                serde_json::json!({
                    "x": position.x,
                    "y": position.y,
                    "width": LEGACY_OVERLAY_WIDTH,
                    "height": LEGACY_OVERLAY_HEIGHT,
                }),
            );
        }
    }
}

fn promote_legacy_field(fields: &mut Map<String, Value>, current: &str, legacy: &str) {
    if fields.contains_key(current) {
        return;
    }
    if let Some(value) = fields.remove(legacy) {
        fields.insert(current.to_string(), value);
    }
}
