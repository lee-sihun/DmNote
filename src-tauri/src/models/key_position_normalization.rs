use super::*;

impl KeyCounterSettings {
    pub(crate) fn migrate_legacy_font_weight(&mut self) -> bool {
        if self.font_bold.is_some() || self.font_weight != 700 {
            return false;
        }

        self.font_weight = 400;
        self.font_bold = Some(true);
        true
    }

    pub fn normalize(&mut self) {
        self.animation.normalize();
    }

    /// Migrate legacy defaults that were previously serialized into store.json.
    /// This keeps existing user customizations intact, while fixing old defaults
    /// that diverged from the renderer.
    // 당시 직렬화되던 스냅샷 값 고정
    fn matches_legacy_default_snapshot(&self) -> bool {
        self.fill.idle == "#FFFFFF"
            && self.fill.active == "#000000"
            && matches!(self.placement, KeyCounterPlacement::Inside)
            && matches!(self.align, KeyCounterAlign::Top)
            && matches!(self.align_mode, KeyCounterAlignMode::Center)
            && self.gap == 6
            && self.font_size == 16
            && self.font_weight == 400
            && self.font_bold.is_none()
            && self.font_family.is_none()
            && !self.font_italic
            && !self.font_underline
            && !self.font_strikethrough
    }

    // 직전 기본값 스냅샷(회색 카운터·16px·700·상단 배치) 전 필드 일치 검사
    fn matches_previous_default_snapshot(&self) -> bool {
        self.fill.idle == "rgba(121, 121, 121, 0.9)"
            && self.fill.active == "#FFFFFF"
            && matches!(self.placement, KeyCounterPlacement::Inside)
            && matches!(self.align, KeyCounterAlign::Top)
            && matches!(self.align_mode, KeyCounterAlignMode::Center)
            && self.gap == 6
            && self.font_size == 16
            && self.font_weight == 700
            && self.font_bold.is_none()
            && self.font_family.is_none()
            && !self.font_italic
            && !self.font_underline
            && !self.font_strikethrough
    }

    pub fn migrate_legacy_defaults(&mut self) -> bool {
        if self.fill_idle_gradient.is_some() || self.fill_active_gradient.is_some() {
            self.normalize();
            return false;
        }

        if self.matches_legacy_default_snapshot() {
            self.fill = KeyCounterColor::default();
            self.align = KeyCounterAlign::Bottom;
            self.gap = default_gap();
            self.font_size = default_counter_font_size();
            self.font_weight = default_counter_font_weight();
            self.font_bold = Some(false);
            self.animation = KeyCounterAnimationSettings::default();
            self.normalize();
            return true;
        }

        if self.matches_previous_default_snapshot() {
            self.fill = KeyCounterColor::default();
            self.align = KeyCounterAlign::Bottom;
            self.gap = default_gap();
            self.font_size = default_counter_font_size();
            self.font_weight = default_counter_font_weight();
            self.font_bold = Some(false);
            self.normalize();
            return true;
        }

        self.normalize();
        false
    }

    pub(crate) fn canonicalize_gradient_pairs(&mut self) -> (bool, bool) {
        let mut changed = false;
        let mut pair_repaired = false;

        let (idle_changed, idle_pair_repaired) =
            canonicalize_counter_gradient_pair(&mut self.fill.idle, &mut self.fill_idle_gradient);
        changed |= idle_changed;
        pair_repaired |= idle_pair_repaired;

        let (active_changed, active_pair_repaired) = canonicalize_counter_gradient_pair(
            &mut self.fill.active,
            &mut self.fill_active_gradient,
        );
        changed |= active_changed;
        pair_repaired |= active_pair_repaired;

        (changed, pair_repaired)
    }
}

fn removed_counter_stroke_matches(
    stroke: Option<&serde_json::Value>,
    expected_idle: &str,
    expected_active: &str,
) -> bool {
    let Some(stroke) = stroke else {
        return expected_idle == "transparent" && expected_active == "transparent";
    };
    let Some(stroke) = stroke.as_object() else {
        return false;
    };
    stroke.get("idle").and_then(serde_json::Value::as_str) == Some(expected_idle)
        && stroke.get("active").and_then(serde_json::Value::as_str) == Some(expected_active)
}

