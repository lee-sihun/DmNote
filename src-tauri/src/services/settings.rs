use std::sync::Arc;

use anyhow::{Context, Result};

use crate::models::{
    AppStoreData, CustomCss, CustomCssPatch, CustomJs, CustomJsPatch, FontType, NoteSettings,
    NoteSettingsPatch, SettingsDiff, SettingsPatch, SettingsPatchInput, SettingsState,
    ShortcutsState,
};
use crate::state::AppStore;

#[derive(Clone)]
pub struct SettingsService {
    store: Arc<AppStore>,
}

impl SettingsService {
    pub fn new(store: Arc<AppStore>) -> Self {
        Self { store }
    }

    pub fn snapshot(&self) -> SettingsState {
        self.store.settings_snapshot()
    }

    pub fn apply_patch(&self, patch: SettingsPatchInput) -> Result<SettingsDiff> {
        let mut diff = None;
        self.store.update(|state| {
            diff = Some(apply_patch_to_store(state, &patch));
        })?;
        diff.context("settings patch did not produce a diff")
    }
}

pub(crate) fn settings_from_store(store: &AppStoreData) -> SettingsState {
    store.settings_state()
}

pub(crate) fn apply_patch_to_store(
    store: &mut AppStoreData,
    patch: &SettingsPatchInput,
) -> SettingsDiff {
    let current = settings_from_store(store);
    let normalized = normalize_patch(patch, &current);
    let next = apply_changes(current, &normalized);

    store.hardware_acceleration = next.hardware_acceleration;
    store.always_on_top = next.always_on_top;
    store.overlay_locked = next.overlay_locked;
    store.note_effect = next.note_effect;
    store.note_settings = next.note_settings.clone();
    store.angle_mode = next.angle_mode.clone();
    store.language = next.language.clone();
    store.laboratory_enabled = next.laboratory_enabled;
    store.developer_mode_enabled = next.developer_mode_enabled;
    store.tray_enabled = next.tray_enabled;
    store.auto_update_enabled = next.auto_update_enabled;
    store.background_color = next.background_color.clone();
    store.use_custom_css = next.use_custom_css;
    store.custom_css = next.custom_css.clone();
    store.font_settings = next.font_settings.clone();
    store.use_custom_js = next.use_custom_js;
    store.custom_js = next.custom_js.clone();
    store.overlay_resize_anchor = next.overlay_resize_anchor.clone();
    store.key_counter_enabled = next.key_counter_enabled;
    store.grid_settings = next.grid_settings.clone();
    store.shortcuts = next.shortcuts.clone();
    store.obs_mode_enabled = next.obs_mode_enabled;

    SettingsDiff {
        changed: normalized,
        full: Some(next),
    }
}

