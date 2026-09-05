pub mod editor;
pub mod gesture;
pub mod obs;
pub mod plugin;

mod bootstrap;
mod counter;
mod element_positions;
mod key_position_normalization;
mod key_slot;
mod note_settings;
mod settings;
mod shortcuts;

pub use bootstrap::*;
pub use counter::{
    default_counter_animation_builtin_presets, default_counter_animation_preset_id,
    find_builtin_counter_animation_preset_by_id, infer_builtin_counter_animation_preset_id,
    normalize_user_counter_animation_presets, CounterAnimationPreset, CounterAnimationSource,
    KeyCounterAlign, KeyCounterAlignMode, KeyCounterAnimationSettings, KeyCounterColor,
    KeyCounterPlacement, KeyCounterSettings,
};
use counter::{default_counter_font_size, default_counter_font_weight, default_gap};
pub use editor::*;
use element_positions::default_true;
pub(crate) use element_positions::{
    default_sprite_press_duration_ms, default_sprite_transition_ms, is_renderable_image_ref,
    rewrite_coupled_sprite_image_reference,
};
// 테스트 기대값 조립에서만 참조
#[cfg(test)]
pub(crate) use element_positions::default_sprite_transition_easing;
pub use element_positions::{
    ElementShadowSpec, GraphPosition, GraphPositions, GraphStatType, GraphType, ImageMode,
    ImageTransform, KeyPosition, KeyPositions, KnobPosition, KnobPositions, NoteAlignment,
    ReactiveSpritePosition, SpriteActivation, SpriteAnchor, SpriteImageMetrics, SpritePose,
    SpritePositions, SpriteReferenceNaturalSize, SpriteTransform, StatPosition, StatPositions,
    StatType, IMAGE_TRANSFORM_OFFSET_MAX, IMAGE_TRANSFORM_OFFSET_MIN, IMAGE_TRANSFORM_ROTATION_MAX,
    IMAGE_TRANSFORM_ROTATION_MIN, IMAGE_TRANSFORM_SCALE_MAX, IMAGE_TRANSFORM_SCALE_MIN,
    MAX_SPRITE_POSES, MAX_SPRITE_POSE_TRIGGERS, POSITION_COLLECTION_FIELDS, SHADOW_BLUR_MAX,
    SHADOW_BLUR_MIN, SHADOW_OFFSET_MAX, SHADOW_OFFSET_MIN, SPRITE_IMAGE_DIMENSION_MAX,
    SPRITE_IMAGE_DIMENSION_MIN, SPRITE_PRESS_DURATION_MS_MAX, SPRITE_PRESS_DURATION_MS_MIN,
    SPRITE_TRANSFORM_OFFSET_MAX, SPRITE_TRANSFORM_OFFSET_MIN, SPRITE_TRANSFORM_ROTATION_MAX,
    SPRITE_TRANSFORM_ROTATION_MIN, SPRITE_TRANSFORM_SCALE_MAX, SPRITE_TRANSFORM_SCALE_MIN,
    SPRITE_TRANSITION_MS_MAX,
};
pub use gesture::*;
pub use key_slot::{
    key_mappings_contain_multi, normalize_key_mappings, normalize_key_slot, KeyMappings, KeySlot,
    SlotMatch, MAX_SLOT_KEYS,
};
use note_settings::{
    default_key_height, default_key_note_color, default_key_note_opacity,
    default_note_auto_y_correction, default_note_border_opacity, default_note_effect_enabled,
    default_note_glow_enabled, default_note_glow_opacity, default_note_glow_size,
};
pub use note_settings::{FadePosition, ImageFit, NoteSettings, TabNoteOverrides, TabNoteSettings};
pub use plugin::*;
pub use settings::*;
pub use shortcuts::*;

pub(crate) use key_position_normalization::{
    compact_canonical_rgba, default_missing_note_gradient_multipliers,
    note_border_representative_hex, note_gradient_shadow, scrub_removed_text_outline_fields,
    NoteGradientShadow,
};

use serde::de::Error as DeError;
use serde::ser::{Error as SerError, SerializeMap};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

pub type KeyCounters = HashMap<String, HashMap<String, u32>>;

const DEFAULT_GRADIENT_ANGLE: f64 = 90.0;
const MAX_GRADIENT_STOPS: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    pub color: String,
    pub pos: f64,
}