fn escape_removed_counter_stroke_collision(
    counter: &mut serde_json::Map<String, serde_json::Value>,
    removed_stroke: Option<&serde_json::Value>,
    had_removed_gradient: bool,
) -> bool {
    let Ok(parsed) =
        serde_json::from_value::<KeyCounterSettings>(serde_json::Value::Object(counter.clone()))
    else {
        return false;
    };
    let legacy_collision = parsed.matches_legacy_default_snapshot();
    let previous_collision = parsed.matches_previous_default_snapshot();
    let custom_stroke = (legacy_collision
        && !removed_counter_stroke_matches(removed_stroke, "#000000", "#FFFFFF"))
        || (previous_collision
            && !removed_counter_stroke_matches(removed_stroke, "transparent", "transparent"));
    if !(had_removed_gradient || custom_stroke) || !(legacy_collision || previous_collision) {
        return false;
    }
    let Some(fill) = counter
        .get_mut("fill")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return false;
    };
    let mut changed = false;
    for state in ["idle", "active"] {
        let Some(color) = fill.get(state).and_then(serde_json::Value::as_str) else {
            continue;
        };
        let escaped = serde_json::Value::String(compact_canonical_rgba(color));
        if fill.get(state) != Some(&escaped) {
            fill.insert(state.to_string(), escaped);
            changed = true;
        }
    }
    changed
}

fn scrub_removed_text_outline_from_position(position: &mut serde_json::Value) -> bool {
    let Some(position) = position.as_object_mut() else {
        return false;
    };
    let mut changed = position.remove("fontStrokeColor").is_some();
    changed |= position.remove("activeFontStrokeColor").is_some();

    let Some(counter) = position
        .get_mut("counter")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return changed;
    };
    let removed_stroke = counter.remove("stroke");
    let had_removed_gradient = counter.remove("strokeIdleGradient").is_some()
        | counter.remove("strokeActiveGradient").is_some();
    changed |= removed_stroke.is_some() || had_removed_gradient;
    changed |= escape_removed_counter_stroke_collision(
        counter,
        removed_stroke.as_ref(),
        had_removed_gradient,
    );
    changed
}

// 제거된 텍스트 외곽선 필드 정리
pub(crate) fn scrub_removed_text_outline_fields(value: &mut serde_json::Value) -> bool {
    let mut changed = false;
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
            changed |= scrub_removed_text_outline_from_position(position);
        }
    }
    changed
}

impl KeyPosition {
    pub(crate) fn migrate_legacy_font_weight(&mut self) -> bool {
        let mut changed = false;
        if self.font_bold.is_none() && self.font_weight == Some(700) {
            self.font_weight = Some(400);
            self.font_bold = Some(true);
            changed = true;
        }

        changed | self.counter.migrate_legacy_font_weight()
    }

    /// 본체 페인트를 글로우로 복사. 바뀐 게 있으면 true
    pub(crate) fn mirror_note_body_to_glow(&mut self) -> bool {
        let changed = self.note_glow_gradient != self.note_gradient
            || self.note_glow_opacity != self.note_opacity
            || self.note_glow_color.as_ref() != Some(&self.note_color)
            || self.note_glow_opacity_top != self.note_opacity_top
            || self.note_glow_opacity_bottom != self.note_opacity_bottom;
        if changed {
            self.note_glow_gradient = self.note_gradient.clone();
            self.note_glow_opacity = self.note_opacity;
            self.note_glow_color = Some(self.note_color.clone());
            self.note_glow_opacity_top = self.note_opacity_top;
            self.note_glow_opacity_bottom = self.note_opacity_bottom;
        }
        changed
    }

    // replace는 sparse 저장(None)이 정본 - 프리셋·플러그인·frozen insert로 들어온
    // Some(Replace)를 접어 이후 ImageMode(Replace) 패치가 빈 undo 항목을 만들지 않게
    pub(crate) fn canonicalize_image_mode(&mut self) -> bool {
        if self.image_mode == Some(ImageMode::Replace) {
            self.image_mode = None;
            true
        } else {
            false
        }
    }