fn normalize_patch(patch: &SettingsPatchInput, current: &SettingsState) -> SettingsPatch {
    let mut normalized = SettingsPatch::default();
    if let Some(value) = patch.hardware_acceleration {
        normalized.hardware_acceleration = Some(value);
    }
    if let Some(value) = patch.always_on_top {
        normalized.always_on_top = Some(value);
    }
    if let Some(value) = patch.overlay_locked {
        normalized.overlay_locked = Some(value);
    }
    if let Some(value) = patch.note_effect {
        normalized.note_effect = Some(value);
    }
    if let Some(value) = patch.note_settings.as_ref() {
        normalized.note_settings = Some(apply_note_patch(current.note_settings.clone(), value));
    }
    if let Some(value) = patch.angle_mode.as_ref() {
        #[cfg(target_os = "macos")]
        {
            let _ = value;
            normalized.angle_mode = Some("metal".to_string());
        }
        #[cfg(not(target_os = "macos"))]
        {
            normalized.angle_mode = Some(value.clone());
        }
    }
    if let Some(value) = patch.language.as_ref() {
        normalized.language = Some(value.clone());
    }
    if let Some(value) = patch.laboratory_enabled {
        normalized.laboratory_enabled = Some(value);
    }
    if let Some(value) = patch.developer_mode_enabled {
        normalized.developer_mode_enabled = Some(value);
    }
    if let Some(value) = patch.tray_enabled {
        normalized.tray_enabled = Some(value);
    }
    if let Some(value) = patch.auto_update_enabled {
        normalized.auto_update_enabled = Some(value);
    }
    if let Some(value) = patch.background_color.as_ref() {
        normalized.background_color = Some(value.clone());
    }
    if let Some(value) = patch.use_custom_css {
        normalized.use_custom_css = Some(value);
    }
    if let Some(value) = patch.custom_css.as_ref() {
        normalized.custom_css = Some(apply_css_patch(current.custom_css.clone(), value));
    }
    if let Some(value) = patch.font_settings.as_ref() {
        let mut next = value.clone();
        // 로컬 폰트의 base64(data URI) cssContent는 저장하지 않음;
        // 경로만 유지하고 @font-face는 renderer에서 생성
        for font in next.custom_fonts.iter_mut() {
            if font.font_type == FontType::Local {
                font.css_content = None;
            }
        }
        normalized.font_settings = Some(next);
    }
    if let Some(value) = patch.use_custom_js {
        normalized.use_custom_js = Some(value);
    }
    if let Some(value) = patch.custom_js.as_ref() {
        normalized.custom_js = Some(apply_js_patch(current.custom_js.clone(), value));
    }
    if let Some(value) = patch.overlay_resize_anchor.as_ref() {
        normalized.overlay_resize_anchor = Some(value.clone());
    }
    if let Some(value) = patch.key_counter_enabled {
        normalized.key_counter_enabled = Some(value);
    }
    if let Some(value) = patch.grid_settings.as_ref() {
        normalized.grid_settings = Some(value.clone());
    }
    if let Some(value) = patch.shortcuts.as_ref() {
        let normalize_binding = |binding: &crate::models::ShortcutBinding| {
            if binding.key.trim().is_empty() {
                crate::models::ShortcutBinding {
                    key: String::new(),
                    ctrl: false,
                    shift: false,
                    alt: false,
                    meta: false,
                }
            } else {
                binding.clone()
            }
        };
        let mut merged: ShortcutsState = current.shortcuts.clone();
        if let Some(binding) = value.toggle_overlay.as_ref() {
            merged.toggle_overlay = normalize_binding(binding);
        }
        if let Some(binding) = value.toggle_overlay_lock.as_ref() {
            merged.toggle_overlay_lock = normalize_binding(binding);
        }
        if let Some(binding) = value.toggle_always_on_top.as_ref() {
            merged.toggle_always_on_top = normalize_binding(binding);
        }
        if let Some(binding) = value.switch_key_mode.as_ref() {
            merged.switch_key_mode = normalize_binding(binding);
        }
        if let Some(binding) = value.toggle_settings_panel.as_ref() {
            merged.toggle_settings_panel = normalize_binding(binding);
        }
        if let Some(binding) = value.zoom_in.as_ref() {
            merged.zoom_in = normalize_binding(binding);
        }
        if let Some(binding) = value.zoom_out.as_ref() {
            merged.zoom_out = normalize_binding(binding);
        }
        if let Some(binding) = value.reset_zoom.as_ref() {
            merged.reset_zoom = normalize_binding(binding);
        }
        normalized.shortcuts = Some(merged);
    }
    if let Some(value) = patch.obs_mode_enabled {
        normalized.obs_mode_enabled = Some(value);
    }
    normalized
}

