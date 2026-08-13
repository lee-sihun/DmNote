use serde::{Deserialize, Serialize};

use super::{
    AppStoreData, GradientSpec, GradientStop, GraphPosition, GraphPositions, GraphType, ImageFit,
    KeyCounterAlign, KeyCounterAlignMode, KeyCounterPlacement, KeyCounters, KeyMappings,
    KeyPosition, KeyPositions, KeySlot, KnobPosition, KnobPositions, LayerGroups, NoteAlignment,
    SlotMatch, StatPosition, StatPositions, StatType,
};

pub const EDITOR_SCHEMA_VERSION: u16 = 1;
pub const EDITOR_COMMIT_SCHEMA_VERSION_V2: u16 = 2;
pub const EDITOR_OPS_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorField {
    Keys,
    KeyPositions,
    StatPositions,
    GraphPositions,
    KnobPositions,
    LayerGroups,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorDocumentV1 {
    pub schema_version: u16,
    pub keys: KeyMappings,
    pub key_positions: KeyPositions,
    pub stat_positions: StatPositions,
    pub graph_positions: GraphPositions,
    pub knob_positions: KnobPositions,
    pub layer_groups: LayerGroups,
}

impl EditorDocumentV1 {
    pub fn from_store(store: &AppStoreData) -> Self {
        Self {
            schema_version: EDITOR_SCHEMA_VERSION,
            keys: store.keys.clone(),
            key_positions: store.key_positions.clone(),
            stat_positions: store.stat_positions.clone(),
            graph_positions: store.graph_positions.clone(),
            knob_positions: store.knob_positions.clone(),
            layer_groups: store.layer_groups.clone(),
        }
    }

    pub fn apply_to_store(&self, store: &mut AppStoreData) {
        store.keys = self.keys.clone();
        store.key_positions = self.key_positions.clone();
        store.stat_positions = self.stat_positions.clone();
        store.graph_positions = self.graph_positions.clone();
        store.knob_positions = self.knob_positions.clone();
        store.layer_groups = self.layer_groups.clone();
    }

    pub fn apply_patch(&mut self, patch: &EditorPatchV1) {
        if let Some(value) = patch.keys.as_ref() {
            self.keys = value.clone();
        }
        if let Some(value) = patch.key_positions.as_ref() {
            self.key_positions = value.clone();
        }
        if let Some(value) = patch.stat_positions.as_ref() {
            self.stat_positions = value.clone();
        }
        if let Some(value) = patch.graph_positions.as_ref() {
            self.graph_positions = value.clone();
        }
        if let Some(value) = patch.knob_positions.as_ref() {
            self.knob_positions = value.clone();
        }
        if let Some(value) = patch.layer_groups.as_ref() {
            self.layer_groups = value.clone();
        }
    }

    pub fn changed_fields(&self, next: &Self) -> Vec<EditorField> {
        let mut fields = Vec::new();
        if self.keys != next.keys {
            fields.push(EditorField::Keys);
        }
        if self.key_positions != next.key_positions {
            fields.push(EditorField::KeyPositions);
        }
        if self.stat_positions != next.stat_positions {
            fields.push(EditorField::StatPositions);
        }
        if self.graph_positions != next.graph_positions {
            fields.push(EditorField::GraphPositions);
        }
        if self.knob_positions != next.knob_positions {
            fields.push(EditorField::KnobPositions);
        }
        if self.layer_groups != next.layer_groups {
            fields.push(EditorField::LayerGroups);
        }
        fields
    }

    pub fn patch_for_fields(&self, fields: &[EditorField]) -> EditorPatchV1 {
        let mut patch = EditorPatchV1::default();
        for field in fields {
            match field {
                EditorField::Keys => patch.keys = Some(self.keys.clone()),
                EditorField::KeyPositions => {
                    patch.key_positions = Some(self.key_positions.clone());
                }
                EditorField::StatPositions => {
                    patch.stat_positions = Some(self.stat_positions.clone());
                }
                EditorField::GraphPositions => {
                    patch.graph_positions = Some(self.graph_positions.clone());
                }
                EditorField::KnobPositions => {
                    patch.knob_positions = Some(self.knob_positions.clone());
                }
                EditorField::LayerGroups => {
                    patch.layer_groups = Some(self.layer_groups.clone());
                }
            }
        }
        patch
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorPatchV1 {
    pub schema_version: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keys: Option<KeyMappings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_positions: Option<KeyPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stat_positions: Option<StatPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph_positions: Option<GraphPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knob_positions: Option<KnobPositions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_groups: Option<LayerGroups>,
}

impl Default for EditorPatchV1 {
    fn default() -> Self {
        Self {
            schema_version: EDITOR_SCHEMA_VERSION,
            keys: None,
            key_positions: None,
            stat_positions: None,
            graph_positions: None,
            knob_positions: None,
            layer_groups: None,
        }
    }
}

impl EditorPatchV1 {
    pub fn includes(&self, field: EditorField) -> bool {
        match field {
            EditorField::Keys => self.keys.is_some(),
            EditorField::KeyPositions => self.key_positions.is_some(),
            EditorField::StatPositions => self.stat_positions.is_some(),
            EditorField::GraphPositions => self.graph_positions.is_some(),
            EditorField::KnobPositions => self.knob_positions.is_some(),
            EditorField::LayerGroups => self.layer_groups.is_some(),
        }
    }

    pub fn included_fields(&self) -> Vec<EditorField> {
        [
            EditorField::Keys,
            EditorField::KeyPositions,
            EditorField::StatPositions,
            EditorField::GraphPositions,
            EditorField::KnobPositions,
            EditorField::LayerGroups,
        ]
        .into_iter()
        .filter(|field| self.includes(*field))
        .collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorElementTypeV1 {
    Key,
    Stat,
    Graph,
    Knob,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorBoundsV1 {
    pub dx: f64,
    pub dy: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EditorElementPropertyPatchV1 {
    Hidden(EditorHiddenPropertyPatchV1),
    LayerName(EditorLayerNamePropertyPatchV1),
    GraphType(EditorGraphTypePropertyPatchV1),
    GraphColor(EditorGraphColorPropertyPatchV1),
    ShowAvgLine(EditorShowAvgLinePropertyPatchV1),
    GraphAnimationEnabled(EditorGraphAnimationEnabledPropertyPatchV1),
    GraphSpeed(EditorGraphSpeedPropertyPatchV1),
    Reverse(EditorReversePropertyPatchV1),
    Sensitivity(EditorSensitivityPropertyPatchV1),
    AxisId(EditorAxisIdPropertyPatchV1),
    UseInlineStyles(EditorUseInlineStylesPropertyPatchV1),
    FontWeight(EditorFontWeightPropertyPatchV1),
    FontItalic(EditorFontItalicPropertyPatchV1),
    FontUnderline(EditorFontUnderlinePropertyPatchV1),
    FontStrikethrough(EditorFontStrikethroughPropertyPatchV1),
    FontFamily(EditorFontFamilyPropertyPatchV1),
    DisplayText(EditorDisplayTextPropertyPatchV1),
    ClassName(EditorClassNamePropertyPatchV1),
    Shadow(EditorShadowPropertyPatchV1),
    ActiveShadow(EditorActiveShadowPropertyPatchV1),
    ShadowEnabled(EditorShadowEnabledPropertyPatchV1),
    BackgroundPaint(EditorBackgroundPaintPropertyPatchV1),
    ActiveBackgroundPaint(EditorActiveBackgroundPaintPropertyPatchV1),
    BorderPaint(EditorBorderPaintPropertyPatchV1),
    ActiveBorderPaint(EditorActiveBorderPaintPropertyPatchV1),
    BorderWidth(EditorBorderWidthPropertyPatchV1),
    BorderRadius(EditorBorderRadiusPropertyPatchV1),
    FontSize(EditorFontSizePropertyPatchV1),
    InactiveImage(EditorInactiveImagePropertyPatchV1),
    ActiveImage(EditorActiveImagePropertyPatchV1),
    IdleTransparent(EditorIdleTransparentPropertyPatchV1),
    ActiveTransparent(EditorActiveTransparentPropertyPatchV1),
    IdleImageFit(EditorIdleImageFitPropertyPatchV1),
    ActiveImageFit(EditorActiveImageFitPropertyPatchV1),
    SoundPath(EditorSoundPathPropertyPatchV1),
    SoundEnabled(EditorSoundEnabledPropertyPatchV1),
    SoundVolume(EditorSoundVolumePropertyPatchV1),
    CounterEnabled(EditorCounterEnabledPropertyPatchV1),
    CounterAnimationEnabled(EditorCounterAnimationEnabledPropertyPatchV1),
    CounterPlacement(EditorCounterPlacementPropertyPatchV1),
    CounterAlign(EditorCounterAlignPropertyPatchV1),
    CounterAlignMode(EditorCounterAlignModePropertyPatchV1),
    CounterGap(EditorCounterGapPropertyPatchV1),
    CounterFontSize(EditorCounterFontSizePropertyPatchV1),
    CounterFontWeight(EditorCounterFontWeightPropertyPatchV1),
    CounterFontItalic(EditorCounterFontItalicPropertyPatchV1),
    CounterFontUnderline(EditorCounterFontUnderlinePropertyPatchV1),
    CounterFontStrikethrough(EditorCounterFontStrikethroughPropertyPatchV1),
    CounterFontFamily(EditorCounterFontFamilyPropertyPatchV1),
    CounterStrokeIdle(EditorCounterStrokeIdlePropertyPatchV1),
    CounterStrokeActive(EditorCounterStrokeActivePropertyPatchV1),
    CounterAnimationPreset(EditorCounterAnimationPresetPropertyPatchV1),
    StatType(EditorStatTypePropertyPatchV1),
    NoteEffectEnabled(EditorNoteEffectEnabledPropertyPatchV1),
    NoteGlowEnabled(EditorNoteGlowEnabledPropertyPatchV1),
    NoteGlowSize(EditorNoteGlowSizePropertyPatchV1),
    NoteOffsetX(EditorNoteOffsetXPropertyPatchV1),
    NoteOffsetY(EditorNoteOffsetYPropertyPatchV1),
    NoteWidth(EditorNoteWidthPropertyPatchV1),
    NoteBorderWidth(EditorNoteBorderWidthPropertyPatchV1),
    NoteBorderRadius(EditorNoteBorderRadiusPropertyPatchV1),
    NoteAutoYCorrection(EditorNoteAutoYCorrectionPropertyPatchV1),
    NoteAlignment(EditorNoteAlignmentPropertyPatchV1),
    NoteBorderSide(EditorNoteBorderSidePropertyPatchV1),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorHiddenPropertyPatchV1 {
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorLayerNamePropertyPatchV1 {
    #[serde(deserialize_with = "deserialize_required_nullable_string")]
    pub layer_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorGraphTypePropertyPatchV1 {
    pub graph_type: GraphType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorGraphColorPropertyPatchV1 {
    pub graph_color: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorShowAvgLinePropertyPatchV1 {
    pub show_avg_line: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorGraphAnimationEnabledPropertyPatchV1 {
    pub graph_animation_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorGraphSpeedPropertyPatchV1 {
    pub graph_speed: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorReversePropertyPatchV1 {
    pub reverse: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorSensitivityPropertyPatchV1 {
    pub sensitivity: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorAxisIdPropertyPatchV1 {
    pub axis_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorUseInlineStylesPropertyPatchV1 {
    pub use_inline_styles: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFontWeightPropertyPatchV1 {
    pub font_weight: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFontItalicPropertyPatchV1 {
    pub font_italic: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFontUnderlinePropertyPatchV1 {
    pub font_underline: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFontStrikethroughPropertyPatchV1 {
    pub font_strikethrough: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFontFamilyPropertyPatchV1 {
    pub font_family: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorDisplayTextPropertyPatchV1 {
    pub display_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorClassNamePropertyPatchV1 {
    pub class_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorShadowPropertyPatchV1 {
    pub shadow: EditorShadowLeafPatchV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorActiveShadowPropertyPatchV1 {
    pub active_shadow: EditorShadowLeafPatchV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorShadowEnabledPropertyPatchV1 {
    pub shadow_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EditorShadowLeafPatchV1 {
    Color(EditorShadowColorLeafPatchV1),
    OffsetX(EditorShadowOffsetXLeafPatchV1),
    OffsetY(EditorShadowOffsetYLeafPatchV1),
    Blur(EditorShadowBlurLeafPatchV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorShadowColorLeafPatchV1 {
    pub color: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorShadowOffsetXLeafPatchV1 {
    pub offset_x: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorShadowOffsetYLeafPatchV1 {
    pub offset_y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorShadowBlurLeafPatchV1 {
    pub blur: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorBackgroundPaintPropertyPatchV1 {
    pub background_paint: EditorPaintDescriptorV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorActiveBackgroundPaintPropertyPatchV1 {
    pub active_background_paint: EditorPaintDescriptorV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorBorderPaintPropertyPatchV1 {
    pub border_paint: EditorPaintDescriptorV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorActiveBorderPaintPropertyPatchV1 {
    pub active_border_paint: EditorPaintDescriptorV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorPaintDescriptorV1 {
    pub color: String,
    #[serde(deserialize_with = "deserialize_required_nullable_paint_gradient")]
    pub gradient: Option<EditorPaintGradientV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorPaintGradientV1 {
    pub angle: f64,
    pub stops: Vec<EditorPaintGradientStopV1>,
}

impl EditorPaintGradientV1 {
    pub(crate) fn to_gradient_spec(&self) -> GradientSpec {
        GradientSpec::from_canonical_parts(
            self.angle,
            self.stops
                .iter()
                .map(|stop| GradientStop {
                    color: stop.color.clone(),
                    pos: stop.pos,
                })
                .collect(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorPaintGradientStopV1 {
    pub color: String,
    pub pos: f64,
}

fn deserialize_required_nullable_paint_gradient<'de, D>(
    deserializer: D,
) -> Result<Option<EditorPaintGradientV1>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<EditorPaintGradientV1>::deserialize(deserializer)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorBorderWidthPropertyPatchV1 {
    pub border_width: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorBorderRadiusPropertyPatchV1 {
    pub border_radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFontSizePropertyPatchV1 {
    pub font_size: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorInactiveImagePropertyPatchV1 {
    pub inactive_image: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorActiveImagePropertyPatchV1 {
    pub active_image: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorIdleTransparentPropertyPatchV1 {
    pub idle_transparent: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorActiveTransparentPropertyPatchV1 {
    pub active_transparent: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorIdleImageFitPropertyPatchV1 {
    pub idle_image_fit: ImageFit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorActiveImageFitPropertyPatchV1 {
    pub active_image_fit: ImageFit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorSoundPathPropertyPatchV1 {
    pub sound_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorSoundEnabledPropertyPatchV1 {
    pub sound_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorSoundVolumePropertyPatchV1 {
    pub sound_volume: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterEnabledPropertyPatchV1 {
    pub counter_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterAnimationEnabledPropertyPatchV1 {
    pub counter_animation_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterPlacementPropertyPatchV1 {
    pub counter_placement: KeyCounterPlacement,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterAlignPropertyPatchV1 {
    pub counter_align: KeyCounterAlign,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterAlignModePropertyPatchV1 {
    pub counter_align_mode: KeyCounterAlignMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterGapPropertyPatchV1 {
    pub counter_gap: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterFontSizePropertyPatchV1 {
    pub counter_font_size: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterFontWeightPropertyPatchV1 {
    pub counter_font_weight: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterFontItalicPropertyPatchV1 {
    pub counter_font_italic: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterFontUnderlinePropertyPatchV1 {
    pub counter_font_underline: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterFontStrikethroughPropertyPatchV1 {
    pub counter_font_strikethrough: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterFontFamilyPropertyPatchV1 {
    pub counter_font_family: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterStrokeIdlePropertyPatchV1 {
    pub counter_stroke_idle: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterStrokeActivePropertyPatchV1 {
    pub counter_stroke_active: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterAnimationPresetPropertyPatchV1 {
    pub counter_animation_preset: EditorCounterAnimationPresetIntentV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterAnimationPresetIntentV1 {
    pub preset_id: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_true"
    )]
    pub apply_preset_id: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bezier: Option<[f64; 4]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u32>,
}

fn deserialize_optional_true<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = bool::deserialize(deserializer)?;
    if !value {
        return Err(serde::de::Error::custom("applyPresetId must be true"));
    }
    Ok(Some(true))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorStatTypePropertyPatchV1 {
    pub stat_type: StatType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteEffectEnabledPropertyPatchV1 {
    pub note_effect_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteGlowEnabledPropertyPatchV1 {
    pub note_glow_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteGlowSizePropertyPatchV1 {
    pub note_glow_size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteOffsetXPropertyPatchV1 {
    #[serde(deserialize_with = "deserialize_required_nullable_f64")]
    pub note_offset_x: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteOffsetYPropertyPatchV1 {
    #[serde(deserialize_with = "deserialize_required_nullable_f64")]
    pub note_offset_y: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteWidthPropertyPatchV1 {
    #[serde(deserialize_with = "deserialize_required_nullable_f64")]
    pub note_width: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteBorderWidthPropertyPatchV1 {
    pub note_border_width: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteBorderRadiusPropertyPatchV1 {
    pub note_border_radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteAutoYCorrectionPropertyPatchV1 {
    pub note_auto_y_correction: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteAlignmentPropertyPatchV1 {
    pub note_alignment: NoteAlignment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteBorderSidePropertyPatchV1 {
    pub note_border_side: EditorNoteBorderSideV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorNoteBorderSideV1 {
    All,
    Vertical,
    Horizontal,
}

impl EditorNoteBorderSideV1 {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Vertical => "vertical",
            Self::Horizontal => "horizontal",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum EditorOpV1 {
    SetBounds {
        #[serde(rename = "elementType")]
        element_type: EditorElementTypeV1,
        id: String,
        bounds: EditorBoundsV1,
    },
    DeleteElement {
        #[serde(rename = "elementType")]
        element_type: EditorElementTypeV1,
        id: String,
    },
    PatchElement {
        #[serde(rename = "elementType")]
        element_type: EditorElementTypeV1,
        id: String,
        patch: EditorElementPropertyPatchV1,
    },
    SetKeySlot {
        id: String,
        slot: EditorFrozenKeySlotV1,
    },
    InsertFrozenElements {
        mode: String,
        elements: Vec<EditorFrozenElementV1>,
        groups: Vec<EditorFrozenGroupV1>,
        #[serde(rename = "zUpdates")]
        z_updates: Vec<EditorZUpdateV1>,
    },
    ReorderElements {
        mode: String,
        #[serde(rename = "completeModeOrder")]
        complete_mode_order: bool,
        #[serde(rename = "zUpdates")]
        z_updates: Vec<EditorZUpdateV1>,
        #[serde(rename = "groupUpdates")]
        group_updates: Vec<EditorGroupUpdateV1>,
    },
}

impl EditorOpV1 {
    pub fn target_id(&self) -> Option<&str> {
        match self {
            Self::SetBounds { id, .. }
            | Self::DeleteElement { id, .. }
            | Self::PatchElement { id, .. }
            | Self::SetKeySlot { id, .. } => Some(id),
            Self::InsertFrozenElements { .. } | Self::ReorderElements { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "elementType", rename_all = "camelCase", deny_unknown_fields)]
pub enum EditorFrozenElementV1 {
    Key {
        slot: EditorFrozenKeySlotV1,
        position: KeyPosition,
    },
    Stat {
        position: StatPosition,
    },
    Graph {
        position: GraphPosition,
    },
    Knob {
        position: KnobPosition,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EditorFrozenKeySlotV1 {
    Single(String),
    Multi(EditorFrozenMultiKeySlotV1),
}

impl EditorFrozenKeySlotV1 {
    pub fn to_key_slot(&self) -> KeySlot {
        match self {
            Self::Single(key) => KeySlot::Single(key.clone()),
            Self::Multi(slot) => KeySlot::Multi {
                keys: slot.keys.clone(),
                match_mode: slot.match_mode,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFrozenMultiKeySlotV1 {
    pub keys: Vec<String>,
    #[serde(rename = "match")]
    pub match_mode: SlotMatch,
}

impl EditorFrozenElementV1 {
    pub fn id(&self) -> &str {
        match self {
            Self::Key { position, .. } => &position.id,
            Self::Stat { position } => &position.position.id,
            Self::Graph { position } => &position.position.id,
            Self::Knob { position } => &position.position.id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFrozenGroupV1 {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorZUpdateV1 {
    pub element_type: EditorElementTypeV1,
    pub id: String,
    pub z_index: i32,
}

fn deserialize_required_nullable_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

fn deserialize_required_nullable_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<f64>::deserialize(deserializer)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorGroupUpdateV1 {
    pub element_type: EditorElementTypeV1,
    pub id: String,
    #[serde(deserialize_with = "deserialize_required_nullable_string")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCommitRequest {
    pub base_revision: u64,
    pub mutation_id: String,
    #[serde(default)]
    pub multi_key: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gesture_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gesture_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changes: Option<EditorPatchV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ops_version: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ops: Option<Vec<EditorOpV1>>,
}

impl EditorCommitRequest {
    pub fn echoed_gesture_ids(&self) -> Vec<String> {
        let mut gesture_ids =
            Vec::with_capacity(self.gesture_ids.len() + usize::from(self.gesture_id.is_some()));
        for gesture_id in self.gesture_ids.iter().chain(self.gesture_id.iter()) {
            if !gesture_ids.contains(gesture_id) {
                gesture_ids.push(gesture_id.clone());
            }
        }
        gesture_ids
    }

    pub fn history_gesture_id(&self) -> Option<String> {
        self.gesture_id
            .clone()
            .or_else(|| self.gesture_ids.last().cloned())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorOpResultStatusV1 {
    Applied,
    NoChange,
    TargetMissing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorOpResultV1 {
    pub status: EditorOpResultStatusV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<EditorBoundsV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCommitResult {
    pub revision: u64,
    pub changed_fields: Vec<EditorField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op_results: Option<Vec<EditorOpResultV1>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorGetResult {
    pub revision: u64,
    pub document: EditorDocumentV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTruncated {
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStatus {
    pub history_revision: u64,
    pub history_epoch: u64,
    pub status_seq: u64,
    pub can_undo: bool,
    pub can_redo: bool,
    pub busy: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<HistoryTruncated>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCommittedV1 {
    pub schema_version: u16,
    pub revision: u64,
    pub mutation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gesture_id: Option<String>,
    #[serde(default)]
    pub gesture_ids: Vec<String>,
    pub origin: String,
    pub changed_fields: Vec<EditorField>,
    pub patch: EditorPatchV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditorCommitOrigin {
    StrictEditorCommit,
    GestureCommit,
    LegacyAdapter(String),
    HistoryUndo,
    HistoryRedo,
    // 이벤트 없는 부팅 복구용 origin 계약
    #[allow(dead_code)]
    LoadRecovery,
}

impl EditorCommitOrigin {
    pub fn event_name(&self) -> Option<String> {
        match self {
            Self::StrictEditorCommit => Some("editorCommit".to_string()),
            Self::GestureCommit => Some("gestureCommit".to_string()),
            Self::LegacyAdapter(command) => Some(format!("legacy:{command}")),
            Self::HistoryUndo => Some("historyUndo".to_string()),
            Self::HistoryRedo => Some("historyRedo".to_string()),
            Self::LoadRecovery => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CommittedEditorChange {
    pub result: EditorCommitResult,
    pub event: Option<EditorCommittedV1>,
    pub replayed: bool,
    pub document: EditorDocumentV1,
    pub selected_key_type: String,
    pub key_counters: KeyCounters,
    pub history_status: Option<HistoryStatus>,
    pub(crate) runtime_publication_generation: u64,
}

#[derive(Debug, Clone)]
pub struct EditorTransactionResult<T> {
    pub value: T,
    pub change: CommittedEditorChange,
}
