use std::collections::{HashMap, HashSet};

use crate::{
    errors::EditorCommitError,
    models::{
        compact_canonical_rgba, default_counter_animation_builtin_presets,
        note_border_representative_hex, note_gradient_shadow, AppStoreData, CounterAnimationPreset,
        EditorBoundsV1, EditorCounterAnimationPresetIntentV1, EditorCounterFillIntentV1,
        EditorDocumentV1, EditorElementGroupTargetV1, EditorElementPropertyPatchV1,
        EditorElementTypeV1, EditorField, EditorFrozenElementV1, EditorGroupUpdateV1,
        EditorNoteBorderPaintV1, EditorNoteColorV1, EditorNotePaintIntentV1,
        EditorOpResultStatusV1, EditorOpResultV1, EditorOpV1, EditorPaintDescriptorV1,
        EditorPaintGradientV1, EditorShadowLeafPatchV1, EditorTargetGroupV1, EditorZUpdateV1,
        ElementShadowSpec, GradientSpec, ImageMode, ImageTransform, ImageTransformLeafPatchV1,
        KeyPosition, LayerGroupDef, NoteColor, NoteGradientShadow, ReactiveSpritePosition,
        SpriteTransform, IMAGE_TRANSFORM_OFFSET_MAX, IMAGE_TRANSFORM_OFFSET_MIN,
        IMAGE_TRANSFORM_ROTATION_MAX, IMAGE_TRANSFORM_ROTATION_MIN, IMAGE_TRANSFORM_SCALE_MAX,
        IMAGE_TRANSFORM_SCALE_MIN, SHADOW_BLUR_MAX, SHADOW_BLUR_MIN, SHADOW_OFFSET_MAX,
        SHADOW_OFFSET_MIN, SPRITE_TRANSFORM_OFFSET_MAX, SPRITE_TRANSFORM_OFFSET_MIN,
    },
};

use super::editor::{
    validate_document_transition, validate_editor_op_bounds, validate_editor_op_target_type,
};
use super::native_element_id::{validate_document_element_ids, DUPLICATE_ELEMENT_ID};
use super::plugin::{plugin_group_refs_from_store, PluginGroupRefs};

mod property_patch;
mod structural_ops;
mod transition;

use property_patch::*;
use structural_ops::*;

pub(crate) use transition::{
    prepare_editor_ops_transition, prepare_editor_ops_transition_with_plugin_refs,
};

#[derive(Debug)]
pub(crate) struct PreparedEditorOpsTransition {
    pub(crate) current: EditorDocumentV1,
    pub(crate) candidate: EditorDocumentV1,
    pub(crate) scratch: AppStoreData,
    pub(crate) changed_fields: Vec<EditorField>,
    pub(crate) op_results: Vec<EditorOpResultV1>,
}

#[cfg(test)]
mod tests;
