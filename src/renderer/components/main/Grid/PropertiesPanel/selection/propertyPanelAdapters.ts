import type { NativeLayerBoundsTarget } from '@plugins/runtime/displayElement/pluginElementActions';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type {
  EditorFontFamilyPropertyPatchV1,
  EditorFontStylePropertyPatchV1,
  EditorGraphRuntimePropertyPatchV1,
  EditorKnobRuntimePropertyPatchV1,
  EditorNotePropertyPatchV1,
} from '@src/types/editor';
import { TABS } from '../types';
export { getStatTypeLabel } from '@utils/grid/statTypeLabel';

export const geometryAxisPatch = (
  field: 'dx' | 'dy' | 'width' | 'height',
  value: number,
): NativeLayerBoundsTarget['patch'] => {
  switch (field) {
    case 'dx':
      return { dx: value };
    case 'dy':
      return { dy: value };
    case 'width':
      return { width: value };
    case 'height':
      return { height: value };
  }
};

export const shouldNormalizePropertyTabToStyle = (
  elements: Array<{ type: string }>,
  activeTab: (typeof TABS)[keyof typeof TABS],
): boolean => {
  if (activeTab === TABS.STYLE) return false;
  const hasKey = elements.some((element) => element.type === 'key');
  const hasStat = elements.some((element) => element.type === 'stat');
  const hasGraph = elements.some((element) => element.type === 'graph');

  // 플러그인 혼합도 native 구성 기준으로 정규화
  if (activeTab === TABS.NOTE && hasStat && !hasKey) {
    return true;
  }
  return hasGraph && !hasKey && !hasStat;
};

export const getGraphRuntimePropertyPatch = (
  updates: Partial<GraphItemPosition>,
): EditorGraphRuntimePropertyPatchV1 | null => {
  const keys = Object.keys(updates);
  if (keys.length !== 1) return null;
  if (keys[0] === 'showAvgLine' && typeof updates.showAvgLine === 'boolean') {
    return { property: 'showAvgLine', value: updates.showAvgLine };
  }
  if (
    keys[0] === 'graphAnimationEnabled' &&
    typeof updates.graphAnimationEnabled === 'boolean'
  ) {
    return {
      property: 'graphAnimationEnabled',
      value: updates.graphAnimationEnabled,
    };
  }
  if (
    keys[0] === 'graphSpeed' &&
    Number.isSafeInteger(updates.graphSpeed) &&
    (updates.graphSpeed as number) >= 0 &&
    (updates.graphSpeed as number) <= 4_294_967_295
  ) {
    return { property: 'graphSpeed', value: updates.graphSpeed as number };
  }
  return null;
};

export const getKnobRuntimePropertyPatch = (
  updates: Partial<KnobItemPosition>,
): EditorKnobRuntimePropertyPatchV1 | null => {
  const keys = Object.keys(updates);
  if (keys.length !== 1) return null;
  if (keys[0] === 'reverse' && typeof updates.reverse === 'boolean') {
    return { property: 'reverse', value: updates.reverse };
  }
  if (
    keys[0] === 'sensitivity' &&
    typeof updates.sensitivity === 'number' &&
    Number.isFinite(updates.sensitivity)
  ) {
    return { property: 'sensitivity', value: updates.sensitivity };
  }
  return null;
};

export const getUseInlineStylesPatch = (updates: object): boolean | null => {
  const values = updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  return keys.length === 1 &&
    keys[0] === 'useInlineStyles' &&
    typeof values.useInlineStyles === 'boolean'
    ? values.useInlineStyles
    : null;
};

export const getFontStylePatch = (
  updates: object,
): EditorFontStylePropertyPatchV1 | null => {
  const values = updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  if (keys.length !== 1) return null;
  if (
    keys[0] === 'fontWeight' &&
    Number.isSafeInteger(values.fontWeight) &&
    (values.fontWeight as number) >= 0 &&
    (values.fontWeight as number) <= 4_294_967_295
  ) {
    return { property: 'fontWeight', value: values.fontWeight as number };
  }
  if (keys[0] === 'fontBold' && typeof values.fontBold === 'boolean') {
    return { property: 'fontBold', value: values.fontBold };
  }
  if (keys[0] === 'fontItalic' && typeof values.fontItalic === 'boolean') {
    return { property: 'fontItalic', value: values.fontItalic };
  }
  if (
    keys[0] === 'fontUnderline' &&
    typeof values.fontUnderline === 'boolean'
  ) {
    return { property: 'fontUnderline', value: values.fontUnderline };
  }
  if (
    keys[0] === 'fontStrikethrough' &&
    typeof values.fontStrikethrough === 'boolean'
  ) {
    return { property: 'fontStrikethrough', value: values.fontStrikethrough };
  }
  return null;
};

export const getFontFamilyPatch = (
  updates: object,
): EditorFontFamilyPropertyPatchV1 | null => {
  const values = updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  return keys.length === 1 &&
    keys[0] === 'fontFamily' &&
    typeof values.fontFamily === 'string'
    ? { property: 'fontFamily', value: values.fontFamily }
    : null;
};

export const getNotePropertyPatch = (
  updates: object,
): EditorNotePropertyPatchV1 | null => {
  const values = updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  if (keys.length !== 1) return null;
  if (
    keys[0] === 'noteEffectEnabled' &&
    typeof values.noteEffectEnabled === 'boolean'
  ) {
    return { property: 'noteEffectEnabled', value: values.noteEffectEnabled };
  }
  if (
    keys[0] === 'noteAutoYCorrection' &&
    typeof values.noteAutoYCorrection === 'boolean'
  ) {
    return {
      property: 'noteAutoYCorrection',
      value: values.noteAutoYCorrection,
    };
  }
  if (
    keys[0] === 'noteGlowEnabled' &&
    typeof values.noteGlowEnabled === 'boolean'
  ) {
    return { property: 'noteGlowEnabled', value: values.noteGlowEnabled };
  }
  if (
    keys[0] === 'noteGlowSyncPaint' &&
    typeof values.noteGlowSyncPaint === 'boolean'
  ) {
    return { property: 'noteGlowSyncPaint', value: values.noteGlowSyncPaint };
  }
  if (
    keys[0] === 'noteAlignment' &&
    ['left', 'center', 'right'].includes(values.noteAlignment as string)
  ) {
    return {
      property: 'noteAlignment',
      value: values.noteAlignment as 'left' | 'center' | 'right',
    };
  }
  if (
    keys[0] === 'noteBorderSide' &&
    ['all', 'vertical', 'horizontal'].includes(values.noteBorderSide as string)
  ) {
    return {
      property: 'noteBorderSide',
      value: values.noteBorderSide as 'all' | 'vertical' | 'horizontal',
    };
  }
  return null;
};
