use serde::de::Error as DeError;
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

pub type KeyMappings = HashMap<String, Vec<String>>;
pub type KeyPositions = HashMap<String, Vec<KeyPosition>>;
pub type KeyCounters = HashMap<String, HashMap<String, u32>>;
pub type StatPositions = HashMap<String, Vec<StatPosition>>;
pub type GraphPositions = HashMap<String, Vec<GraphPosition>>;

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
pub struct FontSettings {
    #[serde(default)]
    pub custom_fonts: Vec<CustomFont>,
}

impl Default for FontSettings {
    fn default() -> Self {
        Self {
            custom_fonts: Vec::new(),
        }
    }
}

// Serialize as:
// - Solid: JSON string (e.g., "#FF00FF")
// - Gradient: object with explicit type { type: "gradient", top, bottom }
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

// Deserialize accepts both shapes:
// - string => Solid
// - object with { type: "gradient", top, bottom } => Gradient
// - object with { top, bottom } (no type) => Gradient (backward compatibility)
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
pub struct KeyPosition {
    pub dx: f64,
    pub dy: f64,
    pub width: f64,
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
    /// 키별 사운드 볼륨 (0~100, 기본값 100)
    #[serde(default)]
    pub sound_volume: Option<f64>,
    #[serde(default)]
    pub active_transparent: bool,
    #[serde(default)]
    pub idle_transparent: bool,
    pub count: u32,
    pub note_color: NoteColor,
    pub note_opacity: u32,
    #[serde(default)]
    pub note_border_radius: Option<u32>,
    /// 노트 넓이(px). None이면 키 width를 사용(자동).
    #[serde(default)]
    pub note_width: Option<u32>,
    #[serde(default = "default_note_effect_enabled")]
    pub note_effect_enabled: bool,
    #[serde(default = "default_note_glow_enabled")]
    pub note_glow_enabled: bool,
    #[serde(default = "default_note_glow_size")]
    pub note_glow_size: u32,
    #[serde(default = "default_note_glow_opacity")]
    pub note_glow_opacity: u32,
    #[serde(default)]
    pub note_glow_color: Option<NoteColor>,
    #[serde(default = "default_note_auto_y_correction")]
    pub note_auto_y_correction: bool,
    #[serde(default)]
    pub class_name: Option<String>,
    #[serde(default)]
    pub z_index: Option<i32>,
    #[serde(default)]
    pub counter: KeyCounterSettings,
    // 스타일 관련 속성들
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub active_background_color: Option<String>,
    #[serde(default)]
    pub border_color: Option<String>,
    #[serde(default)]
    pub active_border_color: Option<String>,
    #[serde(default)]
    pub border_width: Option<f64>,
    #[serde(default)]
    pub border_radius: Option<f64>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StatType {
    Kps,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum KeyCounterPlacement {
    Inside,
    Outside,
}

impl Default for KeyCounterPlacement {
    fn default() -> Self {
        KeyCounterPlacement::Inside
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum KeyCounterAlign {
    Top,
    Bottom,
    Left,
    Right,
}

impl Default for KeyCounterAlign {
    fn default() -> Self {
        KeyCounterAlign::Top
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum KeyCounterAlignMode {
    Center,
    Between,
}

impl Default for KeyCounterAlignMode {
    fn default() -> Self {
        KeyCounterAlignMode::Center
    }
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
            // Match renderer defaults (src/types/keys.ts)
            idle: "rgba(121, 121, 121, 0.9)".to_string(),
            active: "#FFFFFF".to_string(),
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
}

fn default_stroke_color() -> KeyCounterColor {
    KeyCounterColor {
        // No outline by default (match renderer defaults)
        idle: "transparent".to_string(),
        active: "transparent".to_string(),
    }
}

impl Default for KeyCounterSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            placement: KeyCounterPlacement::Inside,
            align: KeyCounterAlign::Top,
            align_mode: KeyCounterAlignMode::Center,
            fill: KeyCounterColor::default(),
            stroke: default_stroke_color(),
            gap: default_gap(),
            font_size: default_counter_font_size(),
            font_weight: default_counter_font_weight(),
            font_family: None,
            font_italic: false,
            font_underline: false,
            font_strikethrough: false,
        }
    }
}

impl KeyCounterSettings {
    /// Migrate legacy defaults that were previously serialized into store.json.
    /// This keeps existing user customizations intact, while fixing the old default
    /// active fill/stroke values (black text / outlined) that diverged from the renderer.
    pub fn migrate_legacy_defaults(&mut self) -> bool {
        let looks_like_legacy_default = self.fill.idle == "#FFFFFF"
            && self.fill.active == "#000000"
            && self.stroke.idle == "#000000"
            && self.stroke.active == "#FFFFFF"
            && self.gap == default_gap()
            && self.font_size == default_counter_font_size()
            && self.font_weight == 400
            && self.font_family.is_none()
            && !self.font_italic
            && !self.font_underline
            && !self.font_strikethrough;

        if !looks_like_legacy_default {
            return false;
        }

        self.fill = KeyCounterColor::default();
        self.stroke = default_stroke_color();
        self.font_weight = default_counter_font_weight();
        true
    }
}

fn default_gap() -> u32 {
    6
}
fn default_counter_font_size() -> u32 {
    16
}
fn default_counter_font_weight() -> u32 {
    700
}

fn default_counter_enabled() -> bool {
    true
}
fn default_note_effect_enabled() -> bool {
    true
}
fn default_note_glow_enabled() -> bool {
    false
}
fn default_note_glow_size() -> u32 {
    20
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSettings {
    // Legacy: global note rounding (migrated to per-key noteBorderRadius).
    #[serde(default, skip_serializing)]
    pub border_radius: Option<u32>,
    #[serde(default = "default_note_frame_limit")]
    pub frame_limit: u32,
    pub speed: u32,
    pub track_height: u32,
    pub reverse: bool,
    pub fade_position: FadePosition,
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
}

/// 이미지 맞춤 설정 (CSS object-fit과 동일)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ImageFit {
    Cover,
    Contain,
    Fill,
    None,
}

impl Default for ImageFit {
    fn default() -> Self {
        ImageFit::Cover
    }
}

impl Default for NoteSettings {
    fn default() -> Self {
        Self {
            border_radius: None,
            frame_limit: default_note_frame_limit(),
            speed: 180,
            track_height: 150,
            reverse: false,
            fade_position: FadePosition::Auto,
            delayed_note_enabled: false,
            short_note_threshold_ms: 50,
            short_note_min_length_px: 30,
            key_display_delay_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomCss {
    pub path: Option<String>,
    pub content: String,
}

impl Default for CustomCss {
    fn default() -> Self {
        Self {
            path: None,
            content: String::new(),
        }
    }
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
pub struct CustomJs {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub plugins: Vec<JsPlugin>,
}

impl Default for CustomJs {
    fn default() -> Self {
        Self {
            path: None,
            content: String::new(),
            plugins: Vec::new(),
        }
    }
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
pub enum OverlayResizeAnchor {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
    FixedPosition,
}

impl Default for OverlayResizeAnchor {
    fn default() -> Self {
        OverlayResizeAnchor::TopLeft
    }
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
}

fn default_true() -> bool {
    true
}

fn default_auto_update_enabled() -> bool {
    true
}

fn default_grid_snap_size() -> u32 {
    5
}

impl Default for GridSettings {
    fn default() -> Self {
        Self {
            alignment_guides: true,
            spacing_guides: true,
            size_match_guides: true,
            minimap_enabled: true,
            grid_snap_size: default_grid_snap_size(),
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
    pub keys: KeyMappings,
    #[serde(default)]
    pub key_positions: KeyPositions,
    #[serde(default)]
    pub stat_positions: StatPositions,
    #[serde(default)]
    pub graph_positions: GraphPositions,
    #[serde(default)]
    pub layer_groups: LayerGroups,
    #[serde(default)]
    pub key_counters: KeyCounters,
    pub background_color: String,
    pub use_custom_css: bool,
    #[serde(default)]
    pub custom_css: CustomCss,
    #[serde(default)]
    pub font_settings: FontSettings,
    /// 탭별 CSS 오버라이드 (전역 CSS 대신 사용)
    #[serde(default)]
    pub tab_css_overrides: TabCssOverrides,
    #[serde(default)]
    pub use_custom_js: bool,
    #[serde(default)]
    pub custom_js: CustomJs,
    pub overlay_resize_anchor: OverlayResizeAnchor,
    pub overlay_bounds: Option<OverlayBounds>,
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
            keys: KeyMappings::new(),
            key_positions: KeyPositions::new(),
            stat_positions: StatPositions::new(),
            graph_positions: GraphPositions::new(),
            layer_groups: LayerGroups::new(),
            key_counters: KeyCounters::new(),
            background_color: "transparent".to_string(),
            use_custom_css: false,
            custom_css: CustomCss::default(),
            font_settings: FontSettings::default(),
            tab_css_overrides: TabCssOverrides::new(),
            use_custom_js: false,
            custom_js: CustomJs::default(),
            overlay_resize_anchor: OverlayResizeAnchor::TopLeft,
            overlay_bounds: None,
            overlay_last_content_top_offset: None,
            overlay_bounds_are_logical: false,
            key_counter_enabled: false,
            grid_settings: GridSettings::default(),
            shortcuts: ShortcutsState::default(),
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
    // Windows/Linux: Ctrl+Shift+O
    // macOS: Cmd+Shift+O
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
    pub keys: KeyMappings,
    pub positions: KeyPositions,
    pub stat_positions: StatPositions,
    pub graph_positions: GraphPositions,
    pub custom_tabs: Vec<CustomTab>,
    pub selected_key_type: String,
    pub current_mode: String,
    pub overlay: BootstrapOverlayState,
    pub key_counters: KeyCounters,
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
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteSettingsPatch {
    pub frame_limit: Option<u32>,
    pub speed: Option<u32>,
    pub track_height: Option<u32>,
    pub reverse: Option<bool>,
    pub fade_position: Option<FadePosition>,
    pub delayed_note_enabled: Option<bool>,
    pub short_note_threshold_ms: Option<u32>,
    pub short_note_min_length_px: Option<u32>,
    pub key_display_delay_ms: Option<u32>,
}

impl Default for NoteSettingsPatch {
    fn default() -> Self {
        Self {
            frame_limit: None,
            speed: None,
            track_height: None,
            reverse: None,
            fade_position: None,
            delayed_note_enabled: None,
            short_note_threshold_ms: None,
            short_note_min_length_px: None,
            key_display_delay_ms: None,
        }
    }
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
}