#[derive(Debug, Clone)]
pub struct GradientSpec {
    pub angle: f64,
    pub stops: Vec<GradientStop>,
    normalized_on_read: bool,
    note_border_invalid_stop_index_on_read: Option<usize>,
}

impl PartialEq for GradientSpec {
    fn eq(&self, other: &Self) -> bool {
        self.angle == other.angle && self.stops == other.stops
    }
}

impl GradientSpec {
    pub(crate) fn from_canonical_parts(angle: f64, stops: Vec<GradientStop>) -> Self {
        let note_border_invalid_stop_index_on_read = stops
            .iter()
            .position(|stop| note_border_representative_hex(&stop.color).is_none());
        Self {
            angle,
            stops,
            normalized_on_read: false,
            note_border_invalid_stop_index_on_read,
        }
    }

    pub(crate) fn note_border_invalid_stop_index(&self) -> Option<usize> {
        self.note_border_invalid_stop_index_on_read.or_else(|| {
            self.stops
                .iter()
                .position(|stop| note_border_representative_hex(&stop.color).is_none())
        })
    }

    fn normalize(&mut self) -> bool {
        let previous_angle = self.angle;
        let previous_stops = self.stops.clone();

        self.angle = self.angle.rem_euclid(360.0);
        if self.angle == 0.0 {
            self.angle = 0.0;
        }
        for stop in &mut self.stops {
            stop.pos = stop.pos.clamp(0.0, 1.0);
            if stop.pos == 0.0 {
                stop.pos = 0.0;
            }
        }
        self.stops
            .sort_by(|left, right| left.pos.total_cmp(&right.pos));
        self.stops.truncate(MAX_GRADIENT_STOPS);

        self.angle != previous_angle || self.stops != previous_stops
    }

    fn canonicalize(&mut self) -> bool {
        let normalized_on_read = std::mem::take(&mut self.normalized_on_read);
        self.normalize() | normalized_on_read
    }
}

impl Serialize for GradientSpec {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.stops.len() < 2 {
            return Err(S::Error::custom("gradient must contain at least two stops"));
        }
        if !self.angle.is_finite() || self.stops.iter().any(|stop| !stop.pos.is_finite()) {
            return Err(S::Error::custom("gradient values must be finite"));
        }

        let mut canonical = self.clone();
        canonical.normalize();
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("angle", &canonical.angle)?;
        map.serialize_entry("stops", &canonical.stops)?;
        map.end()
    }
}

impl<'de> Deserialize<'de> for GradientSpec {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let serde_json::Value::Object(mut input) = value else {
            return Err(D::Error::custom("gradient must be an object"));
        };
        let angle_value = input.remove("angle");
        let angle = match angle_value.as_ref() {
            Some(value) => serde_json::from_value::<f64>(value.clone())
                .map_err(|error| D::Error::custom(format!("invalid gradient angle: {error}")))?,
            None => DEFAULT_GRADIENT_ANGLE,
        };
        let stops = input
            .remove("stops")
            .ok_or_else(|| D::Error::custom("gradient stops are required"))
            .and_then(|value| {
                serde_json::from_value::<Vec<GradientStop>>(value)
                    .map_err(|error| D::Error::custom(format!("invalid gradient stops: {error}")))
            })?;
        if stops.len() < 2 {
            return Err(D::Error::custom("gradient must contain at least two stops"));
        }
        if !angle.is_finite() || stops.iter().any(|stop| !stop.pos.is_finite()) {
            return Err(D::Error::custom("gradient values must be finite"));
        }

