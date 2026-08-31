use serde::{Deserialize, Serialize};

use super::{
    AppStoreData, GradientSpec, GradientStop, GraphPosition, GraphPositions, GraphType, ImageFit,
    ImageMode, KeyCounterAlign, KeyCounterAlignMode, KeyCounterPlacement, KeyCounters, KeyMappings,
    KeyPosition, KeyPositions, KeySlot, KnobPosition, KnobPositions, LayerGroups, NoteAlignment,
    SlotMatch, SpritePositions, StatPosition, StatPositions, StatType,
};

pub const EDITOR_SCHEMA_VERSION: u16 = 1;
pub const EDITOR_COMMIT_SCHEMA_VERSION_V2: u16 = 2;
pub const EDITOR_OPS_VERSION: u16 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorField {
    Keys,
    KeyPositions,
    StatPositions,
    GraphPositions,
    KnobPositions,
    SpritePositions,
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
    #[serde(default)]
    pub sprite_positions: SpritePositions,
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
            sprite_positions: store.sprite_positions.clone(),
            layer_groups: store.layer_groups.clone(),
        }
    }

    pub fn apply_to_store(&self, store: &mut AppStoreData) {
        store.keys = self.keys.clone();
        store.key_positions = self.key_positions.clone();
        store.stat_positions = self.stat_positions.clone();
        store.graph_positions = self.graph_positions.clone();
        store.knob_positions = self.knob_positions.clone();
        store.sprite_positions = self.sprite_positions.clone();
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
        if let Some(value) = patch.sprite_positions.as_ref() {
            self.sprite_positions = value.clone();
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
        if self.sprite_positions != next.sprite_positions {
            fields.push(EditorField::SpritePositions);
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
                EditorField::SpritePositions => {
                    patch.sprite_positions = Some(self.sprite_positions.clone());
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
    pub sprite_positions: Option<SpritePositions>,
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
            sprite_positions: None,
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
            EditorField::SpritePositions => self.sprite_positions.is_some(),
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
            EditorField::SpritePositions,
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
    Sprite,
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
#[serde(
    tag = "property",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum EditorElementPropertyPatchV1 {
    Hidden(bool),
    // nullable variant는 value 키 자체가 없으면 거부 - Option 기본 동작(None) 차단
    #[serde(deserialize_with = "deserialize_required_nullable_string")]
    LayerName(Option<String>),
    GraphType(GraphType),
    GraphColor(String),
    ShowAvgLine(bool),
    GraphAnimationEnabled(bool),
    GraphSpeed(u32),
    Reverse(bool),
    Sensitivity(f64),
    AxisId(String),
    UseInlineStyles(bool),
    FontWeight(u32),
    FontBold(bool),
    FontItalic(bool),
    FontUnderline(bool),
    FontStrikethrough(bool),
    FontFamily(String),
    DisplayText(String),
    ClassName(String),
    FontPaint(EditorPaintDescriptorV1),
    ActiveFontPaint(EditorPaintDescriptorV1),
    Shadow(EditorShadowLeafPatchV1),
    ActiveShadow(EditorShadowLeafPatchV1),
    ShadowEnabled(bool),
    BackgroundPaint(EditorPaintDescriptorV1),
    ActiveBackgroundPaint(EditorPaintDescriptorV1),
    BorderPaint(EditorPaintDescriptorV1),
    ActiveBorderPaint(EditorPaintDescriptorV1),
    BorderWidth(f64),
    BorderRadius(f64),
    FontSize(f64),
    InactiveImage(String),
    ActiveImage(String),
    IdleTransparent(bool),
    ActiveTransparent(bool),
    IdleImageFit(ImageFit),
    ActiveImageFit(ImageFit),
    ImageMode(ImageMode),
    #[serde(deserialize_with = "deserialize_required_nullable_image_transform_leaf")]
    IdleImageTransform(Option<ImageTransformLeafPatchV1>),
    #[serde(deserialize_with = "deserialize_required_nullable_image_transform_leaf")]
    ActiveImageTransform(Option<ImageTransformLeafPatchV1>),
    SoundPath(String),
    SoundEnabled(bool),
    SoundVolume(f64),
    CounterEnabled(bool),
    CounterAnimationEnabled(bool),
    CounterPlacement(KeyCounterPlacement),
    CounterAlign(KeyCounterAlign),
    CounterAlignMode(KeyCounterAlignMode),
    CounterGap(u32),
    CounterFontSize(u32),
    CounterFontWeight(u32),
    CounterFontBold(bool),
    CounterFontItalic(bool),
    CounterFontUnderline(bool),
    CounterFontStrikethrough(bool),
    CounterFontFamily(String),
    CounterFillIdle(EditorCounterFillIntentV1),
    CounterFillActive(EditorCounterFillIntentV1),
    CounterAnimationPreset(EditorCounterAnimationPresetIntentV1),
    StatType(StatType),
    NoteEffectEnabled(bool),
    NoteGlowEnabled(bool),
    NoteGlowSyncPaint(bool),
    NoteGlowSize(f64),
    NotePaint(EditorNotePaintIntentV1),
    NoteGlowPaint(EditorNotePaintIntentV1),
    NoteBorderPaint(EditorNoteBorderPaintV1),
    #[serde(deserialize_with = "deserialize_required_nullable_f64")]
    NoteOffsetX(Option<f64>),
    #[serde(deserialize_with = "deserialize_required_nullable_f64")]
    NoteOffsetY(Option<f64>),
    #[serde(deserialize_with = "deserialize_required_nullable_f64")]
    NoteWidth(Option<f64>),
    NoteBorderWidth(f64),
    NoteBorderRadius(f64),
    NoteAutoYCorrection(bool),
    NoteAlignment(NoteAlignment),
    NoteBorderSide(EditorNoteBorderSideV1),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "leaf",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum EditorShadowLeafPatchV1 {
    Color(String),
    OffsetX(f64),
    OffsetY(f64),
    Blur(f64),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "leaf",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum ImageTransformLeafPatchV1 {
    OffsetX(f64),
    OffsetY(f64),
    Rotation(f64),
    Scale(f64),
}

fn deserialize_required_nullable_image_transform_leaf<'de, D>(
    deserializer: D,
) -> Result<Option<ImageTransformLeafPatchV1>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<ImageTransformLeafPatchV1>::deserialize(deserializer)
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EditorCounterFillIntentV1 {
    Solid(EditorCounterFillSolidIntentV1),
    Gradient(EditorCounterFillGradientIntentV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterFillSolidIntentV1 {
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorCounterFillGradientIntentV1 {
    pub color: String,
    pub gradient: EditorPaintGradientV1,
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
#[serde(untagged)]
pub enum EditorNotePaintIntentV1 {
    Descriptor(EditorNotePaintDescriptorIntentV1),
    Color(EditorNotePaintColorIntentV1),
    Opacity(EditorNotePaintOpacityIntentV1),
    GradientOpacity(EditorNotePaintGradientOpacityIntentV1),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNotePaintDescriptorIntentV1 {
    pub color: EditorNoteColorV1,
    pub opacity: u32,
    #[serde(deserialize_with = "deserialize_required_nullable_paint_gradient")]
    pub gradient: Option<EditorPaintGradientV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNotePaintColorIntentV1 {
    pub color: EditorNoteColorV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNotePaintOpacityIntentV1 {
    pub opacity: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNotePaintGradientOpacityIntentV1 {
    pub opacity: u32,
    pub opacity_top: u32,
    pub opacity_bottom: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EditorNoteColorV1 {
    Solid(String),
    Gradient(EditorNoteGradientColorV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteGradientColorV1 {
    #[serde(rename = "type")]
    pub kind: EditorNoteGradientColorKindV1,
    pub top: String,
    pub bottom: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorNoteGradientColorKindV1 {
    Gradient,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorNoteBorderPaintV1 {
    pub color: String,
    pub opacity: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gradient: Option<EditorPaintGradientV1>,
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
    SetElementGroups {
        mode: String,
        targets: Vec<EditorElementGroupTargetV1>,
        #[serde(rename = "targetGroup")]
        #[serde(deserialize_with = "deserialize_required_nullable_target_group")]
        target_group: Option<EditorTargetGroupV1>,
    },
    RenameLayerGroup {
        mode: String,
        #[serde(rename = "groupId")]
        group_id: String,
        name: String,
    },
}

impl EditorOpV1 {
    pub(crate) fn may_change_keys(&self) -> bool {
        match self {
            Self::SetKeySlot { .. } => true,
            Self::DeleteElement { element_type, .. } => *element_type == EditorElementTypeV1::Key,
            Self::InsertFrozenElements { elements, .. } => elements
                .iter()
                .any(|element| matches!(element, EditorFrozenElementV1::Key { .. })),
            Self::SetBounds { .. }
            | Self::PatchElement { .. }
            | Self::ReorderElements { .. }
            | Self::SetElementGroups { .. }
            | Self::RenameLayerGroup { .. } => false,
        }
    }

    pub fn target_id(&self) -> Option<&str> {
        match self {
            Self::SetBounds { id, .. }
            | Self::DeleteElement { id, .. }
            | Self::PatchElement { id, .. }
            | Self::SetKeySlot { id, .. } => Some(id),
            Self::InsertFrozenElements { .. }
            | Self::ReorderElements { .. }
            | Self::SetElementGroups { .. }
            | Self::RenameLayerGroup { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorElementGroupTargetV1 {
    pub element_type: EditorElementTypeV1,
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum EditorTargetGroupV1 {
    Existing { id: String },
    Create { id: String, name: String },
}

fn deserialize_required_nullable_target_group<'de, D>(
    deserializer: D,
) -> Result<Option<EditorTargetGroupV1>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<EditorTargetGroupV1>::deserialize(deserializer)
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
    Sprite {
        position: super::ReactiveSpritePosition,
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
            Self::Sprite { position } => &position.id,
        }
    }

    pub(crate) fn key_position_mut(&mut self) -> Option<&mut KeyPosition> {
        match self {
            Self::Key { position, .. } => Some(position),
            Self::Stat { position } => Some(&mut position.position),
            Self::Graph { position } => Some(&mut position.position),
            Self::Knob { position } => Some(&mut position.position),
            Self::Sprite { .. } => None,
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
    pub(crate) fn may_change_keys(&self) -> bool {
        self.changes
            .as_ref()
            .is_some_and(|changes| changes.keys.is_some())
            || self
                .ops
                .as_ref()
                .is_some_and(|ops| ops.iter().any(EditorOpV1::may_change_keys))
    }

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
    pub(crate) plugin_instances_changes: Vec<super::PluginInstancesChangedPayload>,
    pub(crate) runtime_publication_generation: u64,
}

#[derive(Debug, Clone)]
pub struct EditorTransactionResult<T> {
    pub value: T,
    pub change: CommittedEditorChange,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ReactiveSpritePosition, SpritePose};

    // TS canonical 배열과 공유하는 property 태그 fixture
    const PROPERTY_TAG_FIXTURE: &str =
        include_str!("../../../tests/fixtures/editor-property-tags.json");

    fn sprite_with_pose() -> ReactiveSpritePosition {
        ReactiveSpritePosition {
            id: uuid::Uuid::new_v4().to_string(),
            poses: vec![SpritePose {
                pose_id: uuid::Uuid::new_v4().to_string(),
                triggers: vec![uuid::Uuid::new_v4().to_string()],
                ..SpritePose::default()
            }],
            ..ReactiveSpritePosition::default()
        }
    }

    fn insert_sprite_activation_and_removed_match_mode(
        value: &mut serde_json::Value,
        pointer: &str,
    ) {
        let sprite = value
            .pointer_mut(pointer)
            .and_then(serde_json::Value::as_object_mut)
            .expect("sprite object exists");
        sprite.insert("activation".to_string(), serde_json::json!("onPress"));
        sprite
            .get_mut("poses")
            .and_then(serde_json::Value::as_array_mut)
            .and_then(|poses| poses.first_mut())
            .expect("pose exists")
            .as_object_mut()
            .expect("pose object exists")
            .insert("matchMode".to_string(), serde_json::json!("exact"));
    }

    fn assert_sprite_activation_round_trips_and_match_mode_is_omitted(
        value: &serde_json::Value,
        pointer: &str,
    ) {
        let sprite = value
            .pointer(pointer)
            .and_then(serde_json::Value::as_object)
            .expect("sprite object exists");
        assert_eq!(sprite["activation"], serde_json::json!("onPress"));
        assert!(!sprite["poses"][0]
            .as_object()
            .expect("pose object exists")
            .contains_key("matchMode"));
    }

    #[test]
    fn v1_editor_patch_round_trips_sprite_activation_and_ignores_removed_match_mode() {
        let mut sprite_positions = SpritePositions::new();
        sprite_positions.insert("4key".to_string(), vec![sprite_with_pose()]);
        let mut value = serde_json::to_value(EditorPatchV1 {
            sprite_positions: Some(sprite_positions),
            ..EditorPatchV1::default()
        })
        .unwrap();
        insert_sprite_activation_and_removed_match_mode(&mut value, "/spritePositions/4key/0");

        let restored: EditorPatchV1 = serde_json::from_value(value).unwrap();
        let serialized = serde_json::to_value(restored).unwrap();

        assert_sprite_activation_round_trips_and_match_mode_is_omitted(
            &serialized,
            "/spritePositions/4key/0",
        );
    }

    #[test]
    fn frozen_sprite_insert_round_trips_activation_and_ignores_removed_match_mode() {
        let mut value = serde_json::to_value(EditorOpV1::InsertFrozenElements {
            mode: "4key".to_string(),
            elements: vec![EditorFrozenElementV1::Sprite {
                position: sprite_with_pose(),
            }],
            groups: Vec::new(),
            z_updates: Vec::new(),
        })
        .unwrap();
        insert_sprite_activation_and_removed_match_mode(&mut value, "/elements/0/position");

        let restored: EditorOpV1 = serde_json::from_value(value).unwrap();
        let serialized = serde_json::to_value(restored).unwrap();

        assert_sprite_activation_round_trips_and_match_mode_is_omitted(
            &serialized,
            "/elements/0/position",
        );
    }

    #[test]
    fn v1_editor_patch_defaults_missing_sprite_oneshot_fields() {
        let mut sprite_positions = SpritePositions::new();
        sprite_positions.insert("4key".to_string(), vec![sprite_with_pose()]);
        let mut value = serde_json::to_value(EditorPatchV1 {
            sprite_positions: Some(sprite_positions),
            ..EditorPatchV1::default()
        })
        .unwrap();
        let sprite = value
            .pointer_mut("/spritePositions/4key/0")
            .and_then(serde_json::Value::as_object_mut)
            .unwrap();
        sprite.remove("activation");
        sprite.remove("pressDurationMs");
        sprite
            .get_mut("poses")
            .and_then(serde_json::Value::as_array_mut)
            .and_then(|poses| poses.first_mut())
            .and_then(serde_json::Value::as_object_mut)
            .unwrap()
            .remove("contactPoint");

        let restored: EditorPatchV1 = serde_json::from_value(value).unwrap();
        let serialized = serde_json::to_value(restored).unwrap();
        let sprite = serialized
            .pointer("/spritePositions/4key/0")
            .and_then(serde_json::Value::as_object)
            .unwrap();

        assert_eq!(sprite["activation"], serde_json::json!("whileHeld"));
        assert_eq!(sprite["pressDurationMs"], serde_json::json!(300));
        assert_eq!(
            sprite["poses"][0]["contactPoint"],
            serde_json::json!({ "x": 0.5, "y": 1.0 })
        );
    }

    fn paint(color: &str) -> EditorPaintDescriptorV1 {
        EditorPaintDescriptorV1 {
            color: color.to_string(),
            gradient: None,
        }
    }

    // 75개 variant 전수: (patch, property 태그, value wire) 고정 표본
    fn property_patch_samples() -> Vec<(
        EditorElementPropertyPatchV1,
        &'static str,
        serde_json::Value,
    )> {
        use serde_json::json;
        use EditorElementPropertyPatchV1 as P;
        vec![
            (P::Hidden(true), "hidden", json!(true)),
            (
                P::LayerName(Some("layer".to_string())),
                "layerName",
                json!("layer"),
            ),
            (P::GraphType(GraphType::Bar), "graphType", json!("bar")),
            (
                P::GraphColor("#123456".to_string()),
                "graphColor",
                json!("#123456"),
            ),
            (P::ShowAvgLine(false), "showAvgLine", json!(false)),
            (
                P::GraphAnimationEnabled(true),
                "graphAnimationEnabled",
                json!(true),
            ),
            (P::GraphSpeed(7), "graphSpeed", json!(7)),
            (P::Reverse(true), "reverse", json!(true)),
            (P::Sensitivity(1.5), "sensitivity", json!(1.5)),
            (P::AxisId("axis-1".to_string()), "axisId", json!("axis-1")),
            (P::UseInlineStyles(true), "useInlineStyles", json!(true)),
            (P::FontWeight(700), "fontWeight", json!(700)),
            (P::FontBold(true), "fontBold", json!(true)),
            (P::FontItalic(true), "fontItalic", json!(true)),
            (P::FontUnderline(false), "fontUnderline", json!(false)),
            (P::FontStrikethrough(true), "fontStrikethrough", json!(true)),
            (
                P::FontFamily("font".to_string()),
                "fontFamily",
                json!("font"),
            ),
            (
                P::DisplayText("text".to_string()),
                "displayText",
                json!("text"),
            ),
            (
                P::ClassName("class".to_string()),
                "className",
                json!("class"),
            ),
            (
                P::FontPaint(paint("#111111")),
                "fontPaint",
                json!({ "color": "#111111", "gradient": null }),
            ),
            (
                P::ActiveFontPaint(paint("#222222")),
                "activeFontPaint",
                json!({ "color": "#222222", "gradient": null }),
            ),
            (
                P::Shadow(EditorShadowLeafPatchV1::Color(
                    "rgba(0, 0, 0, 0.2)".to_string(),
                )),
                "shadow",
                json!({ "leaf": "color", "value": "rgba(0, 0, 0, 0.2)" }),
            ),
            (
                P::ActiveShadow(EditorShadowLeafPatchV1::OffsetY(-3.25)),
                "activeShadow",
                json!({ "leaf": "offsetY", "value": -3.25 }),
            ),
            (P::ShadowEnabled(false), "shadowEnabled", json!(false)),
            (
                P::BackgroundPaint(paint("#010101")),
                "backgroundPaint",
                json!({ "color": "#010101", "gradient": null }),
            ),
            (
                P::ActiveBackgroundPaint(paint("#020202")),
                "activeBackgroundPaint",
                json!({ "color": "#020202", "gradient": null }),
            ),
            (
                P::BorderPaint(paint("#030303")),
                "borderPaint",
                json!({ "color": "#030303", "gradient": null }),
            ),
            (
                P::ActiveBorderPaint(paint("#040404")),
                "activeBorderPaint",
                json!({ "color": "#040404", "gradient": null }),
            ),
            (P::BorderWidth(2.5), "borderWidth", json!(2.5)),
            (P::BorderRadius(8.5), "borderRadius", json!(8.5)),
            (P::FontSize(12.5), "fontSize", json!(12.5)),
            (
                P::InactiveImage("idle.png".to_string()),
                "inactiveImage",
                json!("idle.png"),
            ),
            (
                P::ActiveImage("active.png".to_string()),
                "activeImage",
                json!("active.png"),
            ),
            (P::IdleTransparent(true), "idleTransparent", json!(true)),
            (
                P::ActiveTransparent(false),
                "activeTransparent",
                json!(false),
            ),
            (
                P::IdleImageFit(ImageFit::Contain),
                "idleImageFit",
                json!("contain"),
            ),
            (
                P::ActiveImageFit(ImageFit::Fill),
                "activeImageFit",
                json!("fill"),
            ),
            (
                P::ImageMode(ImageMode::Overlay),
                "imageMode",
                json!("overlay"),
            ),
            (
                P::IdleImageTransform(Some(ImageTransformLeafPatchV1::Rotation(-45.5))),
                "idleImageTransform",
                json!({ "leaf": "rotation", "value": -45.5 }),
            ),
            (
                P::ActiveImageTransform(None),
                "activeImageTransform",
                serde_json::Value::Null,
            ),
            (
                P::SoundPath("sound.wav".to_string()),
                "soundPath",
                json!("sound.wav"),
            ),
            (P::SoundEnabled(true), "soundEnabled", json!(true)),
            (P::SoundVolume(80.5), "soundVolume", json!(80.5)),
            (P::CounterEnabled(true), "counterEnabled", json!(true)),
            (
                P::CounterAnimationEnabled(false),
                "counterAnimationEnabled",
                json!(false),
            ),
            (
                P::CounterPlacement(KeyCounterPlacement::Outside),
                "counterPlacement",
                json!("outside"),
            ),
            (
                P::CounterAlign(KeyCounterAlign::Top),
                "counterAlign",
                json!("top"),
            ),
            (
                P::CounterAlignMode(KeyCounterAlignMode::Between),
                "counterAlignMode",
                json!("between"),
            ),
            (P::CounterGap(4), "counterGap", json!(4)),
            (P::CounterFontSize(16), "counterFontSize", json!(16)),
            (P::CounterFontWeight(500), "counterFontWeight", json!(500)),
            (P::CounterFontBold(true), "counterFontBold", json!(true)),
            (P::CounterFontItalic(true), "counterFontItalic", json!(true)),
            (
                P::CounterFontUnderline(false),
                "counterFontUnderline",
                json!(false),
            ),
            (
                P::CounterFontStrikethrough(true),
                "counterFontStrikethrough",
                json!(true),
            ),
            (
                P::CounterFontFamily("counter-font".to_string()),
                "counterFontFamily",
                json!("counter-font"),
            ),
            (
                P::CounterFillIdle(EditorCounterFillIntentV1::Solid(
                    EditorCounterFillSolidIntentV1 {
                        color: "#050505".to_string(),
                    },
                )),
                "counterFillIdle",
                json!({ "color": "#050505" }),
            ),
            (
                P::CounterFillActive(EditorCounterFillIntentV1::Solid(
                    EditorCounterFillSolidIntentV1 {
                        color: "#060606".to_string(),
                    },
                )),
                "counterFillActive",
                json!({ "color": "#060606" }),
            ),
            (
                P::CounterAnimationPreset(EditorCounterAnimationPresetIntentV1 {
                    preset_id: "preset".to_string(),
                    apply_preset_id: None,
                    bezier: None,
                    scale: None,
                    duration_ms: None,
                }),
                "counterAnimationPreset",
                json!({ "presetId": "preset" }),
            ),
            (P::StatType(StatType::Total), "statType", json!("total")),
            (P::NoteEffectEnabled(true), "noteEffectEnabled", json!(true)),
            (P::NoteGlowEnabled(false), "noteGlowEnabled", json!(false)),
            (P::NoteGlowSyncPaint(true), "noteGlowSyncPaint", json!(true)),
            (P::NoteGlowSize(6.5), "noteGlowSize", json!(6.5)),
            (
                P::NotePaint(EditorNotePaintIntentV1::Opacity(
                    EditorNotePaintOpacityIntentV1 { opacity: 40 },
                )),
                "notePaint",
                json!({ "opacity": 40 }),
            ),
            (
                P::NoteGlowPaint(EditorNotePaintIntentV1::Opacity(
                    EditorNotePaintOpacityIntentV1 { opacity: 60 },
                )),
                "noteGlowPaint",
                json!({ "opacity": 60 }),
            ),
            (
                P::NoteBorderPaint(EditorNoteBorderPaintV1 {
                    color: "#0a0b0c".to_string(),
                    opacity: 30,
                    gradient: None,
                }),
                "noteBorderPaint",
                json!({ "color": "#0a0b0c", "opacity": 30 }),
            ),
            (P::NoteOffsetX(Some(11.5)), "noteOffsetX", json!(11.5)),
            (P::NoteOffsetY(Some(-12.5)), "noteOffsetY", json!(-12.5)),
            (P::NoteWidth(Some(13.5)), "noteWidth", json!(13.5)),
            (P::NoteBorderWidth(1.5), "noteBorderWidth", json!(1.5)),
            (P::NoteBorderRadius(9.5), "noteBorderRadius", json!(9.5)),
            (
                P::NoteAutoYCorrection(true),
                "noteAutoYCorrection",
                json!(true),
            ),
            (
                P::NoteAlignment(NoteAlignment::Right),
                "noteAlignment",
                json!("right"),
            ),
            (
                P::NoteBorderSide(EditorNoteBorderSideV1::Vertical),
                "noteBorderSide",
                json!("vertical"),
            ),
        ]
    }

    #[test]
    fn property_patch_wire_pins_all_tag_value_pairs_and_roundtrips() {
        let samples = property_patch_samples();
        assert_eq!(samples.len(), 75);
        for (patch, tag, value) in samples {
            let wire = serde_json::to_value(&patch).unwrap();
            assert_eq!(
                wire,
                serde_json::json!({ "property": tag, "value": value }),
                "wire mismatch for {tag}"
            );
            let decoded: EditorElementPropertyPatchV1 = serde_json::from_value(wire).unwrap();
            assert_eq!(decoded, patch, "roundtrip mismatch for {tag}");
        }
    }

    #[test]
    fn expanded_paint_values_keep_existing_property_tags_and_exact_keys() {
        let gradient = serde_json::json!({
            "angle": 90,
            "stops": [
                { "color": "#112233", "pos": 0 },
                { "color": "#445566", "pos": 1 }
            ]
        });
        let cases = [
            serde_json::json!({
                "property": "noteBorderPaint",
                "value": { "color": "#112233", "opacity": 80 }
            }),
            serde_json::json!({
                "property": "noteBorderPaint",
                "value": { "color": "#112233", "opacity": 80, "gradient": null }
            }),
            serde_json::json!({
                "property": "noteBorderPaint",
                "value": {
                    "color": "#112233",
                    "opacity": 80,
                    "gradient": gradient.clone()
                }
            }),
            serde_json::json!({
                "property": "notePaint",
                "value": {
                    "color": "#112233",
                    "opacity": 80,
                    "gradient": null
                }
            }),
            serde_json::json!({
                "property": "noteGlowPaint",
                "value": {
                    "color": {
                        "type": "gradient",
                        "top": "#112233",
                        "bottom": "#445566"
                    },
                    "opacity": 80,
                    "gradient": gradient
                }
            }),
        ];

        for wire in cases {
            let patch: EditorElementPropertyPatchV1 = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(&patch).unwrap()["property"],
                wire["property"]
            );
        }

        for wire in [
            serde_json::json!({
                "property": "noteBorderPaint",
                "value": { "color": "#112233", "opacity": 80, "extra": true }
            }),
            serde_json::json!({
                "property": "notePaint",
                "value": { "color": "#112233", "opacity": 80 }
            }),
            serde_json::json!({
                "property": "noteGlowPaint",
                "value": {
                    "color": "#112233",
                    "opacity": 80,
                    "gradient": null,
                    "extra": true
                }
            }),
        ] {
            assert!(serde_json::from_value::<EditorElementPropertyPatchV1>(wire).is_err());
        }
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct PropertyTagFixture {
        version: u16,
        properties: Vec<String>,
    }

    fn property_tag_fixture() -> PropertyTagFixture {
        serde_json::from_str(PROPERTY_TAG_FIXTURE).unwrap()
    }

    #[test]
    fn property_patch_tags_match_shared_fixture() {
        let fixture = property_tag_fixture();
        // 양방향 anchor: Rust 상수만 승격되는 사고도 fixture 대조로 잡는다
        assert_eq!(fixture.version, EDITOR_OPS_VERSION);
        let tags: Vec<String> = property_patch_samples()
            .iter()
            .map(|(_, tag, _)| (*tag).to_string())
            .collect();
        assert_eq!(tags, fixture.properties);
    }

    // serde가 알 수 없는 variant 오류에 나열하는 기대 목록에서 enum의
    // wire 태그 전수를 기계적으로 추출 - 수기 목록 없이 variant 추가를 감지
    fn wire_property_tags_from_serde() -> std::collections::BTreeSet<String> {
        let message = serde_json::from_value::<EditorElementPropertyPatchV1>(serde_json::json!({
            "property": "__unknown__",
            "value": null,
        }))
        .unwrap_err()
        .to_string();
        let (_, listed) = message
            .split_once("expected one of ")
            .expect("serde unknown-variant error must enumerate every variant");
        let tags: std::collections::BTreeSet<String> = listed
            .split(", ")
            .map(|tag| tag.trim().trim_matches('`').to_string())
            .collect();
        assert!(!tags.is_empty());
        tags
    }

    #[test]
    fn sample_and_fixture_tags_cover_every_enum_variant() {
        let enum_tags = wire_property_tags_from_serde();
        let sample_tags: std::collections::BTreeSet<String> = property_patch_samples()
            .iter()
            .map(|(_, tag, _)| (*tag).to_string())
            .collect();
        let fixture_tags: std::collections::BTreeSet<String> =
            property_tag_fixture().properties.into_iter().collect();
        // variant 신규 추가 시 표본·fixture 갱신 누락을 단방향 드리프트 없이 차단
        assert_eq!(sample_tags, enum_tags);
        assert_eq!(fixture_tags, enum_tags);
    }

    #[test]
    fn property_patch_rejects_untagged_extra_unknown_and_missing_fields() {
        use serde_json::json;
        let reject = |value: serde_json::Value| {
            assert!(
                serde_json::from_value::<EditorElementPropertyPatchV1>(value.clone()).is_err(),
                "expected rejection: {value}"
            );
        };
        // 옛 one-key 형식
        reject(json!({ "hidden": true }));
        reject(json!({ "graphType": "bar" }));
        // outer 추가 필드
        reject(json!({ "property": "hidden", "value": true, "extra": 1 }));
        // 알 수 없는 property
        reject(json!({ "property": "unknown", "value": 1 }));
        // property 누락
        reject(json!({ "value": true }));
        // 원시값 payload의 value 누락
        reject(json!({ "property": "hidden" }));
        // 잘못된 값 타입
        reject(json!({ "property": "hidden", "value": "true" }));
        // 중복 키
        for duplicated in [
            r#"{ "property": "hidden", "property": "hidden", "value": true }"#,
            r#"{ "property": "hidden", "value": true, "value": false }"#,
        ] {
            assert!(
                serde_json::from_str::<EditorElementPropertyPatchV1>(duplicated).is_err(),
                "expected duplicate key rejection: {duplicated}"
            );
        }
    }

    #[test]
    fn nullable_variants_require_an_explicit_value_key() {
        use serde_json::json;
        use EditorElementPropertyPatchV1 as P;
        let cases = [
            ("layerName", P::LayerName(None)),
            ("noteOffsetX", P::NoteOffsetX(None)),
            ("noteOffsetY", P::NoteOffsetY(None)),
            ("noteWidth", P::NoteWidth(None)),
            ("idleImageTransform", P::IdleImageTransform(None)),
            ("activeImageTransform", P::ActiveImageTransform(None)),
        ];
        for (tag, expected_null) in cases {
            // value 키 자체가 없으면 None으로 통과하지 않고 거부
            assert!(
                serde_json::from_value::<EditorElementPropertyPatchV1>(json!({ "property": tag }))
                    .is_err(),
                "expected missing value rejection for {tag}"
            );
            let decoded: EditorElementPropertyPatchV1 =
                serde_json::from_value(json!({ "property": tag, "value": null })).unwrap();
            assert_eq!(decoded, expected_null, "explicit null mismatch for {tag}");
        }
        let decoded: EditorElementPropertyPatchV1 = serde_json::from_value(json!({
            "property": "layerName",
            "value": "named"
        }))
        .unwrap();
        assert_eq!(decoded, P::LayerName(Some("named".to_string())));
    }

    #[test]
    fn shadow_leaf_wire_requires_leaf_tag_and_exact_fields() {
        use serde_json::json;
        let decoded: EditorShadowLeafPatchV1 =
            serde_json::from_value(json!({ "leaf": "blur", "value": 4.5 })).unwrap();
        assert_eq!(decoded, EditorShadowLeafPatchV1::Blur(4.5));
        for invalid in [
            // 옛 one-key 형식
            json!({ "blur": 4.5 }),
            // leaf 누락
            json!({ "value": 4.5 }),
            // leaf 오타
            json!({ "leaf": "blr", "value": 4.5 }),
            // value 누락
            json!({ "leaf": "blur" }),
            // 추가 필드
            json!({ "leaf": "blur", "value": 4.5, "extra": 1 }),
            // 잘못된 값 타입
            json!({ "leaf": "offsetX", "value": "1" }),
        ] {
            assert!(
                serde_json::from_value::<EditorShadowLeafPatchV1>(invalid.clone()).is_err(),
                "expected shadow leaf rejection: {invalid}"
            );
        }
    }

    #[test]
    fn image_transform_leaf_wire_requires_leaf_tag_and_exact_fields() {
        use serde_json::json;
        for (wire, expected) in [
            (
                json!({ "leaf": "offsetX", "value": -10.5 }),
                ImageTransformLeafPatchV1::OffsetX(-10.5),
            ),
            (
                json!({ "leaf": "offsetY", "value": 20.5 }),
                ImageTransformLeafPatchV1::OffsetY(20.5),
            ),
            (
                json!({ "leaf": "rotation", "value": 45.0 }),
                ImageTransformLeafPatchV1::Rotation(45.0),
            ),
            (
                json!({ "leaf": "scale", "value": 1.25 }),
                ImageTransformLeafPatchV1::Scale(1.25),
            ),
        ] {
            let decoded: ImageTransformLeafPatchV1 = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(decoded, expected);
            assert_eq!(serde_json::to_value(decoded).unwrap(), wire);
        }
        for invalid in [
            json!({ "scale": 1.0 }),
            json!({ "value": 1.0 }),
            json!({ "leaf": "zoom", "value": 1.0 }),
            json!({ "leaf": "scale" }),
            json!({ "leaf": "scale", "value": 1.0, "extra": true }),
            json!({ "leaf": "offsetX", "value": "1" }),
        ] {
            assert!(
                serde_json::from_value::<ImageTransformLeafPatchV1>(invalid.clone()).is_err(),
                "expected image transform leaf rejection: {invalid}"
            );
        }
    }

    #[test]
    fn editor_request_detects_every_direct_key_mapping_mutation() {
        let request =
            |changes: Option<EditorPatchV1>, ops: Option<Vec<EditorOpV1>>| EditorCommitRequest {
                base_revision: 0,
                mutation_id: uuid::Uuid::new_v4().to_string(),
                multi_key: false,
                gesture_id: None,
                gesture_ids: Vec::new(),
                changes,
                ops_version: ops.as_ref().map(|_| EDITOR_OPS_VERSION),
                ops,
            };

        let key_patch = EditorPatchV1 {
            keys: Some(KeyMappings::new()),
            ..EditorPatchV1::default()
        };
        assert!(request(Some(key_patch), None).may_change_keys());
        assert!(request(
            None,
            Some(vec![EditorOpV1::SetKeySlot {
                id: uuid::Uuid::new_v4().to_string(),
                slot: EditorFrozenKeySlotV1::Single("A".to_string()),
            }]),
        )
        .may_change_keys());
        assert!(request(
            None,
            Some(vec![EditorOpV1::DeleteElement {
                element_type: EditorElementTypeV1::Key,
                id: uuid::Uuid::new_v4().to_string(),
            }]),
        )
        .may_change_keys());
        assert!(!request(
            None,
            Some(vec![EditorOpV1::SetBounds {
                element_type: EditorElementTypeV1::Key,
                id: uuid::Uuid::new_v4().to_string(),
                bounds: EditorBoundsV1 {
                    dx: 1.0,
                    dy: 2.0,
                    width: 60.0,
                    height: 60.0,
                },
            }]),
        )
        .may_change_keys());
    }
}
