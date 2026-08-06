pub mod editor;
pub mod gesture;
pub mod obs;
pub mod plugin;

pub use editor::*;
pub use gesture::*;
pub use plugin::*;

use serde::de::Error as DeError;
use serde::ser::{Error as SerError, SerializeMap};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use uuid::Uuid;

pub const MAX_SLOT_KEYS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlotMatch {
    All,
    Any,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged, from = "RawKeySlot")]
pub enum KeySlot {
    Single(String),
    Multi {
        keys: Vec<String>,
        #[serde(rename = "match")]
        match_mode: SlotMatch,
    },
}

#[derive(Deserialize)]
#[serde(transparent)]
struct RawKeySlot(serde_json::Value);

impl From<RawKeySlot> for KeySlot {
    fn from(raw: RawKeySlot) -> Self {
        normalize_key_slot(raw.0)
    }
}

impl From<String> for KeySlot {
    fn from(value: String) -> Self {
        Self::Single(value)
    }
}

impl From<&str> for KeySlot {
    fn from(value: &str) -> Self {
        Self::Single(value.to_string())
    }
}

impl Default for KeySlot {
    fn default() -> Self {
        Self::Single(String::new())
    }
}

impl PartialEq<str> for KeySlot {
    fn eq(&self, other: &str) -> bool {
        matches!(self, Self::Single(key) if key == other)
    }
}

impl PartialEq<&str> for KeySlot {
    fn eq(&self, other: &&str) -> bool {
        self == *other
    }
}

impl PartialEq<String> for KeySlot {
    fn eq(&self, other: &String) -> bool {
        self == other.as_str()
    }
}

impl KeySlot {
    pub fn canonical(&self) -> String {
        match self {
            Self::Single(key) => key.clone(),
            Self::Multi {
                keys,
                match_mode: SlotMatch::All,
            } => keys.join("+"),
            Self::Multi {
                keys,
                match_mode: SlotMatch::Any,
            } => keys.join("|"),
        }
    }

    pub fn members(&self) -> std::slice::Iter<'_, String> {
        match self {
            Self::Single(key) => std::slice::from_ref(key).iter(),
            Self::Multi { keys, .. } => keys.iter(),
        }
    }

    pub fn is_unassigned(&self) -> bool {
        matches!(self, Self::Single(key) if key.is_empty())
    }

    pub fn is_multi(&self) -> bool {
        matches!(self, Self::Multi { .. })
    }
}

pub fn normalize_key_slot(raw: serde_json::Value) -> KeySlot {
    match raw {
        serde_json::Value::String(key) => {
            if (key.contains('+') && key != "+") || key.contains('|') {
                log::warn!(
                    "[Store] Key slot string contains a reserved canonical separator and may collide visually"
                );
            }
            KeySlot::Single(key)
        }
        serde_json::Value::Object(object) => {
            let has_unknown_fields = object.keys().any(|key| key != "keys" && key != "match");
            let match_mode = match object.get("match").and_then(serde_json::Value::as_str) {
                Some("all") => SlotMatch::All,
                Some("any") => SlotMatch::Any,
                _ => {
                    log::warn!("[Store] Normalized an invalid multi-key slot to an unassigned key");
                    return KeySlot::default();
                }
            };

            let mut changed = has_unknown_fields;
            let mut seen = HashSet::new();
            let mut keys = Vec::new();
            let entries = match object.get("keys") {
                Some(serde_json::Value::Array(entries)) => entries.as_slice(),
                _ => {
                    changed = true;
                    &[]
                }
            };
            for entry in entries {
                let Some(key) = entry.as_str() else {
                    changed = true;
                    continue;
                };
                if key.is_empty() || key.contains('+') || key.contains('|') {
                    changed = true;
                    continue;
                }
                if !seen.insert(key.to_string()) {
                    changed = true;
                    continue;
                }
                if keys.len() == MAX_SLOT_KEYS {
                    changed = true;
                    continue;
                }
                keys.push(key.to_string());
            }

            let normalized = match keys.len() {
                0 => KeySlot::default(),
                1 => KeySlot::Single(keys.pop().unwrap_or_default()),
                _ => KeySlot::Multi { keys, match_mode },
            };
            changed |= !normalized.is_multi();
            if changed {
                log::warn!("[Store] Normalized a malformed multi-key slot");
            }
            normalized
        }
        _ => {
            log::warn!("[Store] Normalized an invalid key slot to an unassigned key");
            KeySlot::default()
        }
    }
}

pub fn normalize_key_mappings(mappings: &mut HashMap<String, Vec<KeySlot>>) {
    for slot in mappings.values_mut().flatten() {
        let raw = serde_json::to_value(&*slot).unwrap_or(serde_json::Value::Null);
        *slot = normalize_key_slot(raw);
    }
}

pub fn key_mappings_contain_multi(mappings: &HashMap<String, Vec<KeySlot>>) -> bool {
    mappings.values().flatten().any(KeySlot::is_multi)
}

pub type KeyMappings = HashMap<String, Vec<KeySlot>>;
pub type KeyPositions = HashMap<String, Vec<KeyPosition>>;
pub type KeyCounters = HashMap<String, HashMap<String, u32>>;
pub type StatPositions = HashMap<String, Vec<StatPosition>>;
pub type GraphPositions = HashMap<String, Vec<GraphPosition>>;
pub type KnobPositions = HashMap<String, Vec<KnobPosition>>;

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
}

impl PartialEq for GradientSpec {
    fn eq(&self, other: &Self) -> bool {
        self.angle == other.angle && self.stops == other.stops
    }
}

impl GradientSpec {
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