    pub(crate) fn canonicalize_gradient_pairs(&mut self) -> (bool, bool) {
        let mut changed = false;
        let mut pair_repaired = false;

        let (note_changed, note_pair_repaired) =
            canonicalize_note_gradient(&mut self.note_gradient, self.note_opacity, |shadow| {
                let shadow_changed = self.note_color != shadow.color
                    || self.note_opacity_top != Some(shadow.opacity_top)
                    || self.note_opacity_bottom != Some(shadow.opacity_bottom);
                self.note_color = shadow.color;
                self.note_opacity_top = Some(shadow.opacity_top);
                self.note_opacity_bottom = Some(shadow.opacity_bottom);
                shadow_changed
            });
        changed |= note_changed;
        pair_repaired |= note_pair_repaired;

        if self.note_glow_sync_paint {
            changed |= self.mirror_note_body_to_glow();
        }

        let (glow_changed, glow_pair_repaired) = canonicalize_note_gradient(
            &mut self.note_glow_gradient,
            self.note_glow_opacity,
            |shadow| {
                let shadow_changed = self.note_glow_color.as_ref() != Some(&shadow.color)
                    || self.note_glow_opacity_top != Some(shadow.opacity_top)
                    || self.note_glow_opacity_bottom != Some(shadow.opacity_bottom);
                self.note_glow_color = Some(shadow.color);
                self.note_glow_opacity_top = Some(shadow.opacity_top);
                self.note_glow_opacity_bottom = Some(shadow.opacity_bottom);
                shadow_changed
            },
        );
        changed |= glow_changed;
        pair_repaired |= glow_pair_repaired;

        let (note_border_changed, note_border_pair_repaired) =
            canonicalize_note_border_gradient_pair(
                &mut self.note_border_color,
                &mut self.note_border_gradient,
            );
        changed |= note_border_changed;
        pair_repaired |= note_border_pair_repaired;

        for (base, gradient) in [
            (&mut self.background_color, &mut self.background_gradient),
            (
                &mut self.active_background_color,
                &mut self.active_background_gradient,
            ),
            (&mut self.border_color, &mut self.border_gradient),
            (
                &mut self.active_border_color,
                &mut self.active_border_gradient,
            ),
            (&mut self.font_color, &mut self.font_gradient),
            (&mut self.active_font_color, &mut self.active_font_gradient),
        ] {
            let (pair_changed, base_repaired) = canonicalize_optional_gradient_pair(base, gradient);
            changed |= pair_changed;
            pair_repaired |= base_repaired;
        }

        let (counter_changed, counter_pair_repaired) = self.counter.canonicalize_gradient_pairs();
        changed |= counter_changed;
        pair_repaired |= counter_pair_repaired;

        (changed, pair_repaired)
    }
}

