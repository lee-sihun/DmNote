use super::*;

pub(super) fn default_store_note_gradient_multipliers(value: &mut Value) -> bool {
    let mut changed = false;
    for collection in POSITION_COLLECTION_FIELDS {
        let Some(modes) = value.get_mut(collection).and_then(Value::as_object_mut) else {
            continue;
        };
        for position in modes.values_mut().filter_map(Value::as_array_mut).flatten() {
            changed |= default_missing_note_gradient_multipliers(position);
        }
    }
    changed
}

pub(super) fn has_explicit_invalid_element_id(value: &Value) -> bool {
    POSITION_COLLECTION_FIELDS
        .into_iter()
        .filter_map(|field| value.get(field).and_then(Value::as_object))
        .flat_map(|modes| modes.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(Value::as_object)
        .filter_map(|element| element.get("id"))
        .any(|id| {
            id.as_str()
                .is_none_or(|id| !super::native_element_id::is_valid_element_id(id))
        })
}

pub(super) fn current_unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

pub(super) fn migrate_sound_library_enabled(value: &mut Value) -> bool {
    let Some(sound_library) = value.get_mut("soundLibrary").and_then(Value::as_object_mut) else {
        return false;
    };

    let mut changed = false;
    for entry in sound_library.values_mut().filter_map(Value::as_object_mut) {
        let Some(enabled) = entry.remove("enabled") else {
            continue;
        };

        changed = true;
        if !entry.contains_key("hidden") {
            if let Some(enabled) = enabled.as_bool() {
                entry.insert("hidden".to_string(), Value::Bool(!enabled));
            }
        }
    }
    changed
}

/// 레거시 노브 민감도 마이그레이션: 도수/카운트(구 기본 1.40625) → 순수 배율(1.0)
/// 배율 의미 전환 이전에 저장된 기본값만 1로 재매핑 (사용자 지정값은 유지)
pub(super) fn migrate_legacy_knob_sensitivity(data: &mut AppStoreData) -> bool {
    const LEGACY_DEFAULT: f64 = 1.40625; // 360 / 256
    let mut changed = false;
    for positions in data.knob_positions.values_mut() {
        for knob in positions.iter_mut() {
            if knob.sensitivity == LEGACY_DEFAULT {
                knob.sensitivity = 1.0;
                changed = true;
            }
        }
    }
    changed
}

/// 타입은 맞지만 실제 식별자로 쓸 수 없는 항목을 로드 경계에서만 정리
pub(super) fn repair_semantic_identities(data: &mut AppStoreData) -> bool {
    let mut changed = false;

    let original_font_len = data.font_settings.custom_fonts.len();
    data.font_settings
        .custom_fonts
        .retain(|font| !font.id.trim().is_empty() && !font.name.trim().is_empty());
    changed |= data.font_settings.custom_fonts.len() != original_font_len;

    for font in data.font_settings.custom_fonts.iter_mut() {
        let original_range_len = font.weight_ranges.len();
        font.weight_ranges.retain(|range| {
            (1..=1000).contains(&range.min)
                && (1..=1000).contains(&range.max)
                && range.min <= range.max
        });
        changed |= font.weight_ranges.len() != original_range_len;

        if font.font_type != FontType::Local {
            continue;
        }

        let invalid_path = font.local_path.as_ref().is_some_and(|path| {
            path.trim().is_empty()
                || (!Path::new(path.trim()).is_absolute()
                    && parse_portable_asset_reference(path).is_none())
        });
        if invalid_path {
            font.local_path = None;
            changed = true;
        }

        let has_embedded_source = font
            .css_content
            .as_deref()
            .is_some_and(|content| !content.trim().is_empty());
        if font.local_path.is_none() && !has_embedded_source && font.enabled {
            font.enabled = false;
            changed = true;
        }
    }

    changed
}
/// `rgba(r, g, b, a)` 문자열을 `#RRGGBB`로 변환. rgba 형식이 아니거나 파싱 실패 시 None
pub(super) fn rgba_to_hex(color: &str) -> Option<String> {
    let inner = color.trim().strip_prefix("rgba(")?.strip_suffix(')')?;
    let mut parts = inner.split(',');
    let r: u8 = parts.next()?.trim().parse().ok()?;
    let g: u8 = parts.next()?.trim().parse().ok()?;
    let b: u8 = parts.next()?.trim().parse().ok()?;
    Some(format!("#{r:02X}{g:02X}{b:02X}"))
}

/// noteBorderColor가 변환 가능한 rgba면 #RRGGBB로 교체 (그 외 입력은 그대로)
fn migrate_note_border_color(color: &mut Option<String>) {
    if let Some(hex) = color.as_deref().and_then(rgba_to_hex) {
        *color = Some(hex);
    }
}

/// store에 #RRGGBB로 변환 가능한 rgba noteBorderColor가 남아 있는지 (디스크 영속 판단용)
pub(super) fn has_convertible_note_border_color(data: &AppStoreData) -> bool {
    let convertible = |color: &Option<String>| color.as_deref().and_then(rgba_to_hex).is_some();
    data.key_positions
        .values()
        .flatten()
        .any(|pos| convertible(&pos.note_border_color))
        || data
            .stat_positions
            .values()
            .flatten()
            .any(|stat| convertible(&stat.position.note_border_color))
        || data
            .graph_positions
            .values()
            .flatten()
            .any(|graph| convertible(&graph.position.note_border_color))
        || data
            .knob_positions
            .values()
            .flatten()
            .any(|knob| convertible(&knob.position.note_border_color))
}

/// store 데이터 정규화 및 레거시 마이그레이션 적용
pub(crate) fn normalize_state(mut data: AppStoreData) -> AppStoreData {
    remove_legacy_panel_detach_setting(&mut data);
    normalize_custom_css_history(&mut data.custom_css_history);
    repair_editor_revision(&mut data);
    normalize_blank_font_colors(&mut data);
    canonicalize_image_modes(&mut data);

    if data.keys.is_empty() {
        data.keys = default_keys().clone();
    } else {
        merge_default_modes(&mut data.keys, default_keys());
    }

    if data.key_positions.is_empty() {
        data.key_positions = default_positions().clone();
    } else {
        merge_default_positions(&mut data.key_positions, default_positions());
    }

    if !has_valid_selected_key_type(&data) {
        data.selected_key_type = "4key".to_string();
    }

    pad_key_position_lengths(&mut data.keys, &mut data.key_positions);

    // 레거시 마이그레이션: 전역 noteSettings.borderRadius → 키별 noteBorderRadius
    if let Some(legacy_border_radius) = data.note_settings.border_radius.take() {
        for positions in data.key_positions.values_mut() {
            for pos in positions.iter_mut() {
                pos.note_border_radius = Some(legacy_border_radius as f64);
            }
        }
    }

    // 마이그레이션: noteBorderColor에 잘못 저장된 rgba(...) → #RRGGBB 복구 (이슈 #73)
    // 배치 편집 경로가 정규화 없이 rgba 문자열을 저장해 오버레이에서 초록색으로 깨짐
    for positions in data.key_positions.values_mut() {
        for pos in positions.iter_mut() {
            migrate_note_border_color(&mut pos.note_border_color);
        }
    }
    for positions in data.stat_positions.values_mut() {
        for stat in positions.iter_mut() {
            migrate_note_border_color(&mut stat.position.note_border_color);
        }
    }
    for positions in data.graph_positions.values_mut() {
        for graph in positions.iter_mut() {
            migrate_note_border_color(&mut graph.position.note_border_color);
        }
    }
    for positions in data.knob_positions.values_mut() {
        for knob in positions.iter_mut() {
            migrate_note_border_color(&mut knob.position.note_border_color);
        }
    }

    // 레거시 마이그레이션: fadePosition enum → 방향별 픽셀 fade 값
    data.note_settings.migrate_fade_position();
    for tab in data.tab_note_overrides.values_mut() {
        tab.migrate_fade_position();
    }

    merge_default_counters(&mut data.key_counters, &data.keys);

    data.counter_animation_presets =
        crate::models::normalize_user_counter_animation_presets(data.counter_animation_presets);

    // 마이그레이션: 기존 기본 카운터 설정의 반전된 active 색상 보정
    // (레거시 패턴에 해당하는 경우만 적용, 사용자 커스텀은 유지)
    for positions in data.key_positions.values_mut() {
        for pos in positions.iter_mut() {
            pos.counter.migrate_legacy_defaults();
        }
    }
    for positions in data.stat_positions.values_mut() {
        for pos in positions.iter_mut() {
            pos.position.counter.migrate_legacy_defaults();
        }
    }
    for positions in data.graph_positions.values_mut() {
        for pos in positions.iter_mut() {
            pos.position.counter.migrate_legacy_defaults();
        }
    }

    migrate_legacy_font_weight_state(&mut data);

    let _ = data.custom_js.normalize();

    data
}

pub(super) fn repair_image_transforms(data: &mut AppStoreData) -> bool {
    fn repair_transform(transform: &mut Option<ImageTransform>) -> bool {
        let Some(transform) = transform else {
            return false;
        };
        let identity = ImageTransform::default();
        let mut repaired = false;
        for (value, fallback, minimum, maximum) in [
            (
                &mut transform.offset_x,
                identity.offset_x,
                IMAGE_TRANSFORM_OFFSET_MIN,
                IMAGE_TRANSFORM_OFFSET_MAX,
            ),
            (
                &mut transform.offset_y,
                identity.offset_y,
                IMAGE_TRANSFORM_OFFSET_MIN,
                IMAGE_TRANSFORM_OFFSET_MAX,
            ),
            (
                &mut transform.rotation,
                identity.rotation,
                IMAGE_TRANSFORM_ROTATION_MIN,
                IMAGE_TRANSFORM_ROTATION_MAX,
            ),
            (
                &mut transform.scale,
                identity.scale,
                IMAGE_TRANSFORM_SCALE_MIN,
                IMAGE_TRANSFORM_SCALE_MAX,
            ),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(value) {
                *value = fallback;
                repaired = true;
            }
        }
        repaired
    }

    fn repair_position(position: &mut KeyPosition) -> bool {
        repair_transform(&mut position.idle_image_transform)
            | repair_transform(&mut position.active_image_transform)
    }

    let mut repaired = false;
    for position in data.key_positions.values_mut().flatten() {
        repaired |= repair_position(position);
    }
    for position in data.stat_positions.values_mut().flatten() {
        repaired |= repair_position(&mut position.position);
    }
    for position in data.graph_positions.values_mut().flatten() {
        repaired |= repair_position(&mut position.position);
    }
    for position in data.knob_positions.values_mut().flatten() {
        repaired |= repair_position(&mut position.position);
    }
    repaired
}

pub(super) fn has_legacy_font_weight_state(data: &AppStoreData) -> bool {
    data.key_positions
        .values()
        .flatten()
        .chain(
            data.stat_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .chain(
            data.graph_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .chain(
            data.knob_positions
                .values()
                .flatten()
                .map(|position| &position.position),
        )
        .any(|position| {
            (position.font_bold.is_none() && position.font_weight == Some(700))
                || (position.counter.font_bold.is_none() && position.counter.font_weight == 700)
        })
}

pub(crate) fn migrate_legacy_font_weight_state(data: &mut AppStoreData) -> bool {
    let mut changed = false;
    for position in data.key_positions.values_mut().flatten() {
        changed |= position.migrate_legacy_font_weight();
    }
    for position in data.stat_positions.values_mut().flatten() {
        changed |= position.position.migrate_legacy_font_weight();
    }
    for position in data.graph_positions.values_mut().flatten() {
        changed |= position.position.migrate_legacy_font_weight();
    }
    for position in data.knob_positions.values_mut().flatten() {
        changed |= position.position.migrate_legacy_font_weight();
    }
    changed
}

pub(super) fn normalize_blank_font_colors(data: &mut AppStoreData) -> bool {
    fn normalize_position(position: &mut KeyPosition) -> bool {
        let mut changed = false;
        for color in [&mut position.font_color, &mut position.active_font_color] {
            if color
                .as_deref()
                .is_some_and(|value| value.trim().is_empty())
            {
                *color = None;
                changed = true;
            }
        }
        changed
    }

    let mut changed = false;
    for position in data.key_positions.values_mut().flatten() {
        changed |= normalize_position(position);
    }
    for stat in data.stat_positions.values_mut().flatten() {
        changed |= normalize_position(&mut stat.position);
    }
    for graph in data.graph_positions.values_mut().flatten() {
        changed |= normalize_position(&mut graph.position);
    }
    for knob in data.knob_positions.values_mut().flatten() {
        changed |= normalize_position(&mut knob.position);
    }
    changed
}

// image_mode replace 표현을 None으로 접는다 (KeyPosition::canonicalize_image_mode 참조)
pub(crate) fn canonicalize_image_modes(data: &mut AppStoreData) -> bool {
    let mut changed = false;
    for position in data.key_positions.values_mut().flatten() {
        changed |= position.canonicalize_image_mode();
    }
    for stat in data.stat_positions.values_mut().flatten() {
        changed |= stat.position.canonicalize_image_mode();
    }
    for graph in data.graph_positions.values_mut().flatten() {
        changed |= graph.position.canonicalize_image_mode();
    }
    for knob in data.knob_positions.values_mut().flatten() {
        changed |= knob.position.canonicalize_image_mode();
    }
    changed
}

pub(super) fn remove_legacy_panel_detach_setting(data: &mut AppStoreData) -> bool {
    data.plugin_data
        .remove(LEGACY_PANEL_DETACH_ENABLED_KEY)
        .is_some()
}

pub(crate) fn canonicalize_gradient_pairs(data: &mut AppStoreData) -> (bool, bool) {
    let mut changed = false;
    let mut pair_repaired = false;

    for position in data.key_positions.values_mut().flatten() {
        let (position_changed, position_pair_repaired) = position.canonicalize_gradient_pairs();
        changed |= position_changed;
        pair_repaired |= position_pair_repaired;
    }
    for stat in data.stat_positions.values_mut().flatten() {
        let (position_changed, position_pair_repaired) =
            stat.position.canonicalize_gradient_pairs();
        changed |= position_changed;
        pair_repaired |= position_pair_repaired;
    }
    for graph in data.graph_positions.values_mut().flatten() {
        let (position_changed, position_pair_repaired) =
            graph.position.canonicalize_gradient_pairs();
        changed |= position_changed;
        pair_repaired |= position_pair_repaired;
    }
    for knob in data.knob_positions.values_mut().flatten() {
        let (position_changed, position_pair_repaired) =
            knob.position.canonicalize_gradient_pairs();
        changed |= position_changed;
        pair_repaired |= position_pair_repaired;
    }

    (changed, pair_repaired)
}

pub(super) fn repair_editor_revision(data: &mut AppStoreData) -> bool {
    if data.editor_revision <= super::editor::MAX_SAFE_WIRE_REVISION {
        return false;
    }

    log::warn!(
        "[Store] Resetting unsafe editorRevision {} to 0 during load recovery",
        data.editor_revision
    );
    data.editor_revision = 0;
    true
}

pub(super) fn has_valid_selected_key_type(data: &AppStoreData) -> bool {
    default_keys().contains_key(&data.selected_key_type)
        || (data.keys.contains_key(&data.selected_key_type)
            && data
                .custom_tabs
                .iter()
                .any(|tab| tab.id == data.selected_key_type))
}

/// 그룹 정의가 사라진 요소의 groupId를 해제 — dangling 참조는 UI에서 해석 불가
/// 정리 발생 여부를 반환 (로드 경로에서 needs_persist 판단에 사용)
///
/// 파일 로드·프리셋 임포트처럼 정의와 참조가 함께 확정되는 경계에서만 호출할 것.
/// 프론트는 positions(groupId 포함)를 먼저 저장하고 layerGroups를 나중에 저장하므로,
/// normalize_state 같은 부분 저장 경로에서 돌리면 새 그룹 생성이 파괴된다.
pub(crate) fn clear_dangling_group_ids(data: &mut AppStoreData) -> bool {
    clear_dangling_group_ids_in(
        &mut data.key_positions,
        &mut data.stat_positions,
        &mut data.graph_positions,
        &mut data.knob_positions,
        &data.layer_groups,
    )
}

pub(crate) fn clear_dangling_group_ids_in(
    key_positions: &mut KeyPositions,
    stat_positions: &mut StatPositions,
    graph_positions: &mut GraphPositions,
    knob_positions: &mut KnobPositions,
    layer_groups: &LayerGroups,
) -> bool {
    let valid_ids: HashMap<&str, HashSet<&str>> = layer_groups
        .iter()
        .map(|(tab, groups)| {
            (
                tab.as_str(),
                groups.iter().map(|group| group.id.as_str()).collect(),
            )
        })
        .collect();

    let is_dangling = |tab: &str, group_id: &Option<String>| {
        group_id.as_ref().is_some_and(|id| {
            !valid_ids
                .get(tab)
                .is_some_and(|ids| ids.contains(id.as_str()))
        })
    };

    let mut changed = false;
    for (tab, positions) in key_positions.iter_mut() {
        for position in positions.iter_mut() {
            if is_dangling(tab, &position.group_id) {
                position.group_id = None;
                changed = true;
            }
        }
    }
    for (tab, positions) in stat_positions.iter_mut() {
        for stat in positions.iter_mut() {
            if is_dangling(tab, &stat.position.group_id) {
                stat.position.group_id = None;
                changed = true;
            }
        }
    }
    for (tab, positions) in graph_positions.iter_mut() {
        for graph in positions.iter_mut() {
            if is_dangling(tab, &graph.position.group_id) {
                graph.position.group_id = None;
                changed = true;
            }
        }
    }
    for (tab, positions) in knob_positions.iter_mut() {
        for knob in positions.iter_mut() {
            if is_dangling(tab, &knob.position.group_id) {
                knob.position.group_id = None;
                changed = true;
            }
        }
    }
    changed
}

/// 누락된 모드만 기본값으로 채움
fn merge_default_modes(target: &mut KeyMappings, defaults: &KeyMappings) {
    for (mode, value) in defaults.iter() {
        target.entry(mode.clone()).or_insert_with(|| value.clone());
    }
}

/// 누락된 모드만 기본값으로 채움
fn merge_default_positions(target: &mut KeyPositions, defaults: &KeyPositions) {
    for (mode, positions) in defaults.iter() {
        target
            .entry(mode.clone())
            .or_insert_with(|| positions.clone());
    }
}

/// 인덱스 결합 배열의 길이 보정
pub(crate) fn pad_key_position_lengths(
    keys: &mut KeyMappings,
    positions: &mut KeyPositions,
) -> bool {
    let modes = keys
        .keys()
        .chain(positions.keys())
        .cloned()
        .collect::<HashSet<_>>();
    let mut changed = false;

    for mode in modes {
        let key_count = keys.get(&mode).map_or(0, Vec::len);
        let position_count = positions.get(&mode).map_or(0, Vec::len);
        if key_count > position_count {
            log::warn!(
                "[Store] Padding keyPositions mode '{mode}' from {position_count} to {key_count} entries"
            );
            positions
                .entry(mode)
                .or_default()
                .resize(key_count, KeyPosition::default());
            changed = true;
        } else if position_count > key_count {
            log::warn!(
                "[Store] Padding keys mode '{mode}' from {key_count} to {position_count} entries"
            );
            keys.entry(mode)
                .or_default()
                .resize(position_count, KeySlot::default());
            changed = true;
        }
    }

    changed
}

pub(super) fn key_position_lengths_mismatch(keys: &KeyMappings, positions: &KeyPositions) -> bool {
    keys.keys()
        .chain(positions.keys())
        .any(|mode| keys.get(mode).map_or(0, Vec::len) != positions.get(mode).map_or(0, Vec::len))
}

/// 키 카운터 기본값 병합
fn merge_default_counters(target: &mut KeyCounters, keys: &KeyMappings) {
    for (mode, key_list) in keys.iter() {
        let entry = target.entry(mode.clone()).or_default();
        let canonical_keys = key_list
            .iter()
            .map(KeySlot::canonical)
            .collect::<HashSet<_>>();
        entry.retain(|key, _| canonical_keys.contains(key));
        for key in canonical_keys {
            entry.entry(key).or_insert(0);
        }
    }

    let available_modes: std::collections::HashSet<_> = keys.keys().cloned().collect();
    target.retain(|mode, _| available_modes.contains(mode));
}
