use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    pub key: String,
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub meta: bool,
}

fn default_toggle_overlay_shortcut() -> ShortcutBinding {
    // 기본 단축키 — Windows/Linux: Ctrl+Shift+O, macOS: Cmd+Shift+O
    if cfg!(target_os = "macos") {
        ShortcutBinding {
            key: "KeyO".to_string(),
            ctrl: false,
            shift: true,
            alt: false,
            meta: true,
        }
    } else {
        ShortcutBinding {
            key: "KeyO".to_string(),
            ctrl: true,
            shift: true,
            alt: false,
            meta: false,
        }
    }
}

fn default_switch_key_mode_shortcut() -> ShortcutBinding {
    ShortcutBinding {
        key: "Tab".to_string(),
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
    }
}

fn default_unbound_shortcut() -> ShortcutBinding {
    ShortcutBinding {
        key: "".to_string(),
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
    }
}

fn default_toggle_settings_panel_shortcut() -> ShortcutBinding {
    if cfg!(target_os = "macos") {
        ShortcutBinding {
            key: "KeyB".to_string(),
            ctrl: false,
            shift: false,
            alt: false,
            meta: true,
        }
    } else {
        ShortcutBinding {
            key: "KeyB".to_string(),
            ctrl: true,
            shift: false,
            alt: false,
            meta: false,
        }
    }
}

fn default_zoom_in_shortcut() -> ShortcutBinding {
    if cfg!(target_os = "macos") {
        ShortcutBinding {
            key: "Equal".to_string(),
            ctrl: false,
            shift: false,
            alt: false,
            meta: true,
        }
    } else {
        ShortcutBinding {
            key: "Equal".to_string(),
            ctrl: true,
            shift: false,
            alt: false,
            meta: false,
        }
    }
}

fn default_zoom_out_shortcut() -> ShortcutBinding {
    if cfg!(target_os = "macos") {
        ShortcutBinding {
            key: "Minus".to_string(),
            ctrl: false,
            shift: false,
            alt: false,
            meta: true,
        }
    } else {
        ShortcutBinding {
            key: "Minus".to_string(),
            ctrl: true,
            shift: false,
            alt: false,
            meta: false,
        }
    }
}

fn default_zoom_reset_shortcut() -> ShortcutBinding {
    if cfg!(target_os = "macos") {
        ShortcutBinding {
            key: "Digit0".to_string(),
            ctrl: false,
            shift: false,
            alt: false,
            meta: true,
        }
    } else {
        ShortcutBinding {
            key: "Digit0".to_string(),
            ctrl: true,
            shift: false,
            alt: false,
            meta: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsState {
    #[serde(default = "default_toggle_overlay_shortcut")]
    pub toggle_overlay: ShortcutBinding,
    #[serde(default = "default_unbound_shortcut")]
    pub toggle_overlay_lock: ShortcutBinding,
    #[serde(default = "default_unbound_shortcut")]
    pub toggle_always_on_top: ShortcutBinding,
    #[serde(default = "default_switch_key_mode_shortcut")]
    pub switch_key_mode: ShortcutBinding,
    #[serde(default = "default_toggle_settings_panel_shortcut")]
    pub toggle_settings_panel: ShortcutBinding,
    #[serde(default = "default_zoom_in_shortcut")]
    pub zoom_in: ShortcutBinding,
    #[serde(default = "default_zoom_out_shortcut")]
    pub zoom_out: ShortcutBinding,
    #[serde(default = "default_zoom_reset_shortcut")]
    pub reset_zoom: ShortcutBinding,
}

impl Default for ShortcutsState {
    fn default() -> Self {
        Self {
            toggle_overlay: default_toggle_overlay_shortcut(),
            toggle_overlay_lock: default_unbound_shortcut(),
            toggle_always_on_top: default_unbound_shortcut(),
            switch_key_mode: default_switch_key_mode_shortcut(),
            toggle_settings_panel: default_toggle_settings_panel_shortcut(),
            zoom_in: default_zoom_in_shortcut(),
            zoom_out: default_zoom_out_shortcut(),
            reset_zoom: default_zoom_reset_shortcut(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsPatchInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toggle_overlay: Option<ShortcutBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toggle_overlay_lock: Option<ShortcutBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toggle_always_on_top: Option<ShortcutBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub switch_key_mode: Option<ShortcutBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toggle_settings_panel: Option<ShortcutBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_in: Option<ShortcutBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_out: Option<ShortcutBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_zoom: Option<ShortcutBinding>,
}
