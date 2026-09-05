use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::{
    default_key_height, default_key_note_color, default_key_note_opacity,
    default_note_auto_y_correction, default_note_border_opacity, default_note_effect_enabled,
    default_note_glow_enabled, default_note_glow_opacity, default_note_glow_size, GradientSpec,
    ImageFit, KeyCounterSettings, NoteColor,
};

pub const POSITION_COLLECTION_FIELDS: [&str; 4] = [
    "keyPositions",
    "statPositions",
    "graphPositions",
    "knobPositions",
];

pub type KeyPositions = HashMap<String, Vec<KeyPosition>>;
pub type StatPositions = HashMap<String, Vec<StatPosition>>;
pub type GraphPositions = HashMap<String, Vec<GraphPosition>>;
pub type KnobPositions = HashMap<String, Vec<KnobPosition>>;
pub type SpritePositions = HashMap<String, Vec<ReactiveSpritePosition>>;

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

pub const SPRITE_TRANSFORM_OFFSET_MIN: f64 = -2_000.0;
pub const SPRITE_TRANSFORM_OFFSET_MAX: f64 = 2_000.0;
pub const SPRITE_TRANSFORM_ROTATION_MIN: f64 = -180.0;
pub const SPRITE_TRANSFORM_ROTATION_MAX: f64 = 180.0;
pub const SPRITE_TRANSFORM_SCALE_MIN: f64 = 0.1;
pub const SPRITE_TRANSFORM_SCALE_MAX: f64 = 10.0;
pub const SPRITE_TRANSITION_MS_MAX: u32 = 1_000;
pub const SPRITE_PRESS_DURATION_MS_MIN: u32 = 1;
pub const SPRITE_PRESS_DURATION_MS_MAX: u32 = 5_000;
pub const SPRITE_IMAGE_DIMENSION_MIN: u32 = 1;
pub const SPRITE_IMAGE_DIMENSION_MAX: u32 = 32_768;
pub const MAX_SPRITE_POSES: usize = 64;
pub const MAX_SPRITE_POSE_TRIGGERS: usize = 512;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpriteAnchor {
    pub x: f64,
    pub y: f64,
}

impl Default for SpriteAnchor {
    fn default() -> Self {
        Self { x: 0.5, y: 0.5 }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpriteTransform {
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub scale: f64,
}

impl Default for SpriteTransform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            rotation: 0.0,
            scale: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpriteImageMetrics {
    pub source: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpriteReferenceNaturalSize {
    pub source: Option<String>,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn is_renderable_image_ref(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.trim().is_empty())
}

pub(crate) trait CoupledSpriteImageReference {
    fn image_reference(&self) -> &Option<String>;
    fn image_reference_mut(&mut self) -> &mut Option<String>;
    fn coupled_source(&self) -> Option<&str>;
    fn set_coupled_source(&mut self, source: Option<&str>);
}

pub(crate) fn rewrite_coupled_sprite_image_reference<T, R>(
    target: &mut T,
    rewrite: impl FnOnce(&mut Option<String>) -> R,
) -> R
where
    T: CoupledSpriteImageReference,
{
    let original = target.image_reference().clone();
    let source_was_coupled = original.as_deref().is_some_and(|image_ref| {
        is_renderable_image_ref(Some(image_ref)) && target.coupled_source() == Some(image_ref)
    });
    let result = rewrite(target.image_reference_mut());

    if source_was_coupled {
        let rewritten = target
            .image_reference()
            .as_deref()
            .filter(|image_ref| is_renderable_image_ref(Some(image_ref)))
            .map(str::to_owned);
        target.set_coupled_source(rewritten.as_deref());
    }

    result
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SpriteActivation {
    #[default]
    WhileHeld,
    OnPress,
}

pub(crate) fn default_sprite_press_duration_ms() -> u32 {
    300
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpritePose {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pose_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub triggers: Vec<String>,
    pub transform: SpriteTransform,
    #[serde(default)]
    pub pivot: Option<SpriteAnchor>,
    #[serde(default)]
    pub image_override: Option<String>,
    #[serde(default)]
    pub image_override_metrics: Option<SpriteImageMetrics>,
}

impl SpritePose {
    pub fn normalize_triggers(&mut self) -> bool {
        let original = self.triggers.clone();
        self.triggers.sort_unstable();
        self.triggers.dedup();
        self.triggers != original
    }
}

impl CoupledSpriteImageReference for SpritePose {
    fn image_reference(&self) -> &Option<String> {
        &self.image_override
    }

    fn image_reference_mut(&mut self) -> &mut Option<String> {
        &mut self.image_override
    }

    fn coupled_source(&self) -> Option<&str> {
        self.image_override_metrics
            .as_ref()
            .map(|metrics| metrics.source.as_str())
    }

    fn set_coupled_source(&mut self, source: Option<&str>) {
        match source {
            Some(source) => {
                if let Some(metrics) = self.image_override_metrics.as_mut() {
                    metrics.source = source.to_string();
                }
            }
            None => self.image_override_metrics = None,
        }
    }
}

pub(crate) fn default_sprite_transition_ms() -> u32 {
    0
}

pub(crate) fn default_sprite_transition_easing() -> String {
    "cubic-bezier(0.4, 0, 0.2, 1)".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReactiveSpritePosition {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub dx: f64,
    pub dy: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub z_index: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default)]
    pub class_name: Option<String>,
    #[serde(default)]
    pub use_inline_styles: Option<bool>,
    #[serde(default)]
    pub base_image: Option<String>,
    #[serde(default)]
    pub reference_natural_size: Option<SpriteReferenceNaturalSize>,
    pub pivot: SpriteAnchor,
    pub idle_transform: SpriteTransform,
    #[serde(default)]
    pub poses: Vec<SpritePose>,
    #[serde(default)]
    pub activation: SpriteActivation,
    #[serde(default = "default_sprite_press_duration_ms")]
    pub press_duration_ms: u32,
    #[serde(default = "default_sprite_transition_ms")]
    pub transition_ms: u32,
    #[serde(default = "default_sprite_transition_easing")]
    pub transition_easing: String,
}

impl Default for ReactiveSpritePosition {
    fn default() -> Self {
        Self {
            id: String::new(),
            dx: 0.0,
            dy: 0.0,
            width: 200.0,
            height: 200.0,
            hidden: false,
            z_index: None,
            layer_name: None,
            group_id: None,
            class_name: None,
            use_inline_styles: None,
            base_image: None,
            reference_natural_size: None,
            pivot: SpriteAnchor::default(),
            idle_transform: SpriteTransform::default(),
            poses: Vec::new(),
            activation: SpriteActivation::default(),
            press_duration_ms: default_sprite_press_duration_ms(),
            transition_ms: default_sprite_transition_ms(),
            transition_easing: default_sprite_transition_easing(),
        }
    }
}

impl CoupledSpriteImageReference for ReactiveSpritePosition {
    fn image_reference(&self) -> &Option<String> {
        &self.base_image
    }

    fn image_reference_mut(&mut self) -> &mut Option<String> {
        &mut self.base_image
    }

    fn coupled_source(&self) -> Option<&str> {
        self.reference_natural_size
            .as_ref()
            .and_then(|reference| reference.source.as_deref())
    }

    fn set_coupled_source(&mut self, source: Option<&str>) {
        if let Some(reference) = self.reference_natural_size.as_mut() {
            reference.source = source.map(str::to_owned);
        }
    }
}

pub(super) fn default_true() -> bool {
    true
}