fn canonicalize_optional_gradient_pair(
    base: &mut Option<String>,
    gradient: &mut Option<GradientSpec>,
) -> (bool, bool) {
    let Some(current) = gradient.as_mut() else {
        return (false, false);
    };

    // 공백 stop 색은 대표색 동기와 공백 색 정규화가 서로 되돌려 로드 복구가
    // 수렴하지 않으므로 그라데이션 자체를 내린다 (note 계열의 invalid stop 처리와 동일)
    if current
        .stops
        .iter()
        .any(|stop| stop.color.trim().is_empty())
    {
        *gradient = None;
        return (true, true);
    }

    let gradient = current;
    let mut changed = gradient.canonicalize();
    let representative = gradient
        .stops
        .first()
        .expect("a deserialized gradient always has at least two stops")
        .color
        .clone();
    let pair_repaired = base.as_deref() != Some(representative.as_str());
    if pair_repaired {
        *base = Some(representative);
        changed = true;
    }
    (changed, pair_repaired)
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NoteGradientShadow {
    pub(crate) color: NoteColor,
    pub(crate) opacity_top: u32,
    pub(crate) opacity_bottom: u32,
}

pub(crate) fn note_gradient_shadow(
    gradient: &GradientSpec,
    opacity: u32,
) -> Option<NoteGradientShadow> {
    if gradient.note_border_invalid_stop_index().is_some() {
        return None;
    }
    let first = gradient.stops.first()?;
    let last = gradient.stops.last()?;
    let (top, top_alpha) = note_gradient_stop_color(&first.color)?;
    let (bottom, bottom_alpha) = note_gradient_stop_color(&last.color)?;
    Some(NoteGradientShadow {
        color: NoteColor::Gradient { top, bottom },
        // 배율이 검증 범위를 벗어난 저장값이어도 shadow는 0~100 계약 유지 (TS clamp 미러)
        opacity_top: ((top_alpha * f64::from(opacity)).round() as u32).min(100),
        opacity_bottom: ((bottom_alpha * f64::from(opacity)).round() as u32).min(100),
    })
}

// 유효한 sibling만 배율 부재를 100으로 실체화 - 손상 sibling은 이후 canonicalize가
// drop하므로 구형 폴백 의미(부재 = 80/70)를 변조하지 않는다 (TS 미러와 동일 순서)
fn is_materializable_note_gradient(value: &serde_json::Value) -> bool {
    if value.is_null() {
        return false;
    }
    serde_json::from_value::<GradientSpec>(value.clone())
        .is_ok_and(|gradient| gradient.note_border_invalid_stop_index().is_none())
}

pub(crate) fn default_missing_note_gradient_multipliers(position: &mut serde_json::Value) -> bool {
    let Some(position) = position.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    if position
        .get("noteGradient")
        .is_some_and(is_materializable_note_gradient)
        && !position.contains_key("noteOpacity")
    {
        position.insert("noteOpacity".to_string(), serde_json::Value::from(100));
        changed = true;
    }
    if position
        .get("noteGlowGradient")
        .is_some_and(is_materializable_note_gradient)
        && !position.contains_key("noteGlowOpacity")
    {
        position.insert("noteGlowOpacity".to_string(), serde_json::Value::from(100));
        changed = true;
    }
    changed
}

fn canonicalize_note_gradient(
    gradient: &mut Option<GradientSpec>,
    opacity: u32,
    apply_shadow: impl FnOnce(NoteGradientShadow) -> bool,
) -> (bool, bool) {
    let Some(current) = gradient.as_mut() else {
        return (false, false);
    };

    let mut changed = current.canonicalize();
    let Some(shadow) = note_gradient_shadow(current, opacity) else {
        *gradient = None;
        return (true, true);
    };
    let pair_repaired = apply_shadow(shadow);
    changed |= pair_repaired;
    (changed, pair_repaired)
}

fn canonicalize_counter_gradient_pair(
    base: &mut String,
    gradient: &mut Option<GradientSpec>,
) -> (bool, bool) {
    let Some(gradient) = gradient else {
        return (false, false);
    };

    let mut changed = gradient.canonicalize();
    let representative = compact_canonical_rgba(
        &gradient
            .stops
            .first()
            .expect("a deserialized gradient always has at least two stops")
            .color,
    );
    let pair_repaired = *base != representative;
    if pair_repaired {
        *base = representative;
        changed = true;
    }
    (changed, pair_repaired)
}

fn canonicalize_note_border_gradient_pair(
    base: &mut Option<String>,
    gradient: &mut Option<GradientSpec>,
) -> (bool, bool) {
    let Some(current) = gradient.as_mut() else {
        return (false, false);
    };

    let mut changed = current.canonicalize();
    if current.note_border_invalid_stop_index().is_some() {
        *gradient = None;
        return (true, true);
    }

    let representative = note_border_representative_hex(
        &current
            .stops
            .first()
            .expect("a deserialized gradient always has at least two stops")
            .color,
    )
    .expect("all note border stop colors were validated");
    let pair_repaired = base.as_deref() != Some(representative.as_str());
    if pair_repaired {
        *base = Some(representative);
        changed = true;
    }
    (changed, pair_repaired)
}

pub(crate) fn note_border_representative_hex(color: &str) -> Option<String> {
    note_gradient_stop_color(color).map(|(hex, _)| hex)
}

fn note_gradient_stop_color(color: &str) -> Option<(String, f64)> {
    let trimmed = color.trim();
    if let Some(hex) = trimmed.strip_prefix('#') {
        if matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            let channels = if matches!(hex.len(), 3 | 4) {
                hex.chars()
                    .take(3)
                    .flat_map(|character| [character, character])
                    .collect::<String>()
            } else {
                hex[..6].to_string()
            };
            let alpha = match hex.len() {
                4 => {
                    let digit = &hex[3..4];
                    u8::from_str_radix(&format!("{digit}{digit}"), 16).ok()? as f64 / 255.0
                }
                8 => u8::from_str_radix(&hex[6..8], 16).ok()? as f64 / 255.0,
                _ => 1.0,
            };
            return Some((format!("#{}", channels.to_ascii_uppercase()), alpha));
        }
        return None;
    }

    let open = trimmed.find('(')?;
    if !trimmed.ends_with(')') {
        return None;
    }
    let name = &trimmed[..open];
    let channels = trimmed[open + 1..trimmed.len() - 1]
        .split(',')
        .map(str::trim)
        .collect::<Vec<_>>();
    let expected_channels = if name.eq_ignore_ascii_case("rgb") {
        3
    } else if name.eq_ignore_ascii_case("rgba") {
        4
    } else {
        return None;
    };
    if channels.len() != expected_channels {
        return None;
    }

    let rgb = channels[..3]
        .iter()
        .map(|channel| {
            if !(1..=3).contains(&channel.len())
                || !channel.bytes().all(|byte| byte.is_ascii_digit())
            {
                return None;
            }
            channel.parse::<u16>().ok().filter(|value| *value <= 255)
        })
        .collect::<Option<Vec<_>>>()?;

    let alpha = if expected_channels == 4 {
        let alpha = channels[3];
        let mut parts = alpha.split('.');
        let whole = parts.next().unwrap_or_default();
        let fractional = parts.next();
        let decimal_syntax = parts.next().is_none()
            && whole.bytes().all(|byte| byte.is_ascii_digit())
            && fractional.is_none_or(|digits| {
                !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
            })
            && (!whole.is_empty() || fractional.is_some());
        if !decimal_syntax {
            return None;
        }
        let alpha = alpha.parse::<f64>().ok()?;
        if !alpha.is_finite() || !(0.0..=1.0).contains(&alpha) {
            return None;
        }
        alpha
    } else {
        1.0
    };

    Some((
        format!("#{:02X}{:02X}{:02X}", rgb[0], rgb[1], rgb[2]),
        alpha,
    ))
}