        let mut gradient = Self {
            angle,
            stops,
            normalized_on_read: angle_value.is_none() || !input.is_empty(),
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
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum NoteAlignment {
    Left,
    #[default]
    Center,
    Right,
}

// 그림자 범위 계약 — 프론트 zod(ELEMENT_SHADOW_CONSTRAINTS)와 동기 유지
pub const SHADOW_OFFSET_MIN: f64 = -100.0;
pub const SHADOW_OFFSET_MAX: f64 = 100.0;
pub const SHADOW_BLUR_MIN: f64 = 0.0;
pub const SHADOW_BLUR_MAX: f64 = 100.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElementShadowSpec {
    pub enabled: bool,
    pub color: String,
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyPosition {
    pub dx: f64,
    pub dy: f64,
    pub width: f64,
    #[serde(default = "default_key_height")]
    pub height: f64,
    /// 레이어 표시 여부 (true면 숨김)
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub active_image: Option<String>,
    #[serde(default)]
    pub inactive_image: Option<String>,
    /// 키별 사운드 활성화 여부 (기본값 false)
    #[serde(default)]
    pub sound_enabled: Option<bool>,
    /// 키 입력 시 재생할 로컬 사운드 파일 경로
    #[serde(default)]
    pub sound_path: Option<String>,
    /// 키별 사운드 볼륨 (0~200, 기본값 100)
    #[serde(default)]
    pub sound_volume: Option<f64>,
    #[serde(default)]
    pub active_transparent: bool,
    #[serde(default)]
    pub idle_transparent: bool,
    pub count: u32,
    #[serde(default = "default_key_note_color")]
    pub note_color: NoteColor,
    #[serde(default = "default_key_note_opacity")]
    pub note_opacity: u32,
    #[serde(default)]
    pub note_opacity_top: Option<u32>,
    #[serde(default)]
    pub note_opacity_bottom: Option<u32>,
    #[serde(default)]
    pub note_border_radius: Option<f64>,
    /// 노트 넓이(px). None이면 키 width를 사용(자동).
    #[serde(default)]
    pub note_width: Option<f64>,
    /// 노트 정렬 (left/center/right). 기본값 center.
    #[serde(default)]
    pub note_alignment: NoteAlignment,
    #[serde(default = "default_note_effect_enabled")]
    pub note_effect_enabled: bool,
    #[serde(default = "default_note_glow_enabled")]
    pub note_glow_enabled: bool,
    #[serde(default = "default_note_glow_size")]
    pub note_glow_size: f64,
    #[serde(default = "default_note_glow_opacity")]
    pub note_glow_opacity: u32,
    #[serde(default)]
    pub note_glow_opacity_top: Option<u32>,
    #[serde(default)]
    pub note_glow_opacity_bottom: Option<u32>,
    #[serde(default)]
    pub note_glow_color: Option<NoteColor>,
    #[serde(default = "default_note_auto_y_correction")]
    pub note_auto_y_correction: bool,
    /// 노트 오프셋 X (px). 기본 정렬에 추가 보정값.
    #[serde(default)]
    pub note_offset_x: Option<f64>,
    /// 노트 오프셋 Y (px). 기본 정렬에 추가 보정값.
    #[serde(default)]
    pub note_offset_y: Option<f64>,
    /// 노트 테두리 굵기 (px). 0이면 테두리 없음.
    #[serde(default)]
    pub note_border_width: Option<f64>,
    /// 노트 테두리 색상
    #[serde(default)]
    pub note_border_color: Option<String>,
    /// 노트 테두리 투명도 (0~100). 노트 배경 투명도와 독립. 기본 100.
    #[serde(default = "default_note_border_opacity")]
    pub note_border_opacity: u32,
    /// 노트 테두리 방향 (all/vertical/horizontal)
    #[serde(default)]
    pub note_border_side: Option<String>,
    #[serde(default)]
    pub class_name: Option<String>,
    #[serde(default)]
    pub z_index: Option<i32>,
    #[serde(default)]
    pub counter: KeyCounterSettings,
    // 스타일 관련 속성들
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_gradient: Option<GradientSpec>,
    #[serde(default)]
    pub active_background_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_background_gradient: Option<GradientSpec>,
    #[serde(default)]
    pub border_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_gradient: Option<GradientSpec>,
    #[serde(default)]
    pub active_border_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_border_gradient: Option<GradientSpec>,
    #[serde(default)]
    pub border_width: Option<f64>,
    #[serde(default)]
    pub border_radius: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<ElementShadowSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_shadow: Option<ElementShadowSpec>,
    #[serde(default)]
    pub font_size: Option<f64>,
    #[serde(default)]
    pub font_color: Option<String>,
    #[serde(default)]
    pub active_font_color: Option<String>,
    #[serde(default)]
    pub graph_animation_enabled: Option<bool>,
    /// 글꼴 패밀리 (커스텀 폰트 이름)
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub image_fit: Option<ImageFit>,
    /// 이미지 맞춤(대기/입력 개별). 없으면 image_fit을 fallback으로 사용.
    #[serde(default)]
    pub idle_image_fit: Option<ImageFit>,
    #[serde(default)]
    pub active_image_fit: Option<ImageFit>,
    /// 인라인 스타일 우선 여부 (true: 속성 패널 스타일 우선, false: 커스텀 CSS 우선)
    #[serde(default)]
    pub use_inline_styles: Option<bool>,
    /// 키에 표시할 커스텀 텍스트 (None이면 기본 키 이름 표시)
    #[serde(default)]
    pub display_text: Option<String>,
    /// 글꼴 굵기 (CSS font-weight 값, 예: 400, 700)
    #[serde(default)]
    pub font_weight: Option<u32>,
    /// 이탤릭체 여부
    #[serde(default)]
    pub font_italic: Option<bool>,
    /// 밑줄 여부
    #[serde(default)]
    pub font_underline: Option<bool>,
    /// 취소선 여부
    #[serde(default)]
    pub font_strikethrough: Option<bool>,
    /// 레이어 패널에서 표시할 커스텀 이름
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_name: Option<String>,
    /// 레이어 그룹 ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

impl Default for KeyPosition {
    fn default() -> Self {
        Self {
            dx: 0.0,
            dy: 0.0,
            width: 60.0,
            height: default_key_height(),
            hidden: false,
            active_image: None,
            inactive_image: None,
            sound_enabled: None,
            sound_path: None,
            sound_volume: None,
            active_transparent: false,
            idle_transparent: false,
            count: 0,
            note_color: default_key_note_color(),
            note_opacity: default_key_note_opacity(),
            note_opacity_top: None,
            note_opacity_bottom: None,
            note_border_radius: None,
            note_width: None,
            note_alignment: NoteAlignment::default(),
            note_effect_enabled: default_note_effect_enabled(),
            note_glow_enabled: default_note_glow_enabled(),
            note_glow_size: default_note_glow_size(),
            note_glow_opacity: default_note_glow_opacity(),
            note_glow_opacity_top: None,
            note_glow_opacity_bottom: None,
            note_glow_color: None,
            note_auto_y_correction: default_note_auto_y_correction(),
            note_offset_x: None,
            note_offset_y: None,
            note_border_width: None,
            note_border_color: None,
            note_border_opacity: default_note_border_opacity(),
            note_border_side: None,
            class_name: None,
            z_index: None,
            counter: KeyCounterSettings::default(),
            background_color: None,
            background_gradient: None,
            active_background_color: None,
            active_background_gradient: None,
            border_color: None,
            border_gradient: None,
            active_border_color: None,
            active_border_gradient: None,
            border_width: None,
            border_radius: None,
            shadow: None,
            active_shadow: None,
            font_size: None,
            font_color: None,
            active_font_color: None,
            graph_animation_enabled: None,
            font_family: None,
            image_fit: None,
            idle_image_fit: None,
            active_image_fit: None,
            use_inline_styles: None,
            display_text: None,
            font_weight: None,
            font_italic: None,
            font_underline: None,
            font_strikethrough: None,
            layer_name: None,
            group_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum StatType {
    Kps,
    KpsAvg,
    KpsMax,
    Total,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatPosition {
    pub stat_type: StatType,
    #[serde(flatten)]
    pub position: KeyPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GraphStatType {
    Kps,
    KpsAvg,
    KpsMax,
    Total,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GraphType {
    Line,
    Bar,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphPosition {
    pub stat_type: GraphStatType,
    pub graph_type: GraphType,
    pub graph_speed: u32,
    pub graph_color: String,
    #[serde(default = "default_true")]
    pub show_avg_line: bool,
    #[serde(flatten)]
    pub position: KeyPosition,
}

fn default_knob_sensitivity() -> f64 {
    // 순수 배율 — 1이면 축 해상도와 무관하게 물리 1회전 ≈ 화면 1회전
    // (프론트엔드가 wrap 델타를 축 해상도로 정규화해 회전수 단위로 누적)
    1.0
}

/// 회전(노브) 요소 — HID 축에 바인딩. KeyPosition 상속(표시명/스타일/클래스/이미지) + 노브 전용 필드.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnobPosition {
    /// 바인딩된 HID 축 식별자 "HIDA:vid:pid:usagePage:usage"
    #[serde(default)]
    pub axis_id: String,
    /// 회전 배율 (물리 1회전당 화면 회전 수)
    #[serde(default = "default_knob_sensitivity")]
    pub sensitivity: f64,
    /// 회전 방향 반전
    #[serde(default)]
    pub reverse: bool,
    #[serde(flatten)]
    pub position: KeyPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum KeyCounterPlacement {
    #[default]
    Inside,
    Outside,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum KeyCounterAlign {
    Top,
    // align 필드 부재 시에도 새 기본 배치와 일치하도록 serde 기본값 겸용
    #[default]
    Bottom,
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum KeyCounterAlignMode {
    #[default]
    Center,
    Between,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyCounterColor {
    pub idle: String,
    pub active: String,
}

impl Default for KeyCounterColor {
    fn default() -> Self {
        Self {
            // 렌더러 기본 키 텍스트 색과 일치 (utils/core/elementDefaults.ts)
            idle: "rgba(237, 238, 242, 0.78)".to_string(),
            active: "rgba(20, 20, 24, 0.9)".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CounterAnimationSource {
    Builtin,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CounterAnimationPreset {
    pub id: String,
    pub name: String,
    #[serde(rename = "source")]
    pub source: CounterAnimationSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_key: Option<String>,
    pub bezier: [f64; 4],
    pub scale: f64,
    pub duration_ms: u32,
}

impl CounterAnimationPreset {
    pub fn normalize(&mut self) {
        let mut animation = KeyCounterAnimationSettings {
            enabled: true,
            preset_id: None,
            bezier: self.bezier,
            scale: self.scale,
            duration_ms: self.duration_ms,
        };
        animation.normalize();
        self.bezier = animation.bezier;
        self.scale = animation.scale;
        self.duration_ms = animation.duration_ms;
        self.name = self.name.trim().to_string();
    }

    pub fn is_valid_user_entry(&self) -> bool {
        self.source == CounterAnimationSource::User
            && !self.id.trim().is_empty()
            && !self.name.trim().is_empty()
    }
}

fn builtin_counter_animation_presets() -> Vec<CounterAnimationPreset> {
    vec![
        CounterAnimationPreset {
            id: "builtin-ease-out".to_string(),
            name: "Default".to_string(),
            source: CounterAnimationSource::Builtin,
            label_key: None,
            bezier: [0.25, 0.46, 0.45, 0.94],
            scale: 1.1,
            duration_ms: 300,
        },
        CounterAnimationPreset {
            id: "builtin-linear".to_string(),
            name: "Linear".to_string(),
            source: CounterAnimationSource::Builtin,
            label_key: None,
            bezier: [0.0, 0.0, 1.0, 1.0],
            scale: 1.1,
            duration_ms: 300,
        },
        CounterAnimationPreset {
            id: "builtin-ease-out-css".to_string(),
            name: "Ease Out".to_string(),
            source: CounterAnimationSource::Builtin,
            label_key: None,
            bezier: [0.0, 0.0, 0.58, 1.0],
            scale: 1.1,
            duration_ms: 300,
        },
        CounterAnimationPreset {
            id: "builtin-ease-in".to_string(),
            name: "Ease In".to_string(),
            source: CounterAnimationSource::Builtin,
            label_key: None,
            bezier: [0.42, 0.0, 1.0, 1.0],
            scale: 1.1,
            duration_ms: 300,
        },
        CounterAnimationPreset {
            id: "builtin-ease-in-out".to_string(),
            name: "Ease In-Out".to_string(),
            source: CounterAnimationSource::Builtin,
            label_key: None,
            bezier: [0.42, 0.0, 0.58, 1.0],
            scale: 1.1,
            duration_ms: 300,
        },
        CounterAnimationPreset {
            id: "builtin-overshoot".to_string(),
            name: "Overshoot".to_string(),
            source: CounterAnimationSource::Builtin,
            label_key: None,
            bezier: [0.34, 1.56, 0.64, 1.0],
            scale: 1.15,
            duration_ms: 360,
        },
    ]
}

pub fn default_counter_animation_preset_id() -> &'static str {
    "builtin-ease-out"
}

pub fn default_counter_animation_builtin_presets() -> Vec<CounterAnimationPreset> {
    builtin_counter_animation_presets()
}

pub fn find_builtin_counter_animation_preset_by_id(id: &str) -> Option<CounterAnimationPreset> {
    builtin_counter_animation_presets()
        .into_iter()
        .find(|preset| preset.id == id)
}

pub fn infer_builtin_counter_animation_preset_id(
    bezier: [f64; 4],
    scale: f64,
    duration_ms: u32,
) -> Option<String> {
    const BEZIER_EPSILON: f64 = 0.001;
    const SCALE_EPSILON: f64 = 0.001;

    builtin_counter_animation_presets()
        .into_iter()
        .find(|preset| {
            let bezier_matches = preset
                .bezier
                .iter()
                .zip(bezier.iter())
                .all(|(a, b)| (*a - *b).abs() <= BEZIER_EPSILON);
            let scale_matches = (preset.scale - scale).abs() <= SCALE_EPSILON;
            let duration_matches = preset.duration_ms == duration_ms;
            bezier_matches && scale_matches && duration_matches
        })
        .map(|preset| preset.id)
}

pub fn normalize_user_counter_animation_presets(
    presets: Vec<CounterAnimationPreset>,
) -> Vec<CounterAnimationPreset> {
    let mut seen_ids = std::collections::HashSet::new();
    let mut normalized: Vec<CounterAnimationPreset> = presets
        .into_iter()
        .filter_map(|mut preset| {
            preset.normalize();
            if !preset.is_valid_user_entry() {
                return None;
            }
            if !seen_ids.insert(preset.id.clone()) {
                return None;
            }
            preset.source = CounterAnimationSource::User;
            preset.label_key = None;
            Some(preset)
        })
        .collect();

    normalized.sort_by_key(|a| a.name.to_lowercase());
    normalized
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyCounterAnimationSettings {
    #[serde(default = "default_counter_animation_enabled")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset_id: Option<String>,
    #[serde(default = "default_counter_animation_bezier")]
    pub bezier: [f64; 4],
    #[serde(default = "default_counter_animation_scale")]
    pub scale: f64,
    #[serde(default = "default_counter_animation_duration_ms")]
    pub duration_ms: u32,
}

impl Default for KeyCounterAnimationSettings {
    fn default() -> Self {
        Self {
            enabled: default_counter_animation_enabled(),
            preset_id: Some(default_counter_animation_preset_id().to_string()),
            bezier: default_counter_animation_bezier(),
            scale: default_counter_animation_scale(),
            duration_ms: default_counter_animation_duration_ms(),
        }
    }
}

impl KeyCounterAnimationSettings {
    pub fn normalize(&mut self) {
        let fallback = default_counter_animation_bezier();
        for i in [0, 2] {
            let value = self.bezier[i];
            self.bezier[i] = if value.is_finite() {
                value.clamp(0.0, 1.0)
            } else {
                fallback[i]
            };
        }
        for i in [1, 3] {
            let value = self.bezier[i];
            self.bezier[i] = if value.is_finite() {
                value.clamp(-2.0, 2.0)
            } else {
                fallback[i]
            };
        }

        self.scale = if self.scale.is_finite() {
            self.scale
        } else {
            default_counter_animation_scale()
        };
        self.duration_ms = self.duration_ms.clamp(1, 5000);

        self.preset_id = self
            .preset_id
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        if self.preset_id.is_none() {
            self.preset_id = infer_builtin_counter_animation_preset_id(
                self.bezier,
                self.scale,
                self.duration_ms,
            );
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyCounterSettings {
    #[serde(default = "default_counter_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub placement: KeyCounterPlacement,
    #[serde(default)]
    pub align: KeyCounterAlign,
    #[serde(default)]
    pub align_mode: KeyCounterAlignMode,
    #[serde(default)]
    pub fill: KeyCounterColor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_idle_gradient: Option<GradientSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_active_gradient: Option<GradientSpec>,
    #[serde(default = "default_stroke_color")]
    pub stroke: KeyCounterColor,
    #[serde(default = "default_gap")]
    pub gap: u32,
    #[serde(default = "default_counter_font_size")]
    pub font_size: u32,
    #[serde(default = "default_counter_font_weight")]
    pub font_weight: u32,
    /// 카운터 글꼴 패밀리 (커스텀 폰트 이름)
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub font_italic: bool,
    #[serde(default)]
    pub font_underline: bool,
    #[serde(default)]
    pub font_strikethrough: bool,
    #[serde(default)]
    pub animation: KeyCounterAnimationSettings,
}

fn default_stroke_color() -> KeyCounterColor {
    KeyCounterColor {
        // 기본값: 외곽선 없음 (렌더러 기본값과 일치)
        idle: "transparent".to_string(),
        active: "transparent".to_string(),
    }
}

impl Default for KeyCounterSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            placement: KeyCounterPlacement::Inside,
            align: KeyCounterAlign::Bottom,
            align_mode: KeyCounterAlignMode::Center,
            fill: KeyCounterColor::default(),
            fill_idle_gradient: None,
            fill_active_gradient: None,
            stroke: default_stroke_color(),
            gap: default_gap(),
            font_size: default_counter_font_size(),
            font_weight: default_counter_font_weight(),
            font_family: None,
            font_italic: false,
            font_underline: false,
            font_strikethrough: false,
            animation: KeyCounterAnimationSettings::default(),
        }
    }
}

impl KeyCounterSettings {
    pub fn normalize(&mut self) {
        self.animation.normalize();
    }

    /// Migrate legacy defaults that were previously serialized into store.json.
    /// This keeps existing user customizations intact, while fixing the old default
    /// active fill/stroke values (black text / outlined) that diverged from the renderer.
    pub fn migrate_legacy_defaults(&mut self) -> bool {
        if self.fill_idle_gradient.is_some() || self.fill_active_gradient.is_some() {
            self.normalize();
            return false;
        }

        // 당시 직렬화되던 스냅샷 값 고정 — 현재 기본값 함수와 결합 금지
        let looks_like_legacy_default = self.fill.idle == "#FFFFFF"
            && self.fill.active == "#000000"
            && self.stroke.idle == "#000000"
            && self.stroke.active == "#FFFFFF"
            && matches!(self.placement, KeyCounterPlacement::Inside)
            && matches!(self.align, KeyCounterAlign::Top)
            && matches!(self.align_mode, KeyCounterAlignMode::Center)
            && self.gap == 6
            && self.font_size == 16
            && self.font_weight == 400
            && self.font_family.is_none()
            && !self.font_italic
            && !self.font_underline
            && !self.font_strikethrough;

        if looks_like_legacy_default {
            self.fill = KeyCounterColor::default();
            self.stroke = default_stroke_color();
            self.align = KeyCounterAlign::Bottom;
            self.gap = default_gap();
            self.font_size = default_counter_font_size();
            self.font_weight = default_counter_font_weight();
            self.animation = KeyCounterAnimationSettings::default();
            self.normalize();
            return true;
        }

        // 직전 기본값 스냅샷(회색 카운터·16px·700·상단 배치) → 글래스 기본 디자인으로 승격
        // 전 필드 일치일 때만 — 하나라도 다르면 사용자 커스텀으로 보고 유지
        let looks_like_previous_default = self.fill.idle == "rgba(121, 121, 121, 0.9)"
            && self.fill.active == "#FFFFFF"
            && self.stroke.idle == "transparent"
            && self.stroke.active == "transparent"
            && matches!(self.placement, KeyCounterPlacement::Inside)
            && matches!(self.align, KeyCounterAlign::Top)
            && matches!(self.align_mode, KeyCounterAlignMode::Center)
            && self.gap == 6
            && self.font_size == 16
            && self.font_weight == 700
            && self.font_family.is_none()
            && !self.font_italic
            && !self.font_underline
            && !self.font_strikethrough;

        if looks_like_previous_default {
            self.fill = KeyCounterColor::default();
            self.align = KeyCounterAlign::Bottom;
            self.gap = default_gap();
            self.font_size = default_counter_font_size();
            self.font_weight = default_counter_font_weight();
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

impl KeyPosition {
    pub(crate) fn canonicalize_gradient_pairs(&mut self) -> (bool, bool) {
        let mut changed = false;
        let mut pair_repaired = false;

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
    let Some(gradient) = gradient else {
        return (false, false);
    };

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

fn compact_canonical_rgba(color: &str) -> String {
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

fn default_counter_animation_enabled() -> bool {
    false
}

fn default_counter_animation_bezier() -> [f64; 4] {
    [0.25, 0.46, 0.45, 0.94]
}

fn default_counter_animation_scale() -> f64 {
    1.1
}

fn default_counter_animation_duration_ms() -> u32 {
    300
}

fn default_gap() -> u32 {
    4
}
fn default_counter_font_size() -> u32 {
    11
}
fn default_counter_font_weight() -> u32 {
    500
}

fn default_counter_enabled() -> bool {
    true
}
fn default_note_effect_enabled() -> bool {
    true
}
fn default_key_height() -> f64 {
    60.0
}
fn default_key_note_color() -> NoteColor {
    NoteColor::Solid("#FFFFFF".to_string())
}
fn default_key_note_opacity() -> u32 {
    90
}
fn default_note_glow_enabled() -> bool {
    false
}
fn default_note_glow_size() -> f64 {
    20.0
}

fn default_note_border_opacity() -> u32 {
    100
}
fn default_note_glow_opacity() -> u32 {
    70
}
fn default_note_auto_y_correction() -> bool {
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
    /// 그리드 스냅 크기 (1-10px)
    #[serde(default = "default_grid_snap_size")]
    pub grid_snap_size: u32,
    /// 오버레이 여백 (0-30px)
    #[serde(default = "default_overlay_padding")]
    pub overlay_padding: u32,
}

fn default_true() -> bool {
    true
}

fn default_auto_update_enabled() -> bool {
    true
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
    pub overlay_bounds: Option<OverlayBounds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_bounds: Option<PanelBounds>,
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
            angle_mode: if cfg!(target_os = "macos") {
                "metal".to_string()
            } else {
                "d3d11".to_string()
            },
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapOverlayState {
    pub visible: bool,
    pub locked: bool,
    pub anchor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    pub settings: SettingsState,
    pub defaults: DefaultsPayload,
    pub keys: KeyMappings,
    pub positions: KeyPositions,
    pub stat_positions: StatPositions,
    pub graph_positions: GraphPositions,
    pub knob_positions: KnobPositions,
    pub custom_tabs: Vec<CustomTab>,
    pub selected_key_type: String,
    pub current_mode: String,
    pub active_keys: Vec<String>,
    pub overlay: BootstrapOverlayState,
    pub key_counters: KeyCounters,
    pub key_counters_session_id: String,
    pub key_counters_revision: u64,
    pub layer_groups: LayerGroups,
    pub tab_note_overrides: TabNoteOverrides,
    pub tab_css_overrides: TabCssOverrides,
    pub editor_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultsPayload {
    pub settings: SettingsState,
    pub counter_settings: KeyCounterSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsState {
    pub hardware_acceleration: bool,
    pub always_on_top: bool,
    pub overlay_locked: bool,
    pub note_effect: bool,
    #[serde(default)]
    pub note_settings: NoteSettings,
    pub angle_mode: String,
    pub language: String,
    pub laboratory_enabled: bool,
    #[serde(default)]
    pub developer_mode_enabled: bool,
    #[serde(default)]
    pub tray_enabled: bool,
    #[serde(default = "default_auto_update_enabled")]
    pub auto_update_enabled: bool,
    pub background_color: String,
    #[serde(rename = "useCustomCSS")]
    pub use_custom_css: bool,
    #[serde(rename = "customCSS")]
    #[serde(default)]
    pub custom_css: CustomCss,
    #[serde(default)]
    pub font_settings: FontSettings,
    #[serde(rename = "useCustomJS")]
    pub use_custom_js: bool,
    #[serde(rename = "customJS")]
    #[serde(default)]
    pub custom_js: CustomJs,
    pub overlay_resize_anchor: OverlayResizeAnchor,
    #[serde(default)]
    pub key_counter_enabled: bool,
    #[serde(default)]
    pub grid_settings: GridSettings,
    #[serde(default)]
    pub shortcuts: ShortcutsState,
    #[serde(default)]
    pub obs_mode_enabled: bool,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self {
            hardware_acceleration: true,
            always_on_top: true,
            overlay_locked: false,
            note_effect: false,
            note_settings: NoteSettings::default(),
            angle_mode: if cfg!(target_os = "macos") {
                "metal".to_string()
            } else {
                "d3d11".to_string()
            },
            language: "ko".to_string(),
            laboratory_enabled: false,
            developer_mode_enabled: false,
            tray_enabled: false,
            auto_update_enabled: default_auto_update_enabled(),
            background_color: "transparent".to_string(),
            use_custom_css: false,
            custom_css: CustomCss::default(),
            font_settings: FontSettings::default(),
            use_custom_js: false,
            custom_js: CustomJs::default(),
            overlay_resize_anchor: OverlayResizeAnchor::TopLeft,
            key_counter_enabled: false,
            grid_settings: GridSettings::default(),
            shortcuts: ShortcutsState::default(),
            obs_mode_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[derive(Default)]
pub struct NoteSettingsPatch {
    pub frame_limit: Option<u32>,
    pub speed: Option<u32>,
    pub track_height: Option<u32>,
    pub reverse: Option<bool>,
    pub fade_position: Option<FadePosition>,
    pub fade_top_px: Option<u32>,
    pub fade_bottom_px: Option<u32>,
    pub reverse_fade_top_px: Option<u32>,
    pub reverse_fade_bottom_px: Option<u32>,
    pub delayed_note_enabled: Option<bool>,
    pub short_note_threshold_ms: Option<u32>,
    pub short_note_min_length_px: Option<u32>,
    pub key_display_delay_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatchInput {
    pub hardware_acceleration: Option<bool>,
    pub always_on_top: Option<bool>,
    pub overlay_locked: Option<bool>,
    pub note_effect: Option<bool>,
    pub note_settings: Option<NoteSettingsPatch>,
    pub angle_mode: Option<String>,
    pub language: Option<String>,
    pub laboratory_enabled: Option<bool>,
    pub developer_mode_enabled: Option<bool>,
    pub tray_enabled: Option<bool>,
    pub auto_update_enabled: Option<bool>,
    pub background_color: Option<String>,
    #[serde(rename = "useCustomCSS")]
    pub use_custom_css: Option<bool>,
    #[serde(rename = "customCSS")]
    pub custom_css: Option<CustomCssPatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_settings: Option<FontSettings>,
    #[serde(rename = "useCustomJS")]
    pub use_custom_js: Option<bool>,
    #[serde(rename = "customJS")]
    pub custom_js: Option<CustomJsPatch>,
    pub overlay_resize_anchor: Option<OverlayResizeAnchor>,
    pub key_counter_enabled: Option<bool>,
    pub grid_settings: Option<GridSettings>,
    pub shortcuts: Option<ShortcutsPatchInput>,
    pub obs_mode_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomCssPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomJsPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugins: Option<Vec<JsPlugin>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDiff {
    pub changed: SettingsPatch,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full: Option<SettingsState>,
}

impl SettingsDiff {
    pub fn changed_count(&self) -> usize {
        let p = &self.changed;
        [
            p.hardware_acceleration.is_some(),
            p.always_on_top.is_some(),
            p.overlay_locked.is_some(),
            p.note_effect.is_some(),
            p.note_settings.is_some(),
            p.angle_mode.is_some(),
            p.language.is_some(),
            p.laboratory_enabled.is_some(),
            p.developer_mode_enabled.is_some(),
            p.tray_enabled.is_some(),
            p.auto_update_enabled.is_some(),
            p.background_color.is_some(),
            p.use_custom_css.is_some(),
            p.custom_css.is_some(),
            p.font_settings.is_some(),
            p.use_custom_js.is_some(),
            p.custom_js.is_some(),
            p.overlay_resize_anchor.is_some(),
            p.key_counter_enabled.is_some(),
            p.grid_settings.is_some(),
            p.shortcuts.is_some(),
            p.obs_mode_enabled.is_some(),
        ]
        .iter()
        .filter(|&&x| x)
        .count()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hardware_acceleration: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub always_on_top: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlay_locked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_effect: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_settings: Option<NoteSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angle_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub laboratory_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer_mode_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tray_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_update_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(rename = "useCustomCSS")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_custom_css: Option<bool>,
    #[serde(rename = "customCSS")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_css: Option<CustomCss>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_settings: Option<FontSettings>,
    #[serde(rename = "useCustomJS")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_custom_js: Option<bool>,
    #[serde(rename = "customJS")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_js: Option<CustomJs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlay_resize_anchor: Option<OverlayResizeAnchor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_counter_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid_settings: Option<GridSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcuts: Option<ShortcutsState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obs_mode_enabled: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::{
        compact_canonical_rgba, FadePosition, GradientSpec, KeyCounterAlign, KeyCounterAlignMode,
        KeyCounterColor, KeyCounterPlacement, KeyCounterSettings, KeyMappings, KeyPosition,
        KeySlot, NoteColor, NoteSettings, SlotMatch, StatType, MAX_SLOT_KEYS,
    };
    use serde::Deserialize;

    #[test]
    fn legacy_string_key_mappings_round_trip_without_loss() {
        let raw = serde_json::json!({
            "4key": ["A", "A+B", "+", ""]
        });

        let mappings: KeyMappings = serde_json::from_value(raw.clone()).unwrap();

        assert_eq!(serde_json::to_value(mappings).unwrap(), raw);
    }

    #[test]
    fn multi_key_slot_wire_shape_and_canonical_are_stable() {
        let raw = serde_json::json!({ "keys": ["LEFT CTRL", "Z"], "match": "all" });

        let slot: KeySlot = serde_json::from_value(raw.clone()).unwrap();

        assert_eq!(
            slot,
            KeySlot::Multi {
                keys: vec!["LEFT CTRL".to_string(), "Z".to_string()],
                match_mode: SlotMatch::All,
            }
        );
        assert_eq!(slot.canonical(), "LEFT CTRL+Z");
        assert_eq!(serde_json::to_value(slot).unwrap(), raw);
    }

    #[test]
    fn malformed_key_slots_normalize_without_deserialization_failure() {
        let too_many = (0..=MAX_SLOT_KEYS)
            .map(|index| serde_json::Value::String(format!("K{index}")))
            .collect::<Vec<_>>();
        let cases = [
            (serde_json::json!({ "keys": ["Z"] }), KeySlot::default()),
            (
                serde_json::json!({
                    "keys": ["A", 7, "", "A", "B+C", "D|E", "B"],
                    "match": "any",
                    "ignored": true
                }),
                KeySlot::Multi {
                    keys: vec!["A".to_string(), "B".to_string()],
                    match_mode: SlotMatch::Any,
                },
            ),
            (
                serde_json::json!({ "keys": ["Z"], "match": "all" }),
                KeySlot::Single("Z".to_string()),
            ),
            (
                serde_json::json!({ "keys": [], "match": "any" }),
                KeySlot::default(),
            ),
            (
                serde_json::json!({ "keys": too_many, "match": "any" }),
                KeySlot::Multi {
                    keys: (0..MAX_SLOT_KEYS)
                        .map(|index| format!("K{index}"))
                        .collect(),
                    match_mode: SlotMatch::Any,
                },
            ),
            (serde_json::json!(42), KeySlot::default()),
            (serde_json::json!(["A", "B"]), KeySlot::default()),
            (serde_json::Value::Null, KeySlot::default()),
        ];

        for (raw, expected) in cases {
            let slot: KeySlot = serde_json::from_value(raw).unwrap();
            assert_eq!(slot, expected);
        }
    }

    #[test]
    fn stat_type_wire_values_round_trip() {
        for (stat_type, wire_value) in [
            (StatType::Kps, "kps"),
            (StatType::KpsAvg, "kpsAvg"),
            (StatType::KpsMax, "kpsMax"),
            (StatType::Total, "total"),
        ] {
            let serialized = serde_json::to_value(&stat_type).unwrap();
            assert_eq!(serialized, wire_value);

            let restored: StatType = serde_json::from_value(serialized).unwrap();
            assert_eq!(restored, stat_type);
        }
    }

    // 필수 필드만 채운 최소 KeyPosition JSON. 시각 px 필드는 호출부에서 주입
    fn key_position_json(visual_px: &str) -> String {
        format!(
            r##"{{
                "dx": 0.0, "dy": 0.0, "width": 60.0, "height": 60.0,
                "count": 0, "noteColor": "#FFFFFF", "noteOpacity": 80,
                {visual_px}
            }}"##
        )
    }

    // 기존 정수 저장값이 f64 필드로 그대로 역직렬화되는지 (하위 호환)
    #[test]
    fn visual_px_fields_accept_integer_json() {
        let json =
            key_position_json(r#""noteWidth": 100, "noteBorderRadius": 8, "noteGlowSize": 20"#);
        let pos: KeyPosition = serde_json::from_str(&json).unwrap();
        assert_eq!(pos.note_width, Some(100.0));
        assert_eq!(pos.note_border_radius, Some(8.0));
        assert_eq!(pos.note_glow_size, 20.0);
    }

    // 소수 저장값이 정상 역직렬화되는지
    #[test]
    fn visual_px_fields_accept_decimal_json() {
        let json = key_position_json(
            r#""noteWidth": 100.5, "noteBorderRadius": 8.5, "noteGlowSize": 20.5"#,
        );
        let pos: KeyPosition = serde_json::from_str(&json).unwrap();
        assert_eq!(pos.note_width, Some(100.5));
        assert_eq!(pos.note_border_radius, Some(8.5));
        assert_eq!(pos.note_glow_size, 20.5);
    }

    // note_glow_size 미지정 시 기본값(20.0) 적용
    #[test]
    fn note_glow_size_defaults_to_20() {
        let json = key_position_json(r#""noteWidth": null"#);
        let pos: KeyPosition = serde_json::from_str(&json).unwrap();
        assert_eq!(pos.note_glow_size, 20.0);
        assert_eq!(pos.note_width, None);
    }

    #[test]
    fn gradient_opacity_fields_survive_serde_round_trip() {
        let json = key_position_json(
            r#""noteOpacityTop": 91, "noteOpacityBottom": 37,
                "noteGlowOpacityTop": 64, "noteGlowOpacityBottom": 18"#,
        );
        let position: KeyPosition = serde_json::from_str(&json).unwrap();

        assert_eq!(position.note_opacity_top, Some(91));
        assert_eq!(position.note_opacity_bottom, Some(37));
        assert_eq!(position.note_glow_opacity_top, Some(64));
        assert_eq!(position.note_glow_opacity_bottom, Some(18));

        let serialized = serde_json::to_value(&position).unwrap();
        assert_eq!(serialized["noteOpacityTop"], 91);
        assert_eq!(serialized["noteOpacityBottom"], 37);
        assert_eq!(serialized["noteGlowOpacityTop"], 64);
        assert_eq!(serialized["noteGlowOpacityBottom"], 18);

        let restored: KeyPosition = serde_json::from_value(serialized).unwrap();
        assert_eq!(restored, position);
    }

    #[test]
    fn note_settings_1_3_format_still_preserves_every_field() {
        // 1.3 시절 noteSettings 전체 필드 실형식
        let fixture = r#"{
            "borderRadius": 9,
            "speed": 456,
            "trackHeight": 222,
            "reverse": true,
            "fadePosition": "bottom",
            "delayedNoteEnabled": true,
            "shortNoteThresholdMs": 73,
            "shortNoteMinLengthPx": 41
        }"#;
        let settings: NoteSettings = serde_json::from_str(fixture).unwrap();

        assert_eq!(settings.border_radius, Some(9));
        assert_eq!(settings.speed, 456);
        assert_eq!(settings.track_height, 222);
        assert!(settings.reverse);
        assert_eq!(settings.fade_position, FadePosition::Bottom);
        assert!(settings.delayed_note_enabled);
        assert_eq!(settings.short_note_threshold_ms, 73);
        assert_eq!(settings.short_note_min_length_px, 41);
    }

    #[test]
    fn key_position_1_0_missing_visual_fields_uses_legacy_defaults() {
        let position: KeyPosition =
            serde_json::from_str(r#"{"dx":777,"dy":12,"width":60,"count":42}"#).unwrap();

        assert_eq!(position.dx, 777.0);
        assert_eq!(position.count, 42);
        assert_eq!(position.height, 60.0);
        assert_eq!(position.note_color, NoteColor::Solid("#FFFFFF".to_string()));
        assert_eq!(position.note_opacity, 90);
        assert_eq!(position.shadow, None);
        assert_eq!(position.active_shadow, None);
    }

    #[test]
    fn key_position_visual_effects_round_trip_without_rewriting_missing_defaults() {
        let fixture = serde_json::json!({
            "dx": 0,
            "dy": 0,
            "width": 60,
            "count": 0,
            "shadow": {
                "enabled": true,
                "color": "rgba(10, 20, 30, 0.45)",
                "offsetX": -2.0,
                "offsetY": 7.0,
                "blur": 18.0
            },
            "activeShadow": {
                "enabled": false,
                "color": "rgba(0, 0, 0, 0.32)",
                "offsetX": 0.0,
                "offsetY": 3.0,
                "blur": 8.0
            }
        });

        let position: KeyPosition = serde_json::from_value(fixture.clone()).unwrap();
        let serialized = serde_json::to_value(position).unwrap();

        assert_eq!(serialized.get("shadow"), fixture.get("shadow"));
        assert_eq!(serialized.get("activeShadow"), fixture.get("activeShadow"));
    }

    #[test]
    fn gradient_spec_tolerates_legacy_shape_and_serializes_canonically() {
        let gradient: GradientSpec = serde_json::from_value(serde_json::json!({
            "type": "linear",
            "stops": [
                { "color": "c9", "pos": 1.4 },
                { "color": "c8", "pos": 0.8 },
                { "color": "c7", "pos": 0.7 },
                { "color": "c6", "pos": 0.6 },
                { "color": "c5", "pos": 0.5 },
                { "color": "c4", "pos": 0.4 },
                { "color": "c3", "pos": 0.3 },
                { "color": "c2", "pos": 0.2 },
                { "color": "c1", "pos": 0.1 },
                { "color": "c0", "pos": -0.2 }
            ]
        }))
        .unwrap();

        assert_eq!(gradient.angle, 90.0);
        assert_eq!(gradient.stops.len(), 8);
        assert_eq!(gradient.stops.first().unwrap().color, "c0");
        assert_eq!(gradient.stops.first().unwrap().pos, 0.0);
        assert_eq!(gradient.stops.last().unwrap().color, "c7");

        let canonical = serde_json::to_value(&gradient).unwrap();
        assert_eq!(canonical["angle"], 90.0);
        assert_eq!(canonical["stops"].as_array().unwrap().len(), 8);
        assert!(canonical.get("type").is_none());

        let restored: GradientSpec = serde_json::from_value(canonical.clone()).unwrap();
        assert_eq!(serde_json::to_value(restored).unwrap(), canonical);
    }

    #[test]
    fn gradient_spec_rejects_fewer_than_two_stops() {
        let error = serde_json::from_value::<GradientSpec>(serde_json::json!({
            "angle": 90,
            "stops": [{ "color": "#FFFFFF", "pos": 0 }]
        }))
        .unwrap_err();

        assert!(error.to_string().contains("at least two stops"));
    }

    #[test]
    fn gradient_spec_rejects_null_angle_but_preserves_stop_alpha_strings() {
        let error = serde_json::from_value::<GradientSpec>(serde_json::json!({
            "angle": null,
            "stops": [
                { "color": "rgba(1,2,3,0)", "pos": 0 },
                { "color": "rgba(1,2,3,1)", "pos": 1 }
            ]
        }))
        .unwrap_err();
        assert!(error.to_string().contains("invalid gradient angle"));

        let gradient: GradientSpec = serde_json::from_value(serde_json::json!({
            "stops": [
                { "color": "rgba(1,2,3,0)", "pos": 0 },
                { "color": "rgba(1,2,3,0.5)", "pos": 0.5 },
                { "color": "rgba(1,2,3,1)", "pos": 1 }
            ]
        }))
        .unwrap();
        assert_eq!(
            gradient
                .stops
                .iter()
                .map(|stop| stop.color.as_str())
                .collect::<Vec<_>>(),
            ["rgba(1,2,3,0)", "rgba(1,2,3,0.5)", "rgba(1,2,3,1)"]
        );
    }

    #[test]
    fn counter_gradient_escape_differs_from_every_legacy_snapshot_literal() {
        let legacy_literals = [
            "#FFFFFF",
            "#000000",
            "rgba(121, 121, 121, 0.9)",
            "transparent",
        ];
        let visual_pairs = [
            ("#FFFFFF", "rgba(255,255,255,1)"),
            ("#000000", "rgba(0,0,0,1)"),
            ("rgba(121, 121, 121, 0.9)", "rgba(121,121,121,0.9)"),
        ];

        for (input, expected) in visual_pairs {
            let escaped = compact_canonical_rgba(input);
            assert_eq!(escaped, expected);
            assert!(legacy_literals.iter().all(|literal| escaped != *literal));
        }
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PreFeatureKeyPosition {
        background_color: Option<String>,
        counter: PreFeatureCounterSettings,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PreFeatureCounterSettings {
        fill: KeyCounterColor,
        stroke: KeyCounterColor,
        placement: KeyCounterPlacement,
        align: KeyCounterAlign,
        align_mode: KeyCounterAlignMode,
        gap: u32,
        font_size: u32,
        font_weight: u32,
        font_family: Option<String>,
        font_italic: bool,
        font_underline: bool,
        font_strikethrough: bool,
    }

    impl PreFeatureCounterSettings {
        fn matches_legacy_migration_snapshot(&self) -> bool {
            let shared = matches!(self.placement, KeyCounterPlacement::Inside)
                && matches!(self.align, KeyCounterAlign::Top)
                && matches!(self.align_mode, KeyCounterAlignMode::Center)
                && self.gap == 6
                && self.font_size == 16
                && self.font_family.is_none()
                && !self.font_italic
                && !self.font_underline
                && !self.font_strikethrough;
            let oldest = self.fill.idle == "#FFFFFF"
                && self.fill.active == "#000000"
                && self.stroke.idle == "#000000"
                && self.stroke.active == "#FFFFFF"
                && self.font_weight == 400;
            let previous = self.fill.idle == "rgba(121, 121, 121, 0.9)"
                && self.fill.active == "#FFFFFF"
                && self.stroke.idle == "transparent"
                && self.stroke.active == "transparent"
                && self.font_weight == 700;
            shared && (oldest || previous)
        }
    }

    #[test]
    fn pre_feature_shadow_downgrade_ignores_gradients_without_triggering_migration() {
        for (legacy_fill, first_stop, expected_escape) in [
            ("#FFFFFF", "#FFFFFF", "rgba(255,255,255,1)"),
            (
                "rgba(121, 121, 121, 0.9)",
                "rgba(121, 121, 121, 0.9)",
                "rgba(121,121,121,0.9)",
            ),
        ] {
            let mut position: KeyPosition = serde_json::from_value(serde_json::json!({
                "dx": 0,
                "dy": 0,
                "width": 60,
                "count": 0,
                "backgroundColor": "#102030",
                "backgroundGradient": {
                    "angle": 90,
                    "stops": [
                        { "color": "#102030", "pos": 0 },
                        { "color": "#405060", "pos": 1 }
                    ]
                },
                "counter": {
                    "enabled": true,
                    "placement": "inside",
                    "align": "top",
                    "alignMode": "center",
                    "fill": {
                        "idle": legacy_fill,
                        "active": if legacy_fill == "#FFFFFF" { "#000000" } else { "#FFFFFF" }
                    },
                    "fillIdleGradient": {
                        "angle": 90,
                        "stops": [
                            { "color": first_stop, "pos": 0 },
                            { "color": "#654321", "pos": 1 }
                        ]
                    },
                    "stroke": if legacy_fill == "#FFFFFF" {
                        serde_json::json!({ "idle": "#000000", "active": "#FFFFFF" })
                    } else {
                        serde_json::json!({ "idle": "transparent", "active": "transparent" })
                    },
                    "gap": 6,
                    "fontSize": 16,
                    "fontWeight": if legacy_fill == "#FFFFFF" { 400 } else { 700 },
                    "fontFamily": null,
                    "fontItalic": false,
                    "fontUnderline": false,
                    "fontStrikethrough": false
                }
            }))
            .unwrap();

            let (_, pair_repaired) = position.canonicalize_gradient_pairs();
            assert!(pair_repaired);
            assert_eq!(position.counter.fill.idle, expected_escape);
            assert!(!position.counter.migrate_legacy_defaults());

            let serialized = serde_json::to_value(&position).unwrap();
            let shadow: PreFeatureKeyPosition = serde_json::from_value(serialized).unwrap();
            assert_eq!(shadow.background_color.as_deref(), Some("#102030"));
            assert_eq!(shadow.counter.fill.idle, expected_escape);
            assert!(!shadow.counter.matches_legacy_migration_snapshot());
        }
    }

    #[test]
    fn counter_migration_without_gradients_preserves_both_legacy_upgrade_branches() {
        for snapshot in [
            serde_json::json!({
                "placement": "inside",
                "align": "top",
                "alignMode": "center",
                "fill": { "idle": "#FFFFFF", "active": "#000000" },
                "stroke": { "idle": "#000000", "active": "#FFFFFF" },
                "gap": 6,
                "fontSize": 16,
                "fontWeight": 400,
                "fontFamily": null,
                "fontItalic": false,
                "fontUnderline": false,
                "fontStrikethrough": false
            }),
            serde_json::json!({
                "placement": "inside",
                "align": "top",
                "alignMode": "center",
                "fill": {
                    "idle": "rgba(121, 121, 121, 0.9)",
                    "active": "#FFFFFF"
                },
                "stroke": { "idle": "transparent", "active": "transparent" },
                "gap": 6,
                "fontSize": 16,
                "fontWeight": 700,
                "fontFamily": null,
                "fontItalic": false,
                "fontUnderline": false,
                "fontStrikethrough": false
            }),
        ] {
            let mut counter: KeyCounterSettings = serde_json::from_value(snapshot).unwrap();

            assert!(counter.migrate_legacy_defaults());
            assert_eq!(counter, KeyCounterSettings::default());
        }
    }
}
