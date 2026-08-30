pub mod editor;
pub mod gesture;
pub mod obs;
pub mod plugin;

mod key_position_normalization;
mod shortcuts;

pub use editor::*;
pub use gesture::*;
pub use plugin::*;
pub use shortcuts::*;

pub(crate) use key_position_normalization::{
    compact_canonical_rgba, default_missing_note_gradient_multipliers,
    note_border_representative_hex, note_gradient_shadow, scrub_removed_text_outline_fields,
    NoteGradientShadow,
};

use serde::de::Error as DeError;
use serde::ser::{Error as SerError, SerializeMap};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use uuid::Uuid;

pub const MAX_SLOT_KEYS: usize = 8;
pub const POSITION_COLLECTION_FIELDS: [&str; 4] = [
    "keyPositions",
    "statPositions",
    "graphPositions",
    "knobPositions",
];

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

pub const IMAGE_TRANSFORM_OFFSET_MIN: f64 = -500.0;
pub const IMAGE_TRANSFORM_OFFSET_MAX: f64 = 500.0;
pub const IMAGE_TRANSFORM_ROTATION_MIN: f64 = -180.0;
pub const IMAGE_TRANSFORM_ROTATION_MAX: f64 = 180.0;
pub const IMAGE_TRANSFORM_SCALE_MIN: f64 = 0.1;
pub const IMAGE_TRANSFORM_SCALE_MAX: f64 = 10.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageMode {
    Replace,
    Overlay,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTransform {
    pub offset_x: f64,
    pub offset_y: f64,
    pub rotation: f64,
    pub scale: f64,
}

impl Default for ImageTransform {
    fn default() -> Self {
        Self {
            offset_x: 0.0,
            offset_y: 0.0,
            rotation: 0.0,
            scale: 1.0,
        }
    }
}

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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_gradient: Option<GradientSpec>,
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
    #[serde(default)]
    pub note_glow_sync_paint: bool,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_glow_gradient: Option<GradientSpec>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_border_gradient: Option<GradientSpec>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_gradient: Option<GradientSpec>,
    #[serde(default)]
    pub active_font_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_font_gradient: Option<GradientSpec>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_mode: Option<ImageMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle_image_transform: Option<ImageTransform>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_image_transform: Option<ImageTransform>,
    /// 인라인 스타일 우선 여부 (true: 속성 패널 스타일 우선, false: 커스텀 CSS 우선)
    #[serde(default)]
    pub use_inline_styles: Option<bool>,
    /// 키에 표시할 커스텀 텍스트 (None이면 기본 키 이름 표시)
    #[serde(default)]
    pub display_text: Option<String>,
    /// 글꼴 굵기 (CSS font-weight 값, 예: 400, 700)
    #[serde(default)]
    pub font_weight: Option<u32>,
    /// 선택 굵기에 +300을 적용하는 Bold 토글 - None은 직렬화하지 않는다
    /// (IPC에서 null로 나가면 프론트 스키마가 거부해 설정 전체가 기본값으로 떨어진다)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_bold: Option<bool>,
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
            id: String::new(),
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
            note_gradient: None,
            note_opacity: default_key_note_opacity(),
            note_opacity_top: None,
            note_opacity_bottom: None,
            note_border_radius: None,
            note_width: None,
            note_alignment: NoteAlignment::default(),
            note_effect_enabled: default_note_effect_enabled(),
            note_glow_enabled: default_note_glow_enabled(),
            note_glow_sync_paint: false,
            note_glow_size: default_note_glow_size(),
            note_glow_opacity: default_note_glow_opacity(),
            note_glow_opacity_top: None,
            note_glow_opacity_bottom: None,
            note_glow_color: None,
            note_glow_gradient: None,
            note_auto_y_correction: default_note_auto_y_correction(),
            note_offset_x: None,
            note_offset_y: None,
            note_border_width: None,
            note_border_color: None,
            note_border_gradient: None,
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
            font_gradient: None,
            active_font_color: None,
            active_font_gradient: None,
            graph_animation_enabled: None,
            font_family: None,
            image_fit: None,
            idle_image_fit: None,
            active_image_fit: None,
            image_mode: None,
            idle_image_transform: None,
            active_image_transform: None,
            use_inline_styles: None,
            display_text: None,
            font_weight: Some(400),
            font_bold: Some(true),
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
    #[serde(default = "default_gap")]
    pub gap: u32,
    #[serde(default = "default_counter_font_size")]
    pub font_size: u32,
    #[serde(default = "default_counter_font_weight")]
    pub font_weight: u32,
    /// 선택 굵기에 +300을 적용하는 Bold 토글 - None은 직렬화하지 않는다
    /// (IPC에서 null로 나가면 프론트 스키마가 거부해 설정 전체가 기본값으로 떨어진다)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_bold: Option<bool>,
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
            gap: default_gap(),
            font_size: default_counter_font_size(),
            font_weight: default_counter_font_weight(),
            font_bold: Some(false),
            font_family: None,
            font_italic: false,
            font_underline: false,
            font_strikethrough: false,
            animation: KeyCounterAnimationSettings::default(),
        }
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
    10.0
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
    /// 그리드 스냅 크기 (0-10px, 0은 끄기)
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
    /// 분리 패널 창 존재 여부 (재시작 복원용)
    #[serde(default)]
    pub panel_detached: bool,
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
        // 설정 기본값의 단일 원천은 AppStoreData::default, 빈 store 사영으로 유도
        AppStoreData::default().settings_state()
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
mod tests;
