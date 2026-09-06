use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::NoteColor;

pub(super) fn default_note_effect_enabled() -> bool {
    true
}
pub(super) fn default_key_height() -> f64 {
    60.0
}
pub(super) fn default_element_rotation() -> f64 {
    0.0
}
pub(super) fn default_key_note_color() -> NoteColor {
    NoteColor::Solid("#FFFFFF".to_string())
}
pub(super) fn default_key_note_opacity() -> u32 {
    90
}
pub(super) fn default_note_glow_enabled() -> bool {
    false
}
pub(super) fn default_note_glow_size() -> f64 {
    10.0
}

pub(super) fn default_note_border_opacity() -> u32 {
    100
}
pub(super) fn default_note_glow_opacity() -> u32 {
    70
}
pub(super) fn default_note_auto_y_correction() -> bool {
    true
}
fn default_note_frame_limit() -> u32 {
    0
}

fn default_fade_top_px() -> u32 {
    50
}

fn default_reverse_fade_bottom_px() -> u32 {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteSettings {
    // Legacy: 전역 노트 라운딩 (개별 키 noteBorderRadius로 마이그레이션됨)
    #[serde(default, skip_serializing)]
    pub border_radius: Option<u32>,
    #[serde(default = "default_note_frame_limit")]
    pub frame_limit: u32,
    pub speed: u32,
    pub track_height: u32,
    pub reverse: bool,
    pub fade_position: FadePosition,
    #[serde(default = "default_fade_top_px")]
    pub fade_top_px: u32,
    #[serde(default)]
    pub fade_bottom_px: u32,
    #[serde(default)]
    pub reverse_fade_top_px: u32,
    #[serde(default = "default_reverse_fade_bottom_px")]
    pub reverse_fade_bottom_px: u32,
    pub delayed_note_enabled: bool,
    pub short_note_threshold_ms: u32,
    pub short_note_min_length_px: u32,
    #[serde(default)]
    pub key_display_delay_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum FadePosition {
    Auto,
    Top,
    Bottom,
    None,
    Both,
}

/// 이미지 맞춤 설정 (CSS object-fit과 동일)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum ImageFit {
    #[default]
    Cover,
    Contain,
    Fill,
    None,
}

impl Default for NoteSettings {
    fn default() -> Self {
        Self {
            border_radius: None,
            frame_limit: default_note_frame_limit(),
            speed: 400,
            track_height: 300,
            reverse: false,
            fade_position: FadePosition::Auto,
            fade_top_px: 50,
            fade_bottom_px: 0,
            reverse_fade_top_px: 0,
            reverse_fade_bottom_px: 50,
            delayed_note_enabled: false,
            short_note_threshold_ms: 50,
            short_note_min_length_px: 30,
            key_display_delay_ms: 0,
        }
    }
}

impl NoteSettings {
    /// Legacy migration: fadePosition enum → pixel-based fade values
    /// serde defaults로 채워진 새 필드가 auto 기본값과 동일하고
    /// fadePosition이 non-auto면 레거시 store로 판단하여 변환
    pub fn migrate_fade_position(&mut self) {
        let d = Self::default();
        let at_auto_defaults = self.fade_top_px == d.fade_top_px
            && self.fade_bottom_px == d.fade_bottom_px
            && self.reverse_fade_top_px == d.reverse_fade_top_px
            && self.reverse_fade_bottom_px == d.reverse_fade_bottom_px;

        if !at_auto_defaults {
            return;
        }

        match self.fade_position {
            FadePosition::Auto => {}
            FadePosition::Top => {
                // 항상 상단 페이드
                self.reverse_fade_top_px = d.fade_top_px;
                self.reverse_fade_bottom_px = 0;
            }
            FadePosition::Bottom => {
                // 항상 하단 페이드
                self.fade_top_px = 0;
                self.fade_bottom_px = d.reverse_fade_bottom_px;
            }
            FadePosition::None => {
                // 페이드 없음
                self.fade_top_px = 0;
                self.reverse_fade_bottom_px = 0;
            }
            FadePosition::Both => {
                // 양방향 페이드
                self.fade_bottom_px = d.fade_top_px;
                self.reverse_fade_top_px = d.reverse_fade_bottom_px;
            }
        }
        self.fade_position = FadePosition::Auto;
    }
}

impl TabNoteSettings {
    /// Legacy migration: 탭 오버라이드의 fadePosition → pixel-based fade values
    /// Option<u32> 기반이라 None = 필드 부재 확실 (heuristic 불필요)
    pub fn migrate_fade_position(&mut self) {
        let fp = match self.fade_position.take() {
            Some(fp) => fp,
            None => return,
        };

        let has_new_fields = self.fade_top_px.is_some()
            || self.fade_bottom_px.is_some()
            || self.reverse_fade_top_px.is_some()
            || self.reverse_fade_bottom_px.is_some();

        if has_new_fields {
            return; // 이미 새 필드가 설정됨
        }

        let d = NoteSettings::default();
        match fp {
            FadePosition::Auto => {
                // 명시적 auto 오버라이드 → 전역과 무관하게 auto 동작 보장
                self.fade_top_px = Some(d.fade_top_px);
                self.fade_bottom_px = Some(d.fade_bottom_px);
                self.reverse_fade_top_px = Some(d.reverse_fade_top_px);
                self.reverse_fade_bottom_px = Some(d.reverse_fade_bottom_px);
            }
            FadePosition::Top => {
                self.fade_top_px = Some(d.fade_top_px);
                self.fade_bottom_px = Some(0);
                self.reverse_fade_top_px = Some(d.fade_top_px);
                self.reverse_fade_bottom_px = Some(0);
            }
            FadePosition::Bottom => {
                self.fade_top_px = Some(0);
                self.fade_bottom_px = Some(d.reverse_fade_bottom_px);
                self.reverse_fade_top_px = Some(0);
                self.reverse_fade_bottom_px = Some(d.reverse_fade_bottom_px);
            }
            FadePosition::None => {
                self.fade_top_px = Some(0);
                self.fade_bottom_px = Some(0);
                self.reverse_fade_top_px = Some(0);
                self.reverse_fade_bottom_px = Some(0);
            }
            FadePosition::Both => {
                self.fade_top_px = Some(d.fade_top_px);
                self.fade_bottom_px = Some(d.fade_top_px);
                self.reverse_fade_top_px = Some(d.reverse_fade_bottom_px);
                self.reverse_fade_bottom_px = Some(d.reverse_fade_bottom_px);
            }
        }
    }
}

/// 탭별 노트 트랙 설정 (전역 NoteSettings를 탭별로 오버라이드)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct TabNoteSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_position: Option<FadePosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_top_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fade_bottom_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse_fade_top_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse_fade_bottom_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delayed_note_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_note_threshold_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_note_min_length_px: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_display_delay_ms: Option<u32>,
}

/// 탭별 노트 트랙 설정 오버라이드 맵 (키: 탭 ID, 값: TabNoteSettings)
pub type TabNoteOverrides = HashMap<String, TabNoteSettings>;