pub(crate) fn compact_canonical_rgba(color: &str) -> String {
    let trimmed = color.trim();
    if let Some(hex) = trimmed.strip_prefix('#') {
        if matches!(hex.len(), 3 | 6 | 8) && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            let expanded;
            let hex = if hex.len() == 3 {
                expanded = hex
                    .chars()
                    .flat_map(|character| [character, character])
                    .collect::<String>();
                expanded.as_str()
            } else {
                hex
            };
            let red = u8::from_str_radix(&hex[0..2], 16).expect("validated hex channel");
            let green = u8::from_str_radix(&hex[2..4], 16).expect("validated hex channel");
            let blue = u8::from_str_radix(&hex[4..6], 16).expect("validated hex channel");
            let alpha = if hex.len() == 8 {
                f64::from(u8::from_str_radix(&hex[6..8], 16).expect("validated alpha channel"))
                    / 255.0
            } else {
                1.0
            };
            return format!("rgba({red},{green},{blue},{})", format_compact_alpha(alpha));
        }
    }

    let functional = trimmed
        .strip_prefix("rgba(")
        .or_else(|| trimmed.strip_prefix("rgb("));
    if let Some(body) = functional {
        if let Some(body) = body.strip_suffix(')') {
            let channels = body.split(',').map(str::trim).collect::<Vec<_>>();
            if matches!(channels.len(), 3 | 4)
                && channels.iter().all(|channel| {
                    !channel.is_empty()
                        && channel
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || byte == b'.')
                })
            {
                let parsed = channels
                    .iter()
                    .map(|channel| channel.parse::<f64>())
                    .collect::<Result<Vec<_>, _>>();
                if let Ok(parsed) = parsed {
                    let alpha = parsed.get(3).copied().unwrap_or(1.0);
                    return format!(
                        "rgba({},{},{},{})",
                        parsed[0].round() as i64,
                        parsed[1].round() as i64,
                        parsed[2].round() as i64,
                        format_compact_alpha(alpha)
                    );
                }
            }
        }
    }

    trimmed.to_string()
}

fn format_compact_alpha(alpha: f64) -> String {
    let rounded = (alpha.clamp(0.0, 1.0) * 10_000.0).round() / 10_000.0;
    let formatted = format!("{rounded:.4}");
    let compact = formatted.trim_end_matches('0').trim_end_matches('.');
    if compact.is_empty() {
        "0".to_string()
    } else {
        compact.to_string()
    }
}