fn apply_changes(mut current: SettingsState, patch: &SettingsPatch) -> SettingsState {
    if let Some(value) = patch.hardware_acceleration {
        current.hardware_acceleration = value;
    }
    if let Some(value) = patch.always_on_top {
        current.always_on_top = value;
    }
    if let Some(value) = patch.overlay_locked {
        current.overlay_locked = value;
    }
    if let Some(value) = patch.note_effect {
        current.note_effect = value;
    }
    if let Some(value) = patch.note_settings.as_ref() {
        current.note_settings = value.clone();
    }
    if let Some(value) = patch.angle_mode.as_ref() {
        current.angle_mode = value.clone();
    }
    if let Some(value) = patch.language.as_ref() {
        current.language = value.clone();
    }
    if let Some(value) = patch.laboratory_enabled {
        current.laboratory_enabled = value;
    }
    if let Some(value) = patch.developer_mode_enabled {
        current.developer_mode_enabled = value;
    }
    if let Some(value) = patch.tray_enabled {
        current.tray_enabled = value;
    }
    if let Some(value) = patch.auto_update_enabled {
        current.auto_update_enabled = value;
    }
    if let Some(value) = patch.background_color.as_ref() {
        current.background_color = value.clone();
    }
    if let Some(value) = patch.use_custom_css {
        current.use_custom_css = value;
    }
    if let Some(value) = patch.custom_css.as_ref() {
        current.custom_css = value.clone();
    }
    if let Some(value) = patch.font_settings.as_ref() {
        current.font_settings = value.clone();
    }
    if let Some(value) = patch.use_custom_js {
        current.use_custom_js = value;
    }
    if let Some(value) = patch.custom_js.as_ref() {
        current.custom_js = value.clone();
    }
    if let Some(value) = patch.overlay_resize_anchor.as_ref() {
        current.overlay_resize_anchor = value.clone();
    }
    if let Some(value) = patch.key_counter_enabled {
        current.key_counter_enabled = value;
    }
    if let Some(value) = patch.grid_settings.as_ref() {
        current.grid_settings = value.clone();
    }
    if let Some(value) = patch.shortcuts.as_ref() {
        current.shortcuts = value.clone();
    }
    if let Some(value) = patch.obs_mode_enabled {
        current.obs_mode_enabled = value;
    }
    current
}

fn apply_note_patch(mut settings: NoteSettings, patch: &NoteSettingsPatch) -> NoteSettings {
    if let Some(value) = patch.frame_limit {
        settings.frame_limit = value;
    }
    if let Some(value) = patch.speed {
        settings.speed = value;
    }
    if let Some(value) = patch.track_height {
        settings.track_height = value;
    }
    if let Some(value) = patch.reverse {
        settings.reverse = value;
    }
    if let Some(value) = patch.fade_position.as_ref() {
        settings.fade_position = value.clone();
    }
    if let Some(value) = patch.fade_top_px {
        settings.fade_top_px = value;
    }
    if let Some(value) = patch.fade_bottom_px {
        settings.fade_bottom_px = value;
    }
    if let Some(value) = patch.reverse_fade_top_px {
        settings.reverse_fade_top_px = value;
    }
    if let Some(value) = patch.reverse_fade_bottom_px {
        settings.reverse_fade_bottom_px = value;
    }
    if let Some(value) = patch.delayed_note_enabled {
        settings.delayed_note_enabled = value;
    }
    if let Some(value) = patch.short_note_threshold_ms {
        settings.short_note_threshold_ms = value;
    }
    if let Some(value) = patch.short_note_min_length_px {
        settings.short_note_min_length_px = value;
    }
    if let Some(value) = patch.key_display_delay_ms {
        settings.key_display_delay_ms = value;
    }
    settings
}

fn apply_css_patch(mut css: CustomCss, patch: &CustomCssPatch) -> CustomCss {
    if let Some(path) = patch.path.as_ref() {
        css.path = path.clone();
    }
    if let Some(content) = patch.content.as_ref() {
        css.content = content.clone();
    }
    css
}

