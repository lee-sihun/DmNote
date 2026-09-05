import {
  inheritedPaintMaterialization,
  paintPropertyFields,
} from '@src/types/color';
import {
  isEditorShadowPropertyPatchV1,
  type EditorOpV1,
} from '@src/types/editor';
import {
  isCounterFillPropertyPatchV1,
  projectCounterFillPatch,
} from '@src/types/key/counterFill';
import {
  isNotePaintPropertyPatchV1,
  projectNotePaintPatch,
} from '@src/types/key/notePaint';
import { projectElementShadowPatch } from '@src/types/key/shadows';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/core/elementDefaults';

type PatchElementOp = Extract<EditorOpV1, { kind: 'patchElement' }>;
type SemanticElementPosition = Record<string, unknown> & { id: string };

export type SemanticElementPaintPatch = Extract<
  PatchElementOp['patch'],
  {
    property:
      | 'backgroundPaint'
      | 'activeBackgroundPaint'
      | 'borderPaint'
      | 'activeBorderPaint'
      | 'fontPaint'
      | 'activeFontPaint'
      | 'shadow'
      | 'activeShadow'
      | 'shadowEnabled'
      | 'counterFillIdle'
      | 'counterFillActive'
      | 'notePaint'
      | 'noteGlowPaint'
      | 'noteBorderPaint';
  }
>;

export const projectSemanticElementPaintPatch = (
  position: SemanticElementPosition,
  op: PatchElementOp,
): SemanticElementPosition | undefined => {
  if (
    op.patch.property === 'backgroundPaint' ||
    op.patch.property === 'activeBackgroundPaint' ||
    op.patch.property === 'borderPaint' ||
    op.patch.property === 'activeBorderPaint' ||
    op.patch.property === 'fontPaint' ||
    op.patch.property === 'activeFontPaint'
  ) {
    const field = op.patch.property;
    const paint = op.patch.value;
    const {
      active,
      surface,
      colorField,
      gradientField,
      activeColorField,
      activeGradientField,
    } = paintPropertyFields(field);
    // 물질화 대상 - active 쌍을 가진 요소 (font는 키만)
    const materializes =
      surface === 'font'
        ? op.elementType === 'key'
        : op.elementType === 'key' || op.elementType === 'knob';
    const preservation: Record<string, unknown> = {};
    if (!active && materializes) {
      const inherited = inheritedPaintMaterialization(
        {
          color:
            typeof position[colorField] === 'string'
              ? (position[colorField] as string)
              : undefined,
          gradient: position[gradientField] as never,
        },
        {
          color:
            typeof position[activeColorField] === 'string'
              ? (position[activeColorField] as string)
              : undefined,
          gradient: position[activeGradientField] as never,
        },
      );
      if (inherited) {
        if (inherited.color != null) {
          preservation[activeColorField] = inherited.color;
        }
        if (inherited.gradient) {
          preservation[activeGradientField] = inherited.gradient;
        }
      }
    }
    return {
      ...position,
      ...preservation,
      [colorField]: paint.color,
      [gradientField]: paint.gradient ?? undefined,
    };
  }
  if (isEditorShadowPropertyPatchV1(op.patch)) {
    return {
      ...position,
      ...projectElementShadowPatch({
        position: position as never,
        elementType: op.elementType as 'key' | 'stat' | 'knob',
        patch: op.patch,
        defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
        defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
      }),
    };
  }
  if (isCounterFillPropertyPatchV1(op.patch)) {
    return {
      ...position,
      ...projectCounterFillPatch(position as never, op.patch),
    };
  }
  if (isNotePaintPropertyPatchV1(op.patch)) {
    // position 전달 - {opacity} 단독의 sibling shadow 재계산 (§9-5)
    return {
      ...position,
      ...projectNotePaintPatch(op.patch, position as never),
    };
  }
  return undefined;
};