        let note_border_invalid_stop_index_on_read = stops
            .iter()
            .position(|stop| note_border_representative_hex(&stop.color).is_none());
        let mut gradient = Self {
            angle,
            stops,
            normalized_on_read: angle_value.is_none() || !input.is_empty(),
            note_border_invalid_stop_index_on_read,
        };
        gradient.normalized_on_read |= gradient.normalize();
        Ok(gradient)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum NoteColor {
    Solid(String),
    Gradient { top: String, bottom: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FontType {
    Builtin,
    Local,
    Web,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontWeightRange {
    pub min: u16,
    pub max: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomFont {
    pub id: String,
    #[serde(rename = "type")]
    pub font_type: FontType,
    pub name: String,
    pub display_name: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css_content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weight_ranges: Vec<FontWeightRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct FontSettings {
    #[serde(default)]
    pub custom_fonts: Vec<CustomFont>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SoundSource {
    Builtin,
    Local,
}

fn default_sound_source() -> SoundSource {
    SoundSource::Local
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SoundLibraryEntry {
    #[serde(default)]
    pub hidden: bool,
    #[serde(default = "default_sound_source")]
    pub source: SoundSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trim_start_ratio: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trim_end_ratio: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

impl Default for SoundLibraryEntry {
    fn default() -> Self {
        Self {
            hidden: false,
            source: SoundSource::Local,
            original_path: None,
            trim_start_ratio: None,
            trim_end_ratio: None,
            display_name: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingProcessedWavReplacement {
    pub sound_path: String,
    pub had_original: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum KeySoundOutputBackendPersist {
    DefaultDevice,
    Device {
        id: String,
        name: String,
    },
    Asio {
        driver_name: String,
        /// ASIO 버퍼 크기(프레임). None이면 엔진 기본값 사용
        #[serde(default, skip_serializing_if = "Option::is_none")]
        buffer_size: Option<u32>,
    },
}

// 직렬화 형식:
// - Solid: JSON 문자열 (예: "#FF00FF")
// - Gradient: 명시적 type 필드를 포함한 객체 { type: "gradient", top, bottom }
impl Serialize for NoteColor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            NoteColor::Solid(s) => serializer.serialize_str(s),
            NoteColor::Gradient { top, bottom } => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("type", "gradient")?;
                map.serialize_entry("top", top)?;
                map.serialize_entry("bottom", bottom)?;
                map.end()
            }
        }
    }
}

// 역직렬화 허용 형식:
// - 문자열 => Solid
// - { type: "gradient", top, bottom } 객체 => Gradient
// - { top, bottom } (type 없음) => Gradient (하위 호환)
impl<'de> Deserialize<'de> for NoteColor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        use serde_json::Value;
        let value = Value::deserialize(deserializer)?;
        match value {
            Value::String(s) => Ok(NoteColor::Solid(s)),
            Value::Object(map) => {
                let ty = map.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let top = map.get("top").and_then(|v| v.as_str());
                let bottom = map.get("bottom").and_then(|v| v.as_str());
                match (top, bottom) {
                    (Some(top), Some(bottom)) => Ok(NoteColor::Gradient {
                        top: top.to_string(),
                        bottom: bottom.to_string(),
                    }),
                    _ => Err(DeError::custom(format!(
                        "invalid noteColor object (type={})",
                        ty
                    ))),
                }
            }
            _ => Err(DeError::custom("invalid noteColor value")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct CustomCss {
    pub path: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomCssHistoryEntry {
    pub path: String,
    #[serde(default)]
    pub loaded_at: i64,
    pub last_used_at: i64,
}

/// 탭별 CSS 설정
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabCss {
    pub path: Option<String>,
    pub content: String,
    /// 이 탭에서 CSS 사용 여부 (false면 전역/탭 CSS 모두 미적용)
    #[serde(default = "default_tab_css_enabled")]
    pub enabled: bool,
}

fn default_tab_css_enabled() -> bool {
    true
}

impl Default for TabCss {
    fn default() -> Self {
        Self {
            path: None,
            content: String::new(),
            enabled: true,
        }
    }
}

/// 탭별 CSS 오버라이드 맵 (키: 탭 ID, 값: TabCss)
pub type TabCssOverrides = HashMap<String, TabCss>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JsPlugin {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub content: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct CustomJs {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub plugins: Vec<JsPlugin>,
}

impl CustomJs {
    pub fn normalize(&mut self) -> bool {
        let mut mutated = false;

        for plugin in self.plugins.iter_mut() {
            if plugin.id.trim().is_empty() {
                plugin.id = Uuid::new_v4().to_string();
                mutated = true;
            }
            if plugin.name.trim().is_empty() {
                plugin.name = plugin
                    .path
                    .as_deref()
                    .and_then(|value| Path::new(value).file_name())
                    .and_then(|value| value.to_str())
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "plugin.js".to_string());
                mutated = true;
            }
        }

        if self.plugins.is_empty() && (self.path.is_some() || !self.content.is_empty()) {
            let name = self
                .path
                .as_deref()
                .and_then(|value| Path::new(value).file_name())
                .and_then(|value| value.to_str())
                .map(|value| value.to_string())
                .unwrap_or_else(|| "custom.js".to_string());
            let plugin = JsPlugin {
                id: Uuid::new_v4().to_string(),
                name,
                path: self.path.clone(),
                content: self.content.clone(),
                enabled: true,
            };
            self.plugins.push(plugin);
            self.path = None;
            self.content.clear();
            mutated = true;
        }

        mutated
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum OverlayResizeAnchor {
    #[default]
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
    FixedPosition,
}

/// 그리드 스마트 가이드 설정
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GridSettings {
    /// 정렬 가이드 활성화 (드래그/리사이즈 시 요소 정렬 스냅)
    #[serde(default = "default_true")]
    pub alignment_guides: bool,
    /// 간격 일치 가이드 활성화 (요소 간 간격 일치 스냅)
    #[serde(default = "default_true")]
    pub spacing_guides: bool,
    /// 크기 일치 가이드 활성화 (리사이즈 시 크기 일치 스냅)
    #[serde(default = "default_true")]
    pub size_match_guides: bool,
    /// 미니맵 표시 여부
    #[serde(default = "default_true")]
    pub minimap_enabled: bool,
    /// 그리드 스냅 크기 (0-10px, 0은 끄기)
    #[serde(default = "default_grid_snap_size")]
    pub grid_snap_size: u32,
    /// 오버레이 여백 (0-30px)
    #[serde(default = "default_overlay_padding")]
    pub overlay_padding: u32,
}

fn default_auto_update_enabled() -> bool {
    true
}

// 렌더러 백엔드 기본값, macOS는 metal 고정 그 외는 d3d11
pub(crate) fn default_angle_mode() -> String {
    if cfg!(target_os = "macos") {
        "metal".to_string()
    } else {
        "d3d11".to_string()
    }
}

fn default_obs_port() -> u16 {
    obs::DEFAULT_OBS_PORT
}

fn default_grid_snap_size() -> u32 {
    5
}

fn default_overlay_padding() -> u32 {
    30
}

impl Default for GridSettings {
    fn default() -> Self {
        Self {
            alignment_guides: true,
            spacing_guides: true,
            size_match_guides: true,
            minimap_enabled: true,
            grid_snap_size: default_grid_snap_size(),
            overlay_padding: default_overlay_padding(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverlayBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredOverlayNativePosition {
    pub x: f64,
    pub y: f64,
    pub logical_echo_x: f64,
    pub logical_echo_y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredOverlayBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_position: Option<StoredOverlayNativePosition>,
}

impl StoredOverlayBounds {
    pub fn public_bounds(&self) -> OverlayBounds {
        OverlayBounds {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

impl From<OverlayBounds> for StoredOverlayBounds {
    fn from(bounds: OverlayBounds) -> Self {
        Self {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            native_position: None,
        }
    }
}

/// 분리 패널의 마지막 기하 정보. 복원에 쓰는 값은 height뿐이고
/// x/y는 이동 기록으로만 남는다 - 패널은 열 때마다 메인 창 옆에 다시 배치된다
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PanelBounds {
    pub x: f64,
    pub y: f64,
    pub height: f64,
}
impl OverlayResizeAnchor {
    pub fn as_str(&self) -> &'static str {
        match self {
            OverlayResizeAnchor::TopLeft => "top-left",
            OverlayResizeAnchor::TopRight => "top-right",
            OverlayResizeAnchor::BottomLeft => "bottom-left",
            OverlayResizeAnchor::BottomRight => "bottom-right",
            OverlayResizeAnchor::Center => "center",
            OverlayResizeAnchor::FixedPosition => "fixed-position",
        }
    }
}

pub fn overlay_resize_anchor_from_str(value: &str) -> Option<OverlayResizeAnchor> {
    match value {
        "top-left" => Some(OverlayResizeAnchor::TopLeft),
        "top-right" => Some(OverlayResizeAnchor::TopRight),
        "bottom-left" => Some(OverlayResizeAnchor::BottomLeft),
        "bottom-right" => Some(OverlayResizeAnchor::BottomRight),
        "center" => Some(OverlayResizeAnchor::Center),
        "fixed-position" => Some(OverlayResizeAnchor::FixedPosition),
        _ => None,
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomTab {
    pub id: String,
    pub name: String,
}

pub const BUILTIN_TAB_IDS: [&str; 4] = ["4key", "5key", "6key", "8key"];

pub(crate) fn default_bar_count() -> u8 {
    crate::state::tab_metadata::MAX_BAR_SLOTS
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayerGroupDef {
    pub id: String,
    pub name: String,
}

pub type LayerGroups = HashMap<String, Vec<LayerGroupDef>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppStoreData {
    pub hardware_acceleration: bool,
    pub always_on_top: bool,
    pub overlay_locked: bool,
    #[serde(default)]
    pub overlay_visible: bool,
    pub note_effect: bool,
    #[serde(default)]
    pub note_settings: NoteSettings,
    pub selected_key_type: String,
    #[serde(default)]
    pub custom_tabs: Vec<CustomTab>,
    #[serde(default)]
    pub tab_order: Vec<String>,
    #[serde(default = "default_bar_count")]
    pub bar_count: u8,
    pub angle_mode: String,
    pub language: String,
    pub laboratory_enabled: bool,
    #[serde(default)]
    pub developer_mode_enabled: bool,
    #[serde(default)]
    pub tray_enabled: bool,
    #[serde(default = "default_auto_update_enabled")]
    pub auto_update_enabled: bool,
    #[serde(default)]
    pub main_window_hidden: bool,
    #[serde(default)]
    pub editor_revision: u64,
    #[serde(default)]
    pub keys: KeyMappings,
    #[serde(default)]
    pub key_positions: KeyPositions,
    #[serde(default)]
    pub stat_positions: StatPositions,
    #[serde(default)]
    pub graph_positions: GraphPositions,
    #[serde(default)]
    pub knob_positions: KnobPositions,
    #[serde(default)]
    pub sprite_positions: SpritePositions,
    #[serde(default)]
    pub layer_groups: LayerGroups,
    #[serde(default)]
    pub key_counters: KeyCounters,
    pub background_color: String,
    pub use_custom_css: bool,
    #[serde(default)]
    pub custom_css: CustomCss,
    #[serde(default)]
    pub custom_css_history: Vec<CustomCssHistoryEntry>,
    #[serde(default)]
    pub font_settings: FontSettings,
    #[serde(default)]
    pub counter_animation_presets: Vec<CounterAnimationPreset>,
    /// 탭별 CSS 오버라이드 (전역 CSS 대신 사용)
    #[serde(default)]
    pub tab_css_overrides: TabCssOverrides,
    /// 탭별 노트 트랙 설정 오버라이드
    #[serde(default)]
    pub tab_note_overrides: TabNoteOverrides,
    #[serde(default)]
    pub use_custom_js: bool,
    #[serde(default)]
    pub custom_js: CustomJs,
    pub overlay_resize_anchor: OverlayResizeAnchor,
    pub overlay_bounds: Option<StoredOverlayBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_bounds: Option<PanelBounds>,
    /// 분리 패널 창 존재 여부 (재시작 복원용)
    #[serde(default)]
    pub panel_detached: bool,
    pub overlay_last_content_left_offset: Option<f64>,
    pub overlay_last_content_top_offset: Option<f64>,
    #[serde(default)]
    pub overlay_bounds_are_logical: bool,
    #[serde(default)]
    pub key_counter_enabled: bool,
    /// 그리드 스마트 가이드 설정
    #[serde(default)]
    pub grid_settings: GridSettings,
    /// 단축키 설정
    #[serde(default)]
    pub shortcuts: ShortcutsState,
    /// 사운드 라이브러리 메타데이터 (키: 절대 경로, 값: 메타데이터)
    #[serde(default)]
    pub sound_library: HashMap<String, SoundLibraryEntry>,
    /// WAV 파일과 메타데이터 커밋 사이의 크래시 복구 저널
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_processed_wav_replacement: Option<PendingProcessedWavReplacement>,
    #[serde(default)]
    pub key_sound_output_backend: Option<KeySoundOutputBackendPersist>,
    /// OBS 모드 활성화 여부
    #[serde(default)]
    pub obs_mode_enabled: bool,
    /// OBS WebSocket 서버 포트
    #[serde(default = "default_obs_port")]
    pub obs_port: u16,
    /// OBS 세션 토큰 (영구 저장, 앱 재시작 시 재사용)
    #[serde(default)]
    pub obs_token: Option<String>,
    /// 플러그인 데이터 저장소 (plugin_data_* 키로 저장)
    #[serde(default, flatten)]
    pub plugin_data: HashMap<String, serde_json::Value>,
}

impl Default for AppStoreData {
    fn default() -> Self {
        Self {
            hardware_acceleration: true,
            always_on_top: true,
            overlay_locked: false,
            overlay_visible: false,
            note_effect: false,
            note_settings: NoteSettings::default(),
            selected_key_type: "4key".to_string(),
            custom_tabs: Vec::new(),
            tab_order: BUILTIN_TAB_IDS.iter().map(|id| (*id).to_string()).collect(),
            bar_count: default_bar_count(),
            angle_mode: default_angle_mode(),
            language: "ko".to_string(),
            laboratory_enabled: false,
            developer_mode_enabled: false,
            tray_enabled: false,
            auto_update_enabled: default_auto_update_enabled(),
            main_window_hidden: false,
            editor_revision: 0,
            keys: KeyMappings::new(),
            key_positions: KeyPositions::new(),
            stat_positions: StatPositions::new(),
            graph_positions: GraphPositions::new(),
            knob_positions: KnobPositions::new(),
            sprite_positions: SpritePositions::new(),
            layer_groups: LayerGroups::new(),
            key_counters: KeyCounters::new(),
            background_color: "transparent".to_string(),
            use_custom_css: false,
            custom_css: CustomCss::default(),
            custom_css_history: Vec::new(),
            font_settings: FontSettings::default(),
            counter_animation_presets: Vec::new(),
            tab_css_overrides: TabCssOverrides::new(),
            tab_note_overrides: TabNoteOverrides::new(),
            use_custom_js: false,
            custom_js: CustomJs::default(),
            overlay_resize_anchor: OverlayResizeAnchor::TopLeft,
            overlay_bounds: None,
            panel_bounds: None,
            panel_detached: false,
            overlay_last_content_left_offset: None,
            overlay_last_content_top_offset: None,
            overlay_bounds_are_logical: false,
            key_counter_enabled: false,
            grid_settings: GridSettings::default(),
            shortcuts: ShortcutsState::default(),
            sound_library: HashMap::new(),
            pending_processed_wav_replacement: None,
            key_sound_output_backend: None,
            obs_mode_enabled: false,
            obs_port: default_obs_port(),
            obs_token: None,
            plugin_data: HashMap::new(),
        }
    }
}

impl AppStoreData {
    /// 설정 사영, store 필드가 설정 기본값의 단일 원천이고 SettingsState는 파생 뷰
    pub(crate) fn settings_state(&self) -> SettingsState {
        let mut custom_js = self.custom_js.clone();
        let _ = custom_js.normalize();

        SettingsState {
            hardware_acceleration: self.hardware_acceleration,
            always_on_top: self.always_on_top,
            overlay_locked: self.overlay_locked,
            note_effect: self.note_effect,
            note_settings: self.note_settings.clone(),
            angle_mode: self.angle_mode.clone(),
            language: self.language.clone(),
            laboratory_enabled: self.laboratory_enabled,
            developer_mode_enabled: self.developer_mode_enabled,
            tray_enabled: self.tray_enabled,
            auto_update_enabled: self.auto_update_enabled,
            background_color: self.background_color.clone(),
            use_custom_css: self.use_custom_css,
            custom_css: self.custom_css.clone(),
            font_settings: self.font_settings.clone(),
            use_custom_js: self.use_custom_js,
            custom_js,
            overlay_resize_anchor: self.overlay_resize_anchor.clone(),
            key_counter_enabled: self.key_counter_enabled,
            grid_settings: self.grid_settings.clone(),
            shortcuts: self.shortcuts.clone(),
            obs_mode_enabled: self.obs_mode_enabled,
        }
    }
}

#[cfg(test)]
mod tests;