fn apply_js_patch(mut script: CustomJs, patch: &CustomJsPatch) -> CustomJs {
    if let Some(path) = patch.path.as_ref() {
        script.path = path.clone();
    }
    if let Some(content) = patch.content.as_ref() {
        script.content = content.clone();
    }
    if let Some(plugins) = patch.plugins.as_ref() {
        script.plugins = plugins.clone();
    }
    let _ = script.normalize();
    script
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        CustomFont, FadePosition, FontSettings, GridSettings, JsPlugin, OverlayResizeAnchor,
        ShortcutBinding, ShortcutsPatchInput,
    };

    // 기본값 절대값 고정 스냅샷, 변경은 의도된 커밋에서만 허용
    #[test]
    fn default_settings_pinned_values() {
        let d = SettingsState::default();

        assert!(d.hardware_acceleration);
        assert!(d.always_on_top);
        assert!(!d.overlay_locked);
        assert!(!d.note_effect);
        if cfg!(target_os = "macos") {
            assert_eq!(d.angle_mode, "metal");
        } else {
            assert_eq!(d.angle_mode, "d3d11");
        }
        assert_eq!(d.language, "ko");
        assert!(!d.laboratory_enabled);
        assert!(!d.developer_mode_enabled);
        assert!(!d.tray_enabled);
        assert!(d.auto_update_enabled);
        assert_eq!(d.background_color, "transparent");
        assert!(!d.use_custom_css);
        assert_eq!(d.custom_css.path, None);
        assert_eq!(d.custom_css.content, "");
        assert!(d.font_settings.custom_fonts.is_empty());
        assert!(!d.use_custom_js);
        assert_eq!(d.custom_js.path, None);
        assert_eq!(d.custom_js.content, "");
        assert!(d.custom_js.plugins.is_empty());
        assert_eq!(d.overlay_resize_anchor, OverlayResizeAnchor::TopLeft);
        assert!(!d.key_counter_enabled);
        assert!(!d.obs_mode_enabled);

        let n = &d.note_settings;
        assert_eq!(n.border_radius, None);
        assert_eq!(n.frame_limit, 0);
        assert_eq!(n.speed, 400);
        assert_eq!(n.track_height, 300);
        assert!(!n.reverse);
        assert_eq!(n.fade_position, FadePosition::Auto);
        assert_eq!(n.fade_top_px, 50);
        assert_eq!(n.fade_bottom_px, 0);
        assert_eq!(n.reverse_fade_top_px, 0);
        assert_eq!(n.reverse_fade_bottom_px, 50);
        assert!(!n.delayed_note_enabled);
        assert_eq!(n.short_note_threshold_ms, 50);
        assert_eq!(n.short_note_min_length_px, 30);
        assert_eq!(n.key_display_delay_ms, 0);

        let g = &d.grid_settings;
        assert!(g.alignment_guides);
        assert!(g.spacing_guides);
        assert!(g.size_match_guides);
        assert!(g.minimap_enabled);
        assert_eq!(g.grid_snap_size, 5);
        assert_eq!(g.overlay_padding, 30);

        // 주 수정키 규칙 고정, macOS는 meta 그 외는 ctrl
        let mac = cfg!(target_os = "macos");
        let s = &d.shortcuts;
        assert_eq!(s.toggle_overlay.key, "KeyO");
        assert_eq!(s.toggle_overlay.ctrl, !mac);
        assert_eq!(s.toggle_overlay.meta, mac);
        assert!(s.toggle_overlay.shift);
        assert!(!s.toggle_overlay.alt);
        assert_eq!(s.toggle_overlay_lock.key, "");
        assert_eq!(s.toggle_always_on_top.key, "");
        assert_eq!(s.switch_key_mode.key, "Tab");
        assert!(!s.switch_key_mode.ctrl);
        assert!(!s.switch_key_mode.meta);
        assert_eq!(s.toggle_settings_panel.key, "KeyB");
        assert_eq!(s.toggle_settings_panel.ctrl, !mac);
        assert_eq!(s.toggle_settings_panel.meta, mac);
        assert!(!s.toggle_settings_panel.shift);
        assert_eq!(s.zoom_in.key, "Equal");
        assert_eq!(s.zoom_in.ctrl, !mac);
        assert_eq!(s.zoom_in.meta, mac);
        assert_eq!(s.zoom_out.key, "Minus");
        assert_eq!(s.zoom_out.ctrl, !mac);
        assert_eq!(s.zoom_out.meta, mac);
        assert_eq!(s.reset_zoom.key, "Digit0");
        assert_eq!(s.reset_zoom.ctrl, !mac);
        assert_eq!(s.reset_zoom.meta, mac);
    }

    // 전 필드 비기본값 왕복, 쓰기백 누락과 사영 교차 매핑 검출
    // 1단계는 모든 필드를 기본값과 다르게, 2단계는 bool 쌍이 서로 반대가 되도록 재패치
    #[test]
    fn full_patch_round_trip_with_distinct_values() {
        let binding = |key: &str, ctrl: bool, shift: bool, alt: bool, meta: bool| ShortcutBinding {
            key: key.to_string(),
            ctrl,
            shift,
            alt,
            meta,
        };
        let toggle_overlay_b = binding("KeyP", false, false, true, false);
        let zoom_in_b = binding("KeyU", true, true, false, false);

        // macOS는 angle_mode가 metal로 강제되는 불변식이라 기대값 분기
        let expected_angle = if cfg!(target_os = "macos") {
            "metal".to_string()
        } else {
            "gl".to_string()
        };

        let expected_note = NoteSettings {
            border_radius: None,
            frame_limit: 60,
            speed: 777,
            track_height: 555,
            reverse: true,
            fade_position: FadePosition::Both,
            fade_top_px: 11,
            fade_bottom_px: 22,
            reverse_fade_top_px: 33,
            reverse_fade_bottom_px: 44,
            delayed_note_enabled: true,
            short_note_threshold_ms: 66,
            short_note_min_length_px: 77,
            key_display_delay_ms: 88,
        };
        let expected_font = FontSettings {
            custom_fonts: vec![CustomFont {
                id: "font-1".to_string(),
                font_type: FontType::Web,
                name: "Fira".to_string(),
                display_name: "Fira Sans".to_string(),
                enabled: true,
                local_path: None,
                css_content: Some("@font-face{}".to_string()),
                weight_ranges: Vec::new(),
            }],
        };
        let expected_js = CustomJs {
            path: Some("/tmp/a.js".to_string()),
            content: "let x=1".to_string(),
            plugins: vec![JsPlugin {
                id: "p1".to_string(),
                name: "plugin-one".to_string(),
                path: None,
                content: "console.log(1)".to_string(),
                enabled: true,
            }],
        };
        let expected_grid = GridSettings {
            alignment_guides: false,
            spacing_guides: false,
            size_match_guides: false,
            minimap_enabled: false,
            grid_snap_size: 7,
            overlay_padding: 13,
        };

        let expected_a = SettingsState {
            hardware_acceleration: false,
            always_on_top: false,
            overlay_locked: true,
            note_effect: true,
            note_settings: expected_note.clone(),
            angle_mode: expected_angle,
            language: "en".to_string(),
            laboratory_enabled: true,
            developer_mode_enabled: true,
            tray_enabled: true,
            auto_update_enabled: false,
            background_color: "#123456".to_string(),
            use_custom_css: true,
            custom_css: CustomCss {
                path: Some("/tmp/preset-a.css".to_string()),
                content: "body{color:red}".to_string(),
            },
            font_settings: expected_font.clone(),
            use_custom_js: true,
            custom_js: expected_js.clone(),
            overlay_resize_anchor: OverlayResizeAnchor::Center,
            key_counter_enabled: true,
            grid_settings: expected_grid.clone(),
            shortcuts: ShortcutsState {
                toggle_overlay: toggle_overlay_b.clone(),
                zoom_in: zoom_in_b.clone(),
                ..ShortcutsState::default()
            },
            obs_mode_enabled: true,
        };

        let patch_a = SettingsPatchInput {
            hardware_acceleration: Some(false),
            always_on_top: Some(false),
            overlay_locked: Some(true),
            note_effect: Some(true),
            note_settings: Some(NoteSettingsPatch {
                frame_limit: Some(60),
                speed: Some(777),
                track_height: Some(555),
                reverse: Some(true),
                fade_position: Some(FadePosition::Both),
                fade_top_px: Some(11),
                fade_bottom_px: Some(22),
                reverse_fade_top_px: Some(33),
                reverse_fade_bottom_px: Some(44),
                delayed_note_enabled: Some(true),
                short_note_threshold_ms: Some(66),
                short_note_min_length_px: Some(77),
                key_display_delay_ms: Some(88),
            }),
            angle_mode: Some("gl".to_string()),
            language: Some("en".to_string()),
            laboratory_enabled: Some(true),
            developer_mode_enabled: Some(true),
            tray_enabled: Some(true),
            auto_update_enabled: Some(false),
            background_color: Some("#123456".to_string()),
            use_custom_css: Some(true),
            custom_css: Some(CustomCssPatch {
                path: Some(Some("/tmp/preset-a.css".to_string())),
                content: Some("body{color:red}".to_string()),
            }),
            font_settings: Some(expected_font.clone()),
            use_custom_js: Some(true),
            custom_js: Some(CustomJsPatch {
                path: Some(Some("/tmp/a.js".to_string())),
                content: Some("let x=1".to_string()),
                plugins: Some(expected_js.plugins.clone()),
            }),
            overlay_resize_anchor: Some(OverlayResizeAnchor::Center),
            key_counter_enabled: Some(true),
            grid_settings: Some(expected_grid.clone()),
            shortcuts: Some(ShortcutsPatchInput {
                toggle_overlay: Some(toggle_overlay_b.clone()),
                zoom_in: Some(zoom_in_b.clone()),
                ..ShortcutsPatchInput::default()
            }),
            obs_mode_enabled: Some(true),
        };

        let mut store = AppStoreData::default();
        let diff_a = apply_patch_to_store(&mut store, &patch_a);
        assert_eq!(diff_a.full.expect("full snapshot 반환"), expected_a);
        assert_eq!(settings_from_store(&store), expected_a);

        // 같은 기본값을 공유하는 bool 쌍이 서로 반대가 되도록 절반만 반전
        let patch_b = SettingsPatchInput {
            always_on_top: Some(true),
            note_effect: Some(false),
            developer_mode_enabled: Some(false),
            auto_update_enabled: Some(true),
            use_custom_js: Some(false),
            obs_mode_enabled: Some(false),
            ..SettingsPatchInput::default()
        };
        let expected_b = SettingsState {
            always_on_top: true,
            note_effect: false,
            developer_mode_enabled: false,
            auto_update_enabled: true,
            use_custom_js: false,
            obs_mode_enabled: false,
            ..expected_a
        };

        let diff_b = apply_patch_to_store(&mut store, &patch_b);
        assert_eq!(diff_b.changed_count(), 6);
        assert_eq!(diff_b.full.expect("full snapshot 반환"), expected_b);
        assert_eq!(settings_from_store(&store), expected_b);
        // 교차 매핑 검출 핵심 쌍, use_custom_css와 use_custom_js가 서로 반대
        assert!(expected_b.use_custom_css);
        assert!(!expected_b.use_custom_js);
    }

    // 기본값 3자 일치, Default와 빈 store 사영과 빈 patch 적용 결과
    #[test]
    fn default_settings_three_way_agreement() {
        let from_default = SettingsState::default();
        let from_empty_store = settings_from_store(&AppStoreData::default());

        let mut store = AppStoreData::default();
        let diff = apply_patch_to_store(&mut store, &SettingsPatchInput::default());
        assert_eq!(diff.changed_count(), 0);
        let from_empty_patch = diff.full.expect("빈 patch도 full snapshot 반환");

        assert_eq!(from_default, from_empty_store);
        assert_eq!(from_default, from_empty_patch);
        // 빈 patch가 store 기본값을 변경하지 않음
        assert_eq!(settings_from_store(&store), from_default);
    }
}
