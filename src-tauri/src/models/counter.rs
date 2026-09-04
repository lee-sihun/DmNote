use serde::{Deserialize, Serialize};

use super::GradientSpec;

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

pub(super) fn default_gap() -> u32 {
    4
}
pub(super) fn default_counter_font_size() -> u32 {
    11
}
pub(super) fn default_counter_font_weight() -> u32 {
    500
}

fn default_counter_enabled() -> bool {
    true
}
