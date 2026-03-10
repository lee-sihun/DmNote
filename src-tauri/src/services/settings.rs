use std::sync::Arc;

use anyhow::Result;

use crate::models::{
    CustomCss, CustomCssPatch, CustomJs, CustomJsPatch, FontType, NoteSettings, NoteSettingsPatch,
    SettingsDiff, SettingsPatch, SettingsPatchInput, SettingsState, ShortcutsState,
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
        let current = self.snapshot();
        let normalized = normalize_patch(&patch, &current);
        let next = apply_changes(current.clone(), &normalized);

        self.store.update(|state| {
            state.hardware_acceleration = next.hardware_acceleration;
            state.always_on_top = next.always_on_top;
            state.overlay_locked = next.overlay_locked;
            state.note_effect = next.note_effect;
            state.note_settings = next.note_settings.clone();
            state.angle_mode = next.angle_mode.clone();
            state.language = next.language.clone();
            state.laboratory_enabled = next.laboratory_enabled;
            state.developer_mode_enabled = next.developer_mode_enabled;
            state.tray_enabled = next.tray_enabled;
            state.auto_update_enabled = next.auto_update_enabled;
            state.background_color = next.background_color.clone();
            state.use_custom_css = next.use_custom_css;
            state.custom_css = next.custom_css.clone();
            state.font_settings = next.font_settings.clone();
            state.use_custom_js = next.use_custom_js;
            state.custom_js = next.custom_js.clone();
            state.overlay_resize_anchor = next.overlay_resize_anchor.clone();
            state.key_counter_enabled = next.key_counter_enabled;
            state.grid_settings = next.grid_settings.clone();
            state.shortcuts = next.shortcuts.clone();
            state.obs_mode_enabled = next.obs_mode_enabled;
        })?;

        Ok(SettingsDiff {
            changed: normalized,
            full: Some(next),
        })
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
