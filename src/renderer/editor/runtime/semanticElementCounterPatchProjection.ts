import type { EditorOpV1 } from '@src/types/editor';
import { implicitCounterFontBold } from '@utils/core/fontWeights';

type PatchElementOp = Extract<EditorOpV1, { kind: 'patchElement' }>;
type SemanticElementPosition = Record<string, unknown> & { id: string };

export type SemanticElementCounterPatch = Extract<
  PatchElementOp['patch'],
  {
    property:
      | 'counterEnabled'
      | 'counterAnimationEnabled'
      | 'counterPlacement'
      | 'counterAlign'
      | 'counterAlignMode'
      | 'counterGap'
      | 'counterFontSize'
      | 'counterFontWeight'
      | 'counterFontBold'
      | 'counterFontItalic'
      | 'counterFontUnderline'
      | 'counterFontStrikethrough'
      | 'counterFontFamily'
      | 'counterAnimationPreset';
  }
>;

export const projectSemanticElementCounterPatch = (
  position: SemanticElementPosition,
  op: PatchElementOp,
): SemanticElementPosition | undefined => {
  if (op.patch.property === 'counterEnabled') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: { ...counter, enabled: op.patch.value },
    };
  }
  if (op.patch.property === 'counterAnimationEnabled') {
    const counter = position.counter as Record<string, unknown> | undefined;
    const animation = (counter?.animation ?? {}) as Record<string, unknown>;
    return {
      ...position,
      counter: {
        ...counter,
        animation: {
          ...animation,
          enabled: op.patch.value,
        },
      },
    };
  }
  if (op.patch.property === 'counterPlacement') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: { ...counter, placement: op.patch.value },
    };
  }
  if (op.patch.property === 'counterAlign') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: { ...counter, align: op.patch.value },
    };
  }
  if (op.patch.property === 'counterAlignMode') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: { ...counter, alignMode: op.patch.value },
    };
  }
  if (op.patch.property === 'counterGap') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: { ...counter, gap: op.patch.value },
    };
  }
  if (op.patch.property === 'counterFontSize') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: { ...counter, fontSize: op.patch.value },
    };
  }
  if (op.patch.property === 'counterFontWeight') {
    const counter = position.counter as Record<string, unknown> | undefined;
    // 백엔드와 같은 암묵 Bold 고정 (fontWeights.implicitCounterFontBold)
    return {
      ...position,
      counter: {
        ...counter,
        fontWeight: op.patch.value,
        ...(typeof counter?.fontBold !== 'boolean'
          ? { fontBold: implicitCounterFontBold(counter?.fontWeight) }
          : {}),
      },
    };
  }
  if (op.patch.property === 'counterFontBold') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: { ...counter, fontBold: op.patch.value },
    };
  }
  if (op.patch.property === 'counterFontItalic') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: { ...counter, fontItalic: op.patch.value },
    };
  }
  if (op.patch.property === 'counterFontUnderline') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: {
        ...counter,
        fontUnderline: op.patch.value,
      },
    };
  }
  if (op.patch.property === 'counterFontStrikethrough') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: {
        ...counter,
        fontStrikethrough: op.patch.value,
      },
    };
  }
  if (op.patch.property === 'counterFontFamily') {
    const counter = position.counter as Record<string, unknown> | undefined;
    return {
      ...position,
      counter: {
        ...counter,
        fontFamily: op.patch.value,
      },
    };
  }
  if (op.patch.property === 'counterAnimationPreset') {
    const counter = position.counter as Record<string, unknown> | undefined;
    const animation = (counter?.animation ?? {}) as Record<string, unknown>;
    const intent = op.patch.value;
    return {
      ...position,
      counter: {
        ...counter,
        animation: {
          ...animation,
          ...('applyPresetId' in intent ? { presetId: intent.presetId } : {}),
          ...('bezier' in intent ? { bezier: [...intent.bezier] } : {}),
          ...('scale' in intent ? { scale: intent.scale } : {}),
          ...('durationMs' in intent ? { durationMs: intent.durationMs } : {}),
        },
      },
    };
  }
  return undefined;
};
