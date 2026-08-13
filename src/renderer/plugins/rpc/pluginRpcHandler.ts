/**
 * main 창의 플러그인 RPC 핸들러 (단일 authority 측)
 * 검증 → store 적용 → 응답. 적용 결과는 기존 push 경로가 panel로 재배포
 */

import {
  pluginRpcApi,
  PLUGIN_RPC_PROTOCOL_VERSION,
  type PluginRpcRequestEnvelope,
  type PluginRpcResponse,
} from '@api/modules/pluginRpcApi';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { pluginInstancesApi } from '@api/modules/pluginInstancesApi';
import {
  applyCommittedPluginInstancesProjection,
  notePluginInstancesMutation,
} from '@plugins/runtime/displayElement/instancesUndoSync';
import {
  clearPluginInstancesEditSessions,
  enqueuePluginInstancesCommit,
  rotatePluginInstancesEditSession,
  touchPluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import { normalizePluginInstanceTabId } from '@plugins/runtime/displayElement/instanceLifecycle';
import {
  useHistoryStatusStore,
  syncHistoryStatus,
} from '@stores/data/useHistoryStatusStore';
import {
  getPluginPanelModelRevision,
  flushPluginPanelModelSyncNow,
} from '@utils/plugin/panelModelSync';

import { getPluginAuthorityGeneration } from './pluginRpcClient';
import { noteBackendPluginRevision } from './pluginModelRevision';
import {
  PLUGIN_RPC_OPERATIONS,
  materializePluginElementUpdate,
  type PluginElementUpdatePatch,
} from './pluginElementActions';
import { handlePluginSettingsOperation } from './pluginSettingsSession';
import { deleteFrozenSelection } from '@src/renderer/editor/runtime/deleteFrozenSelection';
import {
  commitLayerDropIntent,
  type LayerDropIntent,
} from '@components/main/Grid/PropertiesPanel/layer/layerReorderIntent';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { isSyntheticElementId } from '@src/renderer/editor/model/elementIdMap';
import type { NativeElementType } from '@src/renderer/editor/model/elementIdMap';
import {
  commitBatchGeometryByIds,
  commitElementGeometryById,
  patchActiveImageByTargets,
  patchActiveTransparentByTargets,
  patchCounterAnimationEnabledByTargets,
  patchCounterAnimationPresetByTargets,
  patchCounterEnabledByTargets,
  patchCounterLayoutByTargets,
  patchCounterStrokeByTargets,
  patchCounterFillByTargets,
  patchFontColorByTargets,
  patchCounterTypographyByTargets,
  patchPaintByTargets,
  patchShadowByTargets,
  patchNotePaintByIds,
  patchStylePropertyByTargets,
  patchElementPropertyById,
  patchFontFamilyByTargets,
  patchInactiveImageByTargets,
  patchIdleTransparentByTargets,
  patchSoundEnabledByIds,
  patchSoundPathByIds,
  patchSoundVolumeByIds,
  patchFontStyleByTargets,
  patchGraphColorsByIds,
  patchGraphPropertiesByIds,
  patchGraphTypesByIds,
  patchKnobPropertiesByIds,
  patchNotePropertiesByIds,
  patchUseInlineStylesByTargets,
  setLayerGroupHidden,
} from '@src/renderer/editor/runtime/elementOps';
import type {
  BatchGeometryDescriptor,
  BatchGeometryTarget,
} from '@src/renderer/editor/runtime/elementOps';
import type {
  EditorElementPropertyPatchV1,
  EditorCounterAnimationPresetIntentV1,
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
  EditorCounterStrokePropertyPatchV1,
  EditorCounterFillPropertyPatchV1,
  EditorFontColorPropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
  EditorFontStylePropertyPatchV1,
  EditorFontFamilyPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorGraphRuntimePropertyPatchV1,
  EditorKnobRuntimePropertyPatchV1,
  EditorNotePropertyPatchV1,
} from '@src/types/editor';
import {
  isEditorPaintPropertyPatchV1,
  isEditorShadowPropertyPatchV1,
} from '@src/types/editor';
import { isNotePaintPropertyPatchV1 } from '@src/types/key/notePaint';
import { isCounterFillPropertyPatchV1 } from '@src/types/key/counterFill';
import { isFontColorPropertyPatchV1 } from '@src/types/key/fontColor';
import type {
  LayerReorderAnchorsWire,
  LayerReorderIntentWire,
} from './pluginElementActions';
import { counterAnimationApi } from '@api/modules/resourceApi';

const failure = (requestId: string, errorCode: string): PluginRpcResponse => ({
  protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION,
  requestId,
  authorityGeneration: getPluginAuthorityGeneration(),
  modelRevision: getPluginPanelModelRevision(),
  ok: false,
  error: {
    code: errorCode,
    message: errorCode,
  },
});

const success = (
  requestId: string,
  payload?: Record<string, unknown>,
): PluginRpcResponse => ({
  protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION,
  requestId,
  authorityGeneration: getPluginAuthorityGeneration(),
  modelRevision: getPluginPanelModelRevision(),
  ok: true,
  ...(payload ? { payload } : {}),
});

const asStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : null;

const LAYER_DELETE_TARGET_TYPES = new Set([
  'key',
  'stat',
  'graph',
  'knob',
  'plugin',
]);
const MAX_LAYER_RPC_TARGETS = 4096;
const MAX_GESTURE_ID_BYTES = 64;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
};

const isCanonicalGestureId = (value: unknown): value is string =>
  typeof value === 'string' &&
  new TextEncoder().encode(value).length <= MAX_GESTURE_ID_BYTES &&
  CANONICAL_UUID_PATTERN.test(value);

const parseNoteNumericStylePropertyPatch = (
  patch: Record<string, unknown>,
): EditorPreviewStylePropertyPatchV1 | null => {
  if (
    hasExactKeys(patch, ['noteOffsetX']) &&
    (patch.noteOffsetX === null ||
      (typeof patch.noteOffsetX === 'number' &&
        Number.isFinite(patch.noteOffsetX) &&
        patch.noteOffsetX >= -500 &&
        patch.noteOffsetX <= 500))
  ) {
    return { noteOffsetX: patch.noteOffsetX as number | null };
  }
  if (
    hasExactKeys(patch, ['noteOffsetY']) &&
    (patch.noteOffsetY === null ||
      (typeof patch.noteOffsetY === 'number' &&
        Number.isFinite(patch.noteOffsetY) &&
        patch.noteOffsetY >= -500 &&
        patch.noteOffsetY <= 500))
  ) {
    return { noteOffsetY: patch.noteOffsetY as number | null };
  }
  if (
    hasExactKeys(patch, ['noteWidth']) &&
    (patch.noteWidth === null ||
      (typeof patch.noteWidth === 'number' &&
        Number.isFinite(patch.noteWidth) &&
        patch.noteWidth > 0))
  ) {
    return { noteWidth: patch.noteWidth as number | null };
  }
  if (
    hasExactKeys(patch, ['noteBorderWidth']) &&
    typeof patch.noteBorderWidth === 'number' &&
    Number.isFinite(patch.noteBorderWidth) &&
    patch.noteBorderWidth >= 0 &&
    patch.noteBorderWidth <= 20
  ) {
    return { noteBorderWidth: patch.noteBorderWidth };
  }
  if (
    hasExactKeys(patch, ['noteBorderRadius']) &&
    typeof patch.noteBorderRadius === 'number' &&
    Number.isFinite(patch.noteBorderRadius) &&
    patch.noteBorderRadius >= 1 &&
    patch.noteBorderRadius <= 100
  ) {
    return { noteBorderRadius: patch.noteBorderRadius };
  }
  return null;
};

const parseCounterAnimationPresetIntent = (
  value: unknown,
): EditorCounterAnimationPresetIntentV1 | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const intent = value as Record<string, unknown>;
  const keys = Object.keys(intent);
  if (
    !keys.includes('presetId') ||
    keys.some(
      (key) =>
        ![
          'presetId',
          'applyPresetId',
          'bezier',
          'scale',
          'durationMs',
        ].includes(key),
    ) ||
    typeof intent.presetId !== 'string' ||
    intent.presetId.length === 0
  ) {
    return null;
  }
  if ('applyPresetId' in intent && intent.applyPresetId !== true) return null;
  if (
    'bezier' in intent &&
    (!Array.isArray(intent.bezier) ||
      intent.bezier.length !== 4 ||
      !intent.bezier.every(
        (entry, index) =>
          typeof entry === 'number' &&
          Number.isFinite(entry) &&
          (index === 0 || index === 2
            ? entry >= 0 && entry <= 1
            : entry >= -2 && entry <= 2),
      ))
  ) {
    return null;
  }
  if (
    'scale' in intent &&
    (typeof intent.scale !== 'number' || !Number.isFinite(intent.scale))
  ) {
    return null;
  }
  if (
    'durationMs' in intent &&
    (!Number.isSafeInteger(intent.durationMs) ||
      (intent.durationMs as number) < 1 ||
      (intent.durationMs as number) > 5000)
  ) {
    return null;
  }
  return intent as unknown as EditorCounterAnimationPresetIntentV1;
};

const parseCounterAnimationUpdateRequest = (
  payload: Record<string, unknown>,
):
  | import('@src/types/key/counterAnimation').CounterAnimationUpdateRequest
  | null => {
  if (!hasExactKeys(payload, ['request'])) return null;
  const value = payload.request;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const request = value as Record<string, unknown>;
  if (
    !hasExactKeys(request, ['id', 'name', 'bezier', 'scale', 'durationMs']) ||
    typeof request.id !== 'string' ||
    request.id.trim().length === 0 ||
    typeof request.name !== 'string' ||
    request.name.trim().length === 0 ||
    !Array.isArray(request.bezier) ||
    request.bezier.length !== 4 ||
    !request.bezier.every(
      (entry, index) =>
        typeof entry === 'number' &&
        Number.isFinite(entry) &&
        (index === 0 || index === 2
          ? entry >= 0 && entry <= 1
          : entry >= -2 && entry <= 2),
    ) ||
    typeof request.scale !== 'number' ||
    !Number.isFinite(request.scale) ||
    !Number.isSafeInteger(request.durationMs) ||
    (request.durationMs as number) < 1 ||
    (request.durationMs as number) > 5000
  ) {
    return null;
  }
  return request as unknown as import('@src/types/key/counterAnimation').CounterAnimationUpdateRequest;
};

const parseCounterAnimationDeleteRequest = (
  payload: Record<string, unknown>,
): string | null =>
  hasExactKeys(payload, ['id']) &&
  typeof payload.id === 'string' &&
  payload.id.trim().length > 0
    ? payload.id
    : null;

const parseLayerDeleteTargets = (
  payload: Record<string, unknown>,
): SelectedElement[] | null => {
  if (!hasExactKeys(payload, ['targets']) || !Array.isArray(payload.targets)) {
    return null;
  }
  if (
    payload.targets.length === 0 ||
    payload.targets.length > MAX_LAYER_RPC_TARGETS
  ) {
    return null;
  }
  const seen = new Set<string>();
  const targets: SelectedElement[] = [];
  for (const value of payload.targets) {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !hasExactKeys(value as Record<string, unknown>, ['elementType', 'id'])
    ) {
      return null;
    }
    const { elementType, id } = value as {
      elementType?: unknown;
      id?: unknown;
    };
    if (
      typeof elementType !== 'string' ||
      !LAYER_DELETE_TARGET_TYPES.has(elementType) ||
      typeof id !== 'string' ||
      id.trim().length === 0 ||
      (elementType !== 'plugin' && isSyntheticElementId(id)) ||
      seen.has(id)
    ) {
      return null;
    }
    seen.add(id);
    targets.push({
      type: elementType as SelectedElement['type'],
      id,
    });
  }
  return targets;
};

interface NativeLayerPropertyTarget {
  elementType: NativeElementType;
  id: string;
  patch: EditorElementPropertyPatchV1;
}

const parseNativeLayerPropertyTarget = (
  value: unknown,
): NativeLayerPropertyTarget | null => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, [
      'elementType',
      'id',
      'patch',
    ])
  ) {
    return null;
  }
  const target = value as Record<string, unknown>;
  if (
    typeof target.elementType !== 'string' ||
    !['key', 'stat', 'graph', 'knob'].includes(target.elementType) ||
    typeof target.id !== 'string' ||
    target.id.trim().length === 0 ||
    isSyntheticElementId(target.id) ||
    target.patch === null ||
    typeof target.patch !== 'object' ||
    Array.isArray(target.patch)
  ) {
    return null;
  }
  const patch = target.patch as Record<string, unknown>;
  const counterAnimationPreset = parseCounterAnimationPresetIntent(
    patch.counterAnimationPreset,
  );
  const paintPatch = isEditorPaintPropertyPatchV1(patch);
  const shadowPatch = isEditorShadowPropertyPatchV1(patch);
  const notePaintPatch = isNotePaintPropertyPatchV1(patch);
  const counterFillPatch = isCounterFillPropertyPatchV1(patch);
  const fontColorPatch = isFontColorPropertyPatchV1(patch);
  const noteNumericStylePatch = parseNoteNumericStylePropertyPatch(patch);
  const patchValid =
    (shadowPatch &&
      target.elementType !== 'graph' &&
      (!('activeShadow' in patch) ||
        target.elementType === 'key' ||
        target.elementType === 'knob')) ||
    (notePaintPatch && target.elementType === 'key') ||
    (counterFillPatch &&
      (target.elementType === 'key' ||
        (!('counterFillActive' in patch) && target.elementType === 'stat'))) ||
    (fontColorPatch &&
      (!('activeFontColor' in patch) ||
        target.elementType === 'key' ||
        target.elementType === 'knob')) ||
    (paintPatch &&
      (!('activeBackgroundPaint' in patch) && !('activeBorderPaint' in patch)
        ? true
        : target.elementType === 'key' || target.elementType === 'knob')) ||
    (hasExactKeys(patch, ['hidden']) && typeof patch.hidden === 'boolean') ||
    (hasExactKeys(patch, ['layerName']) &&
      (typeof patch.layerName === 'string' || patch.layerName === null)) ||
    (hasExactKeys(patch, ['graphType']) &&
      (patch.graphType === 'line' || patch.graphType === 'bar')) ||
    (hasExactKeys(patch, ['graphColor']) &&
      typeof patch.graphColor === 'string') ||
    (hasExactKeys(patch, ['showAvgLine']) &&
      typeof patch.showAvgLine === 'boolean') ||
    (hasExactKeys(patch, ['graphAnimationEnabled']) &&
      typeof patch.graphAnimationEnabled === 'boolean') ||
    (hasExactKeys(patch, ['graphSpeed']) &&
      typeof patch.graphSpeed === 'number' &&
      Number.isSafeInteger(patch.graphSpeed) &&
      patch.graphSpeed >= 0 &&
      patch.graphSpeed <= 4_294_967_295) ||
    (hasExactKeys(patch, ['sensitivity']) &&
      typeof patch.sensitivity === 'number' &&
      Number.isFinite(patch.sensitivity)) ||
    (hasExactKeys(patch, ['reverse']) && typeof patch.reverse === 'boolean') ||
    (hasExactKeys(patch, ['axisId']) && typeof patch.axisId === 'string') ||
    (hasExactKeys(patch, ['displayText']) &&
      typeof patch.displayText === 'string') ||
    (hasExactKeys(patch, ['className']) &&
      typeof patch.className === 'string') ||
    (hasExactKeys(patch, ['borderWidth']) &&
      typeof patch.borderWidth === 'number' &&
      Number.isFinite(patch.borderWidth) &&
      patch.borderWidth >= 0 &&
      patch.borderWidth <= 20) ||
    (hasExactKeys(patch, ['borderRadius']) &&
      typeof patch.borderRadius === 'number' &&
      Number.isFinite(patch.borderRadius) &&
      patch.borderRadius >= 0 &&
      patch.borderRadius <= (target.elementType === 'knob' ? 999 : 100)) ||
    (hasExactKeys(patch, ['fontSize']) &&
      typeof patch.fontSize === 'number' &&
      Number.isFinite(patch.fontSize) &&
      patch.fontSize >= 8 &&
      patch.fontSize <= 72) ||
    (hasExactKeys(patch, ['noteGlowSize']) &&
      target.elementType === 'key' &&
      typeof patch.noteGlowSize === 'number' &&
      Number.isFinite(patch.noteGlowSize) &&
      patch.noteGlowSize >= 0 &&
      patch.noteGlowSize <= 50) ||
    (noteNumericStylePatch !== null && target.elementType === 'key') ||
    (hasExactKeys(patch, ['soundEnabled']) &&
      target.elementType === 'key' &&
      typeof patch.soundEnabled === 'boolean') ||
    (hasExactKeys(patch, ['soundPath']) &&
      target.elementType === 'key' &&
      typeof patch.soundPath === 'string') ||
    (hasExactKeys(patch, ['soundVolume']) &&
      target.elementType === 'key' &&
      typeof patch.soundVolume === 'number' &&
      Number.isFinite(patch.soundVolume) &&
      patch.soundVolume >= 0 &&
      patch.soundVolume <= 200) ||
    (hasExactKeys(patch, ['inactiveImage']) &&
      typeof patch.inactiveImage === 'string') ||
    (hasExactKeys(patch, ['activeImage']) &&
      (target.elementType === 'key' || target.elementType === 'knob') &&
      typeof patch.activeImage === 'string') ||
    (hasExactKeys(patch, ['idleTransparent']) &&
      typeof patch.idleTransparent === 'boolean') ||
    (hasExactKeys(patch, ['activeTransparent']) &&
      (target.elementType === 'key' || target.elementType === 'knob') &&
      typeof patch.activeTransparent === 'boolean') ||
    (hasExactKeys(patch, ['idleImageFit']) &&
      ['cover', 'contain', 'fill', 'none'].includes(
        patch.idleImageFit as string,
      )) ||
    (hasExactKeys(patch, ['activeImageFit']) &&
      (target.elementType === 'key' || target.elementType === 'knob') &&
      ['cover', 'contain', 'fill', 'none'].includes(
        patch.activeImageFit as string,
      )) ||
    (hasExactKeys(patch, ['counterEnabled']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      typeof patch.counterEnabled === 'boolean') ||
    (hasExactKeys(patch, ['counterAnimationEnabled']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      typeof patch.counterAnimationEnabled === 'boolean') ||
    (hasExactKeys(patch, ['counterPlacement']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      (patch.counterPlacement === 'inside' ||
        patch.counterPlacement === 'outside')) ||
    (hasExactKeys(patch, ['counterAlign']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      ['top', 'bottom', 'left', 'right'].includes(
        patch.counterAlign as string,
      )) ||
    (hasExactKeys(patch, ['counterAlignMode']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      (patch.counterAlignMode === 'center' ||
        patch.counterAlignMode === 'between')) ||
    (hasExactKeys(patch, ['counterGap']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      Number.isSafeInteger(patch.counterGap) &&
      (patch.counterGap as number) >= 0 &&
      (patch.counterGap as number) <= 4_294_967_295) ||
    (hasExactKeys(patch, ['counterFontSize']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      Number.isSafeInteger(patch.counterFontSize) &&
      (patch.counterFontSize as number) >= 8 &&
      (patch.counterFontSize as number) <= 72) ||
    (hasExactKeys(patch, ['counterFontWeight']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      Number.isSafeInteger(patch.counterFontWeight) &&
      (patch.counterFontWeight as number) >= 100 &&
      (patch.counterFontWeight as number) <= 900) ||
    (hasExactKeys(patch, ['counterFontItalic']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      typeof patch.counterFontItalic === 'boolean') ||
    (hasExactKeys(patch, ['counterFontUnderline']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      typeof patch.counterFontUnderline === 'boolean') ||
    (hasExactKeys(patch, ['counterFontStrikethrough']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      typeof patch.counterFontStrikethrough === 'boolean') ||
    (hasExactKeys(patch, ['counterFontFamily']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      typeof patch.counterFontFamily === 'string') ||
    (hasExactKeys(patch, ['counterStrokeIdle']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      typeof patch.counterStrokeIdle === 'string') ||
    (hasExactKeys(patch, ['counterStrokeActive']) &&
      target.elementType === 'key' &&
      typeof patch.counterStrokeActive === 'string') ||
    (hasExactKeys(patch, ['counterAnimationPreset']) &&
      (target.elementType === 'key' || target.elementType === 'stat') &&
      counterAnimationPreset !== null) ||
    (hasExactKeys(patch, ['useInlineStyles']) &&
      typeof patch.useInlineStyles === 'boolean') ||
    (hasExactKeys(patch, ['fontWeight']) &&
      typeof patch.fontWeight === 'number' &&
      Number.isSafeInteger(patch.fontWeight) &&
      patch.fontWeight >= 0 &&
      patch.fontWeight <= 4_294_967_295) ||
    (hasExactKeys(patch, ['fontItalic']) &&
      typeof patch.fontItalic === 'boolean') ||
    (hasExactKeys(patch, ['fontUnderline']) &&
      typeof patch.fontUnderline === 'boolean') ||
    (hasExactKeys(patch, ['fontStrikethrough']) &&
      typeof patch.fontStrikethrough === 'boolean') ||
    (hasExactKeys(patch, ['fontFamily']) &&
      typeof patch.fontFamily === 'string') ||
    (hasExactKeys(patch, ['noteEffectEnabled']) &&
      target.elementType === 'key' &&
      typeof patch.noteEffectEnabled === 'boolean') ||
    (hasExactKeys(patch, ['noteAutoYCorrection']) &&
      target.elementType === 'key' &&
      typeof patch.noteAutoYCorrection === 'boolean') ||
    (hasExactKeys(patch, ['noteGlowEnabled']) &&
      target.elementType === 'key' &&
      typeof patch.noteGlowEnabled === 'boolean') ||
    (hasExactKeys(patch, ['noteAlignment']) &&
      target.elementType === 'key' &&
      ['left', 'center', 'right'].includes(patch.noteAlignment as string)) ||
    (hasExactKeys(patch, ['noteBorderSide']) &&
      target.elementType === 'key' &&
      ['all', 'vertical', 'horizontal'].includes(
        patch.noteBorderSide as string,
      )) ||
    (hasExactKeys(patch, ['statType']) &&
      target.elementType === 'stat' &&
      ['kps', 'kpsAvg', 'kpsMax', 'total'].includes(patch.statType as string));
  const graphOnlyPatch =
    hasExactKeys(patch, ['graphType']) ||
    hasExactKeys(patch, ['graphColor']) ||
    hasExactKeys(patch, ['showAvgLine']) ||
    hasExactKeys(patch, ['graphAnimationEnabled']) ||
    hasExactKeys(patch, ['graphSpeed']);
  const knobOnlyPatch =
    hasExactKeys(patch, ['sensitivity']) ||
    hasExactKeys(patch, ['reverse']) ||
    hasExactKeys(patch, ['axisId']);
  if (
    !patchValid ||
    (graphOnlyPatch && target.elementType !== 'graph') ||
    (knobOnlyPatch && target.elementType !== 'knob')
  ) {
    return null;
  }
  return target as unknown as NativeLayerPropertyTarget;
};

interface NativeLayerBoundsTarget {
  elementType: NativeElementType;
  id: string;
  patch: Partial<Record<'dx' | 'dy' | 'width' | 'height', number>>;
  gestureId?: string;
}

const parseNativeLayerBoundsTarget = (
  payload: Record<string, unknown>,
): NativeLayerBoundsTarget | null => {
  if (!hasExactKeys(payload, ['target'])) return null;
  const value = payload.target;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const target = value as Record<string, unknown>;
  const targetKeys = Object.keys(target);
  if (
    (targetKeys.length !== 3 && targetKeys.length !== 4) ||
    !['elementType', 'id', 'patch'].every((key) => key in target) ||
    targetKeys.some(
      (key) => !['elementType', 'id', 'patch', 'gestureId'].includes(key),
    ) ||
    typeof target.elementType !== 'string' ||
    !['key', 'stat', 'graph', 'knob'].includes(target.elementType) ||
    typeof target.id !== 'string' ||
    target.id.trim().length === 0 ||
    isSyntheticElementId(target.id) ||
    (target.gestureId !== undefined &&
      !isCanonicalGestureId(target.gestureId)) ||
    (target.gestureId !== undefined &&
      target.elementType !== 'key' &&
      target.elementType !== 'stat') ||
    target.patch === null ||
    typeof target.patch !== 'object' ||
    Array.isArray(target.patch)
  ) {
    return null;
  }
  const patch = target.patch as Record<string, unknown>;
  const fields = Object.keys(patch);
  if (
    fields.length !== 1 ||
    !['dx', 'dy', 'width', 'height'].includes(fields[0]) ||
    !Number.isFinite(patch[fields[0]]) ||
    ((fields[0] === 'width' || fields[0] === 'height') &&
      (patch[fields[0]] as number) <= 0)
  ) {
    return null;
  }
  return target as unknown as NativeLayerBoundsTarget;
};

const parseBatchGeometryDescriptor = (
  payload: Record<string, unknown>,
): { descriptor: BatchGeometryDescriptor; gestureId?: string } | null => {
  const payloadKeys = Object.keys(payload);
  if (
    (payloadKeys.length !== 1 && payloadKeys.length !== 2) ||
    !('descriptor' in payload) ||
    payloadKeys.some((key) => !['descriptor', 'gestureId'].includes(key)) ||
    ('gestureId' in payload && !isCanonicalGestureId(payload.gestureId)) ||
    payload.descriptor === null ||
    typeof payload.descriptor !== 'object' ||
    Array.isArray(payload.descriptor)
  ) {
    return null;
  }
  const descriptor = payload.descriptor as Record<string, unknown>;
  if (
    !hasExactKeys(descriptor, ['mode', 'targets', 'operation']) ||
    typeof descriptor.mode !== 'string' ||
    descriptor.mode.length === 0 ||
    new TextEncoder().encode(descriptor.mode).length > 128 ||
    !Array.isArray(descriptor.targets) ||
    descriptor.targets.length === 0 ||
    descriptor.targets.length > MAX_LAYER_RPC_TARGETS ||
    descriptor.operation === null ||
    typeof descriptor.operation !== 'object' ||
    Array.isArray(descriptor.operation)
  ) {
    return null;
  }
  const targets: BatchGeometryTarget[] = [];
  const seen = new Set<string>();
  for (const value of descriptor.targets) {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !hasExactKeys(value as Record<string, unknown>, ['type', 'id'])
    ) {
      return null;
    }
    const target = value as Record<string, unknown>;
    if (
      typeof target.type !== 'string' ||
      !['key', 'stat', 'graph', 'knob'].includes(target.type) ||
      typeof target.id !== 'string' ||
      target.id.length === 0 ||
      isSyntheticElementId(target.id) ||
      seen.has(target.id)
    ) {
      return null;
    }
    seen.add(target.id);
    targets.push(target as unknown as BatchGeometryTarget);
  }
  const operation = descriptor.operation as Record<string, unknown>;
  const validOperation =
    (hasExactKeys(operation, ['kind', 'direction']) &&
      operation.kind === 'align' &&
      ['left', 'centerH', 'right', 'top', 'centerV', 'bottom'].includes(
        operation.direction as string,
      )) ||
    (hasExactKeys(operation, ['kind', 'direction']) &&
      operation.kind === 'distribute' &&
      ['horizontal', 'vertical'].includes(operation.direction as string)) ||
    (hasExactKeys(operation, ['kind', 'spacing']) &&
      operation.kind === 'spacing' &&
      typeof operation.spacing === 'number' &&
      Number.isFinite(operation.spacing)) ||
    (hasExactKeys(operation, ['kind', 'dimension', 'value']) &&
      operation.kind === 'resize' &&
      ['width', 'height'].includes(operation.dimension as string) &&
      typeof operation.value === 'number' &&
      Number.isFinite(operation.value) &&
      operation.value > 0);
  if (!validOperation) return null;
  const minimum =
    operation.kind === 'distribute' ? 3 : operation.kind === 'resize' ? 1 : 2;
  if (targets.length < minimum) return null;
  return {
    descriptor: {
      mode: descriptor.mode,
      targets,
      operation: operation as BatchGeometryDescriptor['operation'],
    },
    ...(typeof payload.gestureId === 'string'
      ? { gestureId: payload.gestureId }
      : {}),
  };
};

type NativeLayerPropertyRequest =
  | { kind: 'single'; target: NativeLayerPropertyTarget }
  | {
      kind: 'useInlineStylesBatch';
      targets: Array<{ elementType: NativeElementType; id: string }>;
      useInlineStyles: boolean;
    }
  | {
      kind: 'fontStyleBatch';
      targets: Array<{ elementType: NativeElementType; id: string }>;
      patch: EditorFontStylePropertyPatchV1;
    }
  | {
      kind: 'fontFamilyBatch';
      targets: Array<{ elementType: NativeElementType; id: string }>;
      patch: EditorFontFamilyPropertyPatchV1;
    }
  | {
      kind: 'paintBatch';
      targets: Array<{ elementType: NativeElementType; id: string }>;
      patch: EditorPaintPropertyPatchV1;
    }
  | {
      kind: 'shadowBatch';
      targets: Array<{
        elementType: 'key' | 'stat' | 'knob';
        id: string;
      }>;
      patch: EditorShadowPropertyPatchV1;
    }
  | {
      kind: 'notePaintBatch';
      ids: string[];
      patch: EditorNotePaintPropertyPatchV1;
      gestureId?: string;
    }
  | {
      kind: 'stylePropertyBatch';
      targets: Array<{ elementType: NativeElementType; id: string }>;
      patch: EditorPreviewStylePropertyPatchV1;
      gestureId?: string;
    }
  | {
      kind: 'inactiveImageBatch';
      targets: Array<{ elementType: NativeElementType; id: string }>;
      inactiveImage: string;
    }
  | {
      kind: 'soundEnabledBatch';
      ids: string[];
      soundEnabled: boolean;
    }
  | {
      kind: 'soundPathBatch';
      ids: string[];
      soundPath: string;
    }
  | {
      kind: 'soundVolumeBatch';
      ids: string[];
      soundVolume: number;
      gestureId?: string;
    }
  | {
      kind: 'activeImageBatch';
      targets: Array<{ elementType: 'key' | 'knob'; id: string }>;
      activeImage: string;
    }
  | {
      kind: 'idleTransparentBatch';
      targets: Array<{ elementType: NativeElementType; id: string }>;
      idleTransparent: boolean;
    }
  | {
      kind: 'activeTransparentBatch';
      targets: Array<{ elementType: 'key' | 'knob'; id: string }>;
      activeTransparent: boolean;
    }
  | {
      kind: 'counterAnimationPresetBatch';
      targets: Array<{ elementType: 'key' | 'stat'; id: string }>;
      intent: EditorCounterAnimationPresetIntentV1;
    }
  | {
      kind: 'counterBooleanBatch';
      targets: Array<{ elementType: 'key' | 'stat'; id: string }>;
      patch: { counterEnabled: boolean } | { counterAnimationEnabled: boolean };
    }
  | {
      kind: 'counterLayoutBatch';
      targets: Array<{ elementType: 'key' | 'stat'; id: string }>;
      patch: EditorCounterLayoutPropertyPatchV1;
    }
  | {
      kind: 'counterTypographyBatch';
      targets: Array<{ elementType: 'key' | 'stat'; id: string }>;
      patch: EditorCounterTypographyPropertyPatchV1;
    }
  | {
      kind: 'counterStrokeBatch';
      targets: Array<{ elementType: 'key' | 'stat'; id: string }>;
      patch: EditorCounterStrokePropertyPatchV1;
    }
  | {
      kind: 'counterFillBatch';
      targets: Array<{ elementType: 'key' | 'stat'; id: string }>;
      patch: EditorCounterFillPropertyPatchV1;
    }
  | {
      kind: 'fontColorBatch';
      targets: Array<{ elementType: NativeElementType; id: string }>;
      patch: EditorFontColorPropertyPatchV1;
      gestureId?: string;
    }
  | {
      kind: 'notePropertyBatch';
      ids: string[];
      patch: EditorNotePropertyPatchV1;
    }
  | { kind: 'graphTypeBatch'; ids: string[]; graphType: 'line' | 'bar' }
  | { kind: 'graphColorBatch'; ids: string[]; graphColor: string }
  | {
      kind: 'graphPropertyBatch';
      ids: string[];
      patch: EditorGraphRuntimePropertyPatchV1;
    }
  | {
      kind: 'knobPropertyBatch';
      ids: string[];
      patch: EditorKnobRuntimePropertyPatchV1;
    };

const parseNativeLayerPropertyRequest = (
  payload: Record<string, unknown>,
): NativeLayerPropertyRequest | null => {
  if (hasExactKeys(payload, ['target'])) {
    const target = parseNativeLayerPropertyTarget(payload.target);
    return target ? { kind: 'single', target } : null;
  }
  const payloadKeys = Object.keys(payload);
  if (
    (payloadKeys.length !== 2 && payloadKeys.length !== 3) ||
    !['targets', 'patch'].every((key) => key in payload) ||
    payloadKeys.some(
      (key) => !['targets', 'patch', 'gestureId'].includes(key),
    ) ||
    ('gestureId' in payload && !isCanonicalGestureId(payload.gestureId)) ||
    !Array.isArray(payload.targets) ||
    payload.targets.length === 0 ||
    payload.targets.length > MAX_LAYER_RPC_TARGETS ||
    payload.patch === null ||
    typeof payload.patch !== 'object' ||
    Array.isArray(payload.patch)
  ) {
    return null;
  }
  const patch = payload.patch as Record<string, unknown>;
  const graphType =
    hasExactKeys(patch, ['graphType']) &&
    (patch.graphType === 'line' || patch.graphType === 'bar')
      ? patch.graphType
      : null;
  const graphColor =
    hasExactKeys(patch, ['graphColor']) && typeof patch.graphColor === 'string'
      ? patch.graphColor
      : null;
  const graphRuntimePatch: EditorGraphRuntimePropertyPatchV1 | null =
    hasExactKeys(patch, ['showAvgLine']) &&
    typeof patch.showAvgLine === 'boolean'
      ? { showAvgLine: patch.showAvgLine }
      : hasExactKeys(patch, ['graphAnimationEnabled']) &&
        typeof patch.graphAnimationEnabled === 'boolean'
      ? { graphAnimationEnabled: patch.graphAnimationEnabled }
      : hasExactKeys(patch, ['graphSpeed']) &&
        typeof patch.graphSpeed === 'number' &&
        Number.isSafeInteger(patch.graphSpeed) &&
        patch.graphSpeed >= 0 &&
        patch.graphSpeed <= 4_294_967_295
      ? { graphSpeed: patch.graphSpeed }
      : null;
  const knobRuntimePatch: EditorKnobRuntimePropertyPatchV1 | null =
    hasExactKeys(patch, ['sensitivity']) &&
    typeof patch.sensitivity === 'number' &&
    Number.isFinite(patch.sensitivity)
      ? { sensitivity: patch.sensitivity }
      : hasExactKeys(patch, ['reverse']) && typeof patch.reverse === 'boolean'
      ? { reverse: patch.reverse }
      : null;
  const useInlineStyles =
    hasExactKeys(patch, ['useInlineStyles']) &&
    typeof patch.useInlineStyles === 'boolean'
      ? patch.useInlineStyles
      : null;
  const fontStylePatch: EditorFontStylePropertyPatchV1 | null =
    hasExactKeys(patch, ['fontWeight']) &&
    typeof patch.fontWeight === 'number' &&
    Number.isSafeInteger(patch.fontWeight) &&
    patch.fontWeight >= 0 &&
    patch.fontWeight <= 4_294_967_295
      ? { fontWeight: patch.fontWeight }
      : hasExactKeys(patch, ['fontItalic']) &&
        typeof patch.fontItalic === 'boolean'
      ? { fontItalic: patch.fontItalic }
      : hasExactKeys(patch, ['fontUnderline']) &&
        typeof patch.fontUnderline === 'boolean'
      ? { fontUnderline: patch.fontUnderline }
      : hasExactKeys(patch, ['fontStrikethrough']) &&
        typeof patch.fontStrikethrough === 'boolean'
      ? { fontStrikethrough: patch.fontStrikethrough }
      : null;
  const fontFamilyPatch: EditorFontFamilyPropertyPatchV1 | null =
    hasExactKeys(patch, ['fontFamily']) && typeof patch.fontFamily === 'string'
      ? { fontFamily: patch.fontFamily }
      : null;
  const noteNumericStylePatch = parseNoteNumericStylePropertyPatch(patch);
  const paintPatch = isEditorPaintPropertyPatchV1(patch) ? patch : null;
  const shadowPatch = isEditorShadowPropertyPatchV1(patch) ? patch : null;
  const notePaintPatch = isNotePaintPropertyPatchV1(patch) ? patch : null;
  const stylePropertyPatch: EditorPreviewStylePropertyPatchV1 | null =
    hasExactKeys(patch, ['displayText']) &&
    typeof patch.displayText === 'string'
      ? { displayText: patch.displayText }
      : hasExactKeys(patch, ['className']) &&
        typeof patch.className === 'string'
      ? { className: patch.className }
      : hasExactKeys(patch, ['borderWidth']) &&
        typeof patch.borderWidth === 'number' &&
        Number.isFinite(patch.borderWidth) &&
        patch.borderWidth >= 0 &&
        patch.borderWidth <= 20
      ? { borderWidth: patch.borderWidth }
      : hasExactKeys(patch, ['borderRadius']) &&
        typeof patch.borderRadius === 'number' &&
        Number.isFinite(patch.borderRadius) &&
        patch.borderRadius >= 0 &&
        patch.borderRadius <= 999
      ? { borderRadius: patch.borderRadius }
      : hasExactKeys(patch, ['fontSize']) &&
        typeof patch.fontSize === 'number' &&
        Number.isFinite(patch.fontSize) &&
        patch.fontSize >= 8 &&
        patch.fontSize <= 72
      ? { fontSize: patch.fontSize }
      : hasExactKeys(patch, ['noteGlowSize']) &&
        typeof patch.noteGlowSize === 'number' &&
        Number.isFinite(patch.noteGlowSize) &&
        patch.noteGlowSize >= 0 &&
        patch.noteGlowSize <= 50
      ? { noteGlowSize: patch.noteGlowSize }
      : noteNumericStylePatch !== null
      ? noteNumericStylePatch
      : null;
  const inactiveImage =
    hasExactKeys(patch, ['inactiveImage']) &&
    typeof patch.inactiveImage === 'string'
      ? patch.inactiveImage
      : null;
  const soundPath =
    hasExactKeys(patch, ['soundPath']) && typeof patch.soundPath === 'string'
      ? patch.soundPath
      : null;
  const soundEnabled =
    hasExactKeys(patch, ['soundEnabled']) &&
    typeof patch.soundEnabled === 'boolean'
      ? patch.soundEnabled
      : null;
  const soundVolume =
    hasExactKeys(patch, ['soundVolume']) &&
    typeof patch.soundVolume === 'number' &&
    Number.isFinite(patch.soundVolume) &&
    patch.soundVolume >= 0 &&
    patch.soundVolume <= 200
      ? patch.soundVolume
      : null;
  const activeImage =
    hasExactKeys(patch, ['activeImage']) &&
    typeof patch.activeImage === 'string'
      ? patch.activeImage
      : null;
  const idleTransparent =
    hasExactKeys(patch, ['idleTransparent']) &&
    typeof patch.idleTransparent === 'boolean'
      ? patch.idleTransparent
      : null;
  const activeTransparent =
    hasExactKeys(patch, ['activeTransparent']) &&
    typeof patch.activeTransparent === 'boolean'
      ? patch.activeTransparent
      : null;
  const counterAnimationPreset = hasExactKeys(patch, ['counterAnimationPreset'])
    ? parseCounterAnimationPresetIntent(patch.counterAnimationPreset)
    : null;
  const counterBooleanPatch =
    hasExactKeys(patch, ['counterEnabled']) &&
    typeof patch.counterEnabled === 'boolean'
      ? { counterEnabled: patch.counterEnabled }
      : hasExactKeys(patch, ['counterAnimationEnabled']) &&
        typeof patch.counterAnimationEnabled === 'boolean'
      ? { counterAnimationEnabled: patch.counterAnimationEnabled }
      : null;
  const counterLayoutPatch: EditorCounterLayoutPropertyPatchV1 | null =
    hasExactKeys(patch, ['counterPlacement']) &&
    (patch.counterPlacement === 'inside' ||
      patch.counterPlacement === 'outside')
      ? { counterPlacement: patch.counterPlacement }
      : hasExactKeys(patch, ['counterAlign']) &&
        ['top', 'bottom', 'left', 'right'].includes(
          patch.counterAlign as string,
        )
      ? {
          counterAlign: patch.counterAlign as
            | 'top'
            | 'bottom'
            | 'left'
            | 'right',
        }
      : hasExactKeys(patch, ['counterAlignMode']) &&
        (patch.counterAlignMode === 'center' ||
          patch.counterAlignMode === 'between')
      ? { counterAlignMode: patch.counterAlignMode }
      : hasExactKeys(patch, ['counterGap']) &&
        Number.isSafeInteger(patch.counterGap) &&
        (patch.counterGap as number) >= 0 &&
        (patch.counterGap as number) <= 4_294_967_295
      ? { counterGap: patch.counterGap as number }
      : null;
  const counterTypographyPatch: EditorCounterTypographyPropertyPatchV1 | null =
    hasExactKeys(patch, ['counterFontSize']) &&
    Number.isSafeInteger(patch.counterFontSize) &&
    (patch.counterFontSize as number) >= 8 &&
    (patch.counterFontSize as number) <= 72
      ? { counterFontSize: patch.counterFontSize as number }
      : hasExactKeys(patch, ['counterFontWeight']) &&
        Number.isSafeInteger(patch.counterFontWeight) &&
        (patch.counterFontWeight as number) >= 100 &&
        (patch.counterFontWeight as number) <= 900
      ? { counterFontWeight: patch.counterFontWeight as number }
      : hasExactKeys(patch, ['counterFontItalic']) &&
        typeof patch.counterFontItalic === 'boolean'
      ? { counterFontItalic: patch.counterFontItalic }
      : hasExactKeys(patch, ['counterFontUnderline']) &&
        typeof patch.counterFontUnderline === 'boolean'
      ? { counterFontUnderline: patch.counterFontUnderline }
      : hasExactKeys(patch, ['counterFontStrikethrough']) &&
        typeof patch.counterFontStrikethrough === 'boolean'
      ? { counterFontStrikethrough: patch.counterFontStrikethrough }
      : hasExactKeys(patch, ['counterFontFamily']) &&
        typeof patch.counterFontFamily === 'string'
      ? { counterFontFamily: patch.counterFontFamily }
      : null;
  const counterStrokePatch: EditorCounterStrokePropertyPatchV1 | null =
    hasExactKeys(patch, ['counterStrokeIdle']) &&
    typeof patch.counterStrokeIdle === 'string'
      ? { counterStrokeIdle: patch.counterStrokeIdle }
      : hasExactKeys(patch, ['counterStrokeActive']) &&
        typeof patch.counterStrokeActive === 'string'
      ? { counterStrokeActive: patch.counterStrokeActive }
      : null;
  const counterFillPatch: EditorCounterFillPropertyPatchV1 | null =
    isCounterFillPropertyPatchV1(patch) ? patch : null;
  const fontColorPatch: EditorFontColorPropertyPatchV1 | null =
    isFontColorPropertyPatchV1(patch) ? patch : null;
  const notePropertyPatch: EditorNotePropertyPatchV1 | null =
    hasExactKeys(patch, ['noteEffectEnabled']) &&
    typeof patch.noteEffectEnabled === 'boolean'
      ? { noteEffectEnabled: patch.noteEffectEnabled }
      : hasExactKeys(patch, ['noteAutoYCorrection']) &&
        typeof patch.noteAutoYCorrection === 'boolean'
      ? { noteAutoYCorrection: patch.noteAutoYCorrection }
      : hasExactKeys(patch, ['noteGlowEnabled']) &&
        typeof patch.noteGlowEnabled === 'boolean'
      ? { noteGlowEnabled: patch.noteGlowEnabled }
      : hasExactKeys(patch, ['noteAlignment']) &&
        ['left', 'center', 'right'].includes(patch.noteAlignment as string)
      ? {
          noteAlignment: patch.noteAlignment as 'left' | 'center' | 'right',
        }
      : hasExactKeys(patch, ['noteBorderSide']) &&
        ['all', 'vertical', 'horizontal'].includes(
          patch.noteBorderSide as string,
        )
      ? {
          noteBorderSide: patch.noteBorderSide as
            | 'all'
            | 'vertical'
            | 'horizontal',
        }
      : null;
  if (
    graphType === null &&
    graphColor === null &&
    graphRuntimePatch === null &&
    knobRuntimePatch === null &&
    useInlineStyles === null &&
    fontStylePatch === null &&
    fontFamilyPatch === null &&
    paintPatch === null &&
    shadowPatch === null &&
    notePaintPatch === null &&
    stylePropertyPatch === null &&
    inactiveImage === null &&
    soundEnabled === null &&
    soundPath === null &&
    soundVolume === null &&
    activeImage === null &&
    idleTransparent === null &&
    activeTransparent === null &&
    counterBooleanPatch === null &&
    counterLayoutPatch === null &&
    counterTypographyPatch === null &&
    counterStrokePatch === null &&
    counterFillPatch === null &&
    fontColorPatch === null &&
    counterAnimationPreset === null &&
    notePropertyPatch === null
  ) {
    return null;
  }
  if (
    'gestureId' in payload &&
    soundVolume === null &&
    stylePropertyPatch === null &&
    notePaintPatch === null &&
    fontColorPatch === null
  ) {
    return null;
  }
  const elementType =
    useInlineStyles !== null ||
    fontStylePatch !== null ||
    fontFamilyPatch !== null ||
    paintPatch !== null ||
    shadowPatch !== null ||
    stylePropertyPatch !== null ||
    inactiveImage !== null
      ? null
      : idleTransparent !== null
      ? null
      : soundEnabled !== null
      ? 'key'
      : soundPath !== null
      ? 'key'
      : soundVolume !== null
      ? 'key'
      : notePaintPatch !== null
      ? 'key'
      : activeImage !== null
      ? 'active-capable'
      : activeTransparent !== null
      ? 'active-capable'
      : counterBooleanPatch !== null
      ? 'counter-capable'
      : counterLayoutPatch !== null
      ? 'counter-capable'
      : counterTypographyPatch !== null
      ? 'counter-capable'
      : counterStrokePatch !== null
      ? 'counter-capable'
      : counterFillPatch !== null
      ? 'counter-capable'
      : fontColorPatch !== null
      ? null
      : counterAnimationPreset !== null
      ? 'counter-capable'
      : notePropertyPatch !== null
      ? 'key'
      : knobRuntimePatch === null
      ? 'graph'
      : 'knob';
  const ids: string[] = [];
  const targets: Array<{ elementType: NativeElementType; id: string }> = [];
  const seen = new Set<string>();
  for (const value of payload.targets) {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !hasExactKeys(value as Record<string, unknown>, ['elementType', 'id'])
    ) {
      return null;
    }
    const target = value as Record<string, unknown>;
    if (
      typeof target.elementType !== 'string' ||
      !['key', 'stat', 'graph', 'knob'].includes(target.elementType) ||
      (elementType === 'active-capable' &&
        target.elementType !== 'key' &&
        target.elementType !== 'knob') ||
      (elementType === 'counter-capable' &&
        target.elementType !== 'key' &&
        target.elementType !== 'stat') ||
      (counterStrokePatch !== null &&
        'counterStrokeActive' in counterStrokePatch &&
        target.elementType !== 'key') ||
      (counterFillPatch !== null &&
        'counterFillActive' in counterFillPatch &&
        target.elementType !== 'key') ||
      (fontColorPatch !== null &&
        'activeFontColor' in fontColorPatch &&
        target.elementType !== 'key' &&
        target.elementType !== 'knob') ||
      (stylePropertyPatch !== null &&
        'borderRadius' in stylePropertyPatch &&
        stylePropertyPatch.borderRadius > 100 &&
        target.elementType !== 'knob') ||
      (stylePropertyPatch !== null &&
        'noteGlowSize' in stylePropertyPatch &&
        target.elementType !== 'key') ||
      (paintPatch !== null &&
        ('activeBackgroundPaint' in paintPatch ||
          'activeBorderPaint' in paintPatch) &&
        target.elementType !== 'key' &&
        target.elementType !== 'knob') ||
      (shadowPatch !== null &&
        (target.elementType === 'graph' ||
          ('activeShadow' in shadowPatch &&
            target.elementType !== 'key' &&
            target.elementType !== 'knob'))) ||
      (notePaintPatch !== null && target.elementType !== 'key') ||
      (stylePropertyPatch !== null &&
        ('noteOffsetX' in stylePropertyPatch ||
          'noteOffsetY' in stylePropertyPatch ||
          'noteWidth' in stylePropertyPatch ||
          'noteBorderWidth' in stylePropertyPatch ||
          'noteBorderRadius' in stylePropertyPatch) &&
        target.elementType !== 'key') ||
      (elementType !== null &&
        elementType !== 'active-capable' &&
        elementType !== 'counter-capable' &&
        target.elementType !== elementType) ||
      typeof target.id !== 'string' ||
      target.id.trim().length === 0 ||
      isSyntheticElementId(target.id) ||
      seen.has(target.id)
    ) {
      return null;
    }
    seen.add(target.id);
    ids.push(target.id);
    targets.push({
      elementType: target.elementType as NativeElementType,
      id: target.id,
    });
  }
  if (useInlineStyles !== null) {
    return { kind: 'useInlineStylesBatch', targets, useInlineStyles };
  }
  if (fontStylePatch !== null) {
    return { kind: 'fontStyleBatch', targets, patch: fontStylePatch };
  }
  if (fontFamilyPatch !== null) {
    return { kind: 'fontFamilyBatch', targets, patch: fontFamilyPatch };
  }
  if (paintPatch !== null) {
    return { kind: 'paintBatch', targets, patch: paintPatch };
  }
  if (shadowPatch !== null) {
    return {
      kind: 'shadowBatch',
      targets: targets as Array<{
        elementType: 'key' | 'stat' | 'knob';
        id: string;
      }>,
      patch: shadowPatch,
    };
  }
  if (notePaintPatch !== null) {
    return {
      kind: 'notePaintBatch',
      ids,
      patch: notePaintPatch,
      ...(typeof payload.gestureId === 'string'
        ? { gestureId: payload.gestureId }
        : {}),
    };
  }
  if (stylePropertyPatch !== null) {
    return {
      kind: 'stylePropertyBatch',
      targets,
      patch: stylePropertyPatch,
      ...(typeof payload.gestureId === 'string'
        ? { gestureId: payload.gestureId }
        : {}),
    };
  }
  if (inactiveImage !== null) {
    return { kind: 'inactiveImageBatch', targets, inactiveImage };
  }
  if (soundEnabled !== null) {
    return { kind: 'soundEnabledBatch', ids, soundEnabled };
  }
  if (soundPath !== null) {
    return { kind: 'soundPathBatch', ids, soundPath };
  }
  if (soundVolume !== null) {
    return {
      kind: 'soundVolumeBatch',
      ids,
      soundVolume,
      ...(typeof payload.gestureId === 'string'
        ? { gestureId: payload.gestureId }
        : {}),
    };
  }
  if (activeImage !== null) {
    return {
      kind: 'activeImageBatch',
      targets: targets as Array<{ elementType: 'key' | 'knob'; id: string }>,
      activeImage,
    };
  }
  if (idleTransparent !== null) {
    return { kind: 'idleTransparentBatch', targets, idleTransparent };
  }
  if (activeTransparent !== null) {
    return {
      kind: 'activeTransparentBatch',
      targets: targets as Array<{ elementType: 'key' | 'knob'; id: string }>,
      activeTransparent,
    };
  }
  if (counterAnimationPreset !== null) {
    return {
      kind: 'counterAnimationPresetBatch',
      targets: targets as Array<{
        elementType: 'key' | 'stat';
        id: string;
      }>,
      intent: counterAnimationPreset,
    };
  }
  if (counterBooleanPatch !== null) {
    return {
      kind: 'counterBooleanBatch',
      targets: targets as Array<{
        elementType: 'key' | 'stat';
        id: string;
      }>,
      patch: counterBooleanPatch,
    };
  }
  if (counterLayoutPatch !== null) {
    return {
      kind: 'counterLayoutBatch',
      targets: targets as Array<{
        elementType: 'key' | 'stat';
        id: string;
      }>,
      patch: counterLayoutPatch,
    };
  }
  if (counterTypographyPatch !== null) {
    return {
      kind: 'counterTypographyBatch',
      targets: targets as Array<{
        elementType: 'key' | 'stat';
        id: string;
      }>,
      patch: counterTypographyPatch,
    };
  }
  if (counterStrokePatch !== null) {
    return {
      kind: 'counterStrokeBatch',
      targets: targets as Array<{
        elementType: 'key' | 'stat';
        id: string;
      }>,
      patch: counterStrokePatch,
    };
  }
  if (counterFillPatch !== null) {
    return {
      kind: 'counterFillBatch',
      targets: targets as Array<{
        elementType: 'key' | 'stat';
        id: string;
      }>,
      patch: counterFillPatch,
    };
  }
  if (fontColorPatch !== null) {
    return {
      kind: 'fontColorBatch',
      targets,
      patch: fontColorPatch,
      ...(typeof payload.gestureId === 'string'
        ? { gestureId: payload.gestureId }
        : {}),
    };
  }
  if (notePropertyPatch !== null) {
    return { kind: 'notePropertyBatch', ids, patch: notePropertyPatch };
  }
  if (graphType !== null) return { kind: 'graphTypeBatch', ids, graphType };
  if (graphColor !== null) {
    return { kind: 'graphColorBatch', ids, graphColor };
  }
  if (graphRuntimePatch !== null) {
    return { kind: 'graphPropertyBatch', ids, patch: graphRuntimePatch };
  }
  return { kind: 'knobPropertyBatch', ids, patch: knobRuntimePatch! };
};

const MAX_LAYER_REORDER_IDS = 4096;
const MAX_LAYER_MODE_BYTES = 128;
const MAX_LAYER_GROUP_ID_BYTES = 256;
const textBytes = (value: string): number =>
  new TextEncoder().encode(value).length;
const validWireId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const validMode = (value: unknown): value is string =>
  validWireId(value) && textBytes(value) <= MAX_LAYER_MODE_BYTES;
const validGroupId = (value: unknown): value is string =>
  validWireId(value) && textBytes(value) <= MAX_LAYER_GROUP_ID_BYTES;
const validNullableId = (value: unknown): value is string | null =>
  value === null || validWireId(value);

const parseLayerGroupVisibility = (
  payload: Record<string, unknown>,
): { mode: string; groupId: string; hidden: boolean } | null => {
  if (
    !hasExactKeys(payload, ['mode', 'groupId', 'hidden']) ||
    !validMode(payload.mode) ||
    !validGroupId(payload.groupId) ||
    typeof payload.hidden !== 'boolean'
  ) {
    return null;
  }
  return payload as { mode: string; groupId: string; hidden: boolean };
};

const parseLayerReorderAnchors = (
  value: unknown,
): LayerReorderAnchorsWire | null => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, [
      'toDisplayIndex',
      'targetGroupId',
      'anchorBeforeId',
      'anchorAfterId',
      'anchorHeaderGroupId',
      'anchorBeforeHeaderGroupId',
      'anchorAfterHeaderGroupId',
      'boundary',
    ])
  ) {
    return null;
  }
  const anchors = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(anchors.toDisplayIndex) ||
    (anchors.toDisplayIndex as number) < 0 ||
    !validNullableId(anchors.targetGroupId) ||
    !validNullableId(anchors.anchorBeforeId) ||
    !validNullableId(anchors.anchorAfterId) ||
    !validNullableId(anchors.anchorHeaderGroupId) ||
    !validNullableId(anchors.anchorBeforeHeaderGroupId) ||
    !validNullableId(anchors.anchorAfterHeaderGroupId) ||
    ![null, 'top', 'bottom'].includes(anchors.boundary as never)
  ) {
    return null;
  }
  if (
    [
      anchors.targetGroupId,
      anchors.anchorHeaderGroupId,
      anchors.anchorBeforeHeaderGroupId,
      anchors.anchorAfterHeaderGroupId,
    ].some((id) => typeof id === 'string' && !validGroupId(id))
  ) {
    return null;
  }
  return anchors as unknown as LayerReorderAnchorsWire;
};

const parseStableLayerIds = (value: unknown): string[] | null => {
  if (
    !Array.isArray(value) ||
    value.length > MAX_LAYER_REORDER_IDS ||
    value.some((id) => !validWireId(id))
  ) {
    return null;
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) return null;
  return ids;
};

const parseLayerReorderDescriptor = (
  payload: Record<string, unknown>,
): LayerReorderIntentWire | null => {
  if (!hasExactKeys(payload, ['descriptor'])) return null;
  const value = payload.descriptor;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const descriptor = value as Record<string, unknown>;
  const anchors = parseLayerReorderAnchors(descriptor.anchors);
  if (!anchors || !validMode(descriptor.mode)) return null;
  if (descriptor.kind === 'items') {
    if (
      !hasExactKeys(descriptor, [
        'kind',
        'mode',
        'draggedIds',
        'collapsedGroupIds',
        'anchors',
        'preserveFullGroups',
      ]) ||
      typeof descriptor.preserveFullGroups !== 'boolean'
    ) {
      return null;
    }
    const draggedIds = parseStableLayerIds(descriptor.draggedIds);
    const collapsedGroupIds = parseStableLayerIds(descriptor.collapsedGroupIds);
    if (
      !draggedIds ||
      draggedIds.length === 0 ||
      !collapsedGroupIds ||
      collapsedGroupIds.some((id) => !validGroupId(id))
    ) {
      return null;
    }
    return {
      kind: 'items',
      mode: descriptor.mode,
      draggedIds,
      collapsedGroupIds,
      anchors,
      preserveFullGroups: descriptor.preserveFullGroups,
    };
  }
  if (descriptor.kind === 'group') {
    if (
      !hasExactKeys(descriptor, [
        'kind',
        'mode',
        'groupId',
        'extraIds',
        'collapsedGroupIds',
        'anchors',
      ]) ||
      !validGroupId(descriptor.groupId)
    ) {
      return null;
    }
    const extraIds = parseStableLayerIds(descriptor.extraIds);
    const collapsedGroupIds = parseStableLayerIds(descriptor.collapsedGroupIds);
    if (
      !extraIds ||
      !collapsedGroupIds ||
      collapsedGroupIds.some((id) => !validGroupId(id))
    ) {
      return null;
    }
    return {
      kind: 'group',
      mode: descriptor.mode,
      groupId: descriptor.groupId,
      extraIds,
      collapsedGroupIds,
      anchors,
    };
  }
  return null;
};

const toLayerDropIntent = (
  descriptor: LayerReorderIntentWire,
): LayerDropIntent => ({
  ...descriptor,
  collapsedGroupIds: [...descriptor.collapsedGroupIds],
  anchors: {
    toDisplayIndex: descriptor.anchors.toDisplayIndex,
    targetGroupId: descriptor.anchors.targetGroupId ?? undefined,
    anchorBeforeId: descriptor.anchors.anchorBeforeId,
    anchorAfterId: descriptor.anchors.anchorAfterId,
    anchorHeaderGroupId: descriptor.anchors.anchorHeaderGroupId,
    anchorBeforeHeaderGroupId: descriptor.anchors.anchorBeforeHeaderGroupId,
    anchorAfterHeaderGroupId: descriptor.anchors.anchorAfterHeaderGroupId,
    boundary: descriptor.anchors.boundary ?? undefined,
  },
});

// 영속 필드(SavedPluginInstance 구성원)를 건드리는 patch만 canonical commit 대상
const PERSISTED_PATCH_KEYS = new Set([
  'position',
  'measuredSize',
  'settings',
  'tabId',
  'hidden',
  'zIndex',
]);

const MIN_PLUGIN_Z_INDEX = -2_147_483_648;
const MAX_PLUGIN_Z_INDEX = 2_147_483_647;

const isValidPluginZIndex = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= MIN_PLUGIN_Z_INDEX &&
  value <= MAX_PLUGIN_Z_INDEX;

const toSavedInstances = (elements: PluginDisplayElementInternal[]) =>
  elements.map((el) => ({
    position: el.position,
    settings: el.settings as Record<string, unknown> | undefined,
    measuredSize: el.measuredSize,
    tabId: normalizePluginInstanceTabId(el.tabId),
    hidden: el.hidden === true,
    zIndex: el.zIndex,
  }));

/**
 * canonical commit-first (C4) - 성공해야만 호출자가 projection을 적용
 * 실패 시 이미 커밋된 플러그인은 canonical pull로 재수렴
 */
const commitPluginInstances = async (
  pluginId: string,
  instances: ReturnType<typeof toSavedInstances>,
  authorityGeneration: number,
  rpcRequestId: string,
  gestureId?: string,
): Promise<boolean> => {
  const mutationId = crypto.randomUUID();
  notePluginInstancesMutation(mutationId);
  try {
    const result = await pluginInstancesApi.commit(
      {
        pluginId,
        instances,
        mutationId,
        gestureId: gestureId ?? touchPluginInstancesEditSession(pluginId),
        observedHistoryEpoch: useHistoryStatusStore.getState().historyEpoch,
        // 요청을 접수한 시점의 generation 고정 - 큐 대기 중 reset이 끼어들면
        // Rust admit이 거절해 이전 세대 요청이 새 runtime을 변경하지 못함
        authorityGeneration,
      },
      rpcRequestId,
    );
    noteBackendPluginRevision(result.modelRevision);
    return true;
  } catch (error) {
    console.error(`[Plugin ${pluginId}] Panel mutation commit failed:`, error);
    if (String(error).includes('HISTORY_EPOCH_CONFLICT')) {
      void syncHistoryStatus();
    }
    return false;
  }
};

interface PersistedElementUpdate {
  fullId: string;
  patch: Pick<PluginDisplayElementInternal, 'hidden'> | { zIndex: number };
}

const commitPersistedElementUpdates = async (
  updates: PersistedElementUpdate[],
  requestGeneration: number,
  rpcRequestId: string,
  generationLive: () => boolean,
): Promise<string | null> => {
  const store = usePluginDisplayElementStore.getState();
  const updatesByPlugin = new Map<string, PersistedElementUpdate[]>();
  updates.forEach((update) => {
    const target = store.elements.find((el) => el.fullId === update.fullId);
    if (!target) return;
    const pluginUpdates = updatesByPlugin.get(target.pluginId) ?? [];
    pluginUpdates.push(update);
    updatesByPlugin.set(target.pluginId, pluginUpdates);
  });

  const gestureIds = new Map<string, string>();
  updatesByPlugin.forEach((_, pluginId) => {
    gestureIds.set(pluginId, rotatePluginInstancesEditSession(pluginId));
  });

  for (const [pluginId, pluginUpdates] of updatesByPlugin) {
    const errorCode = await enqueuePluginInstancesCommit(pluginId, async () => {
      if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
      const liveStore = usePluginDisplayElementStore.getState();
      const patchesById = new Map(
        pluginUpdates.map(({ fullId, patch }) => [fullId, patch]),
      );
      const prospective = liveStore.elements
        .filter((el) => el.pluginId === pluginId)
        .map((el) => {
          const patch = patchesById.get(el.fullId);
          return patch ? { ...el, ...patch } : el;
        });
      const committed = await commitPluginInstances(
        pluginId,
        toSavedInstances(prospective),
        requestGeneration,
        rpcRequestId,
        gestureIds.get(pluginId),
      );
      if (!committed) return 'INSTANCES_COMMIT_FAILED';
      if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
      applyCommittedPluginInstancesProjection(pluginId, () => {
        const currentStore = usePluginDisplayElementStore.getState();
        pluginUpdates.forEach(({ fullId, patch }) => {
          if (
            currentStore.elements.some(
              (element) =>
                element.pluginId === pluginId && element.fullId === fullId,
            )
          ) {
            currentStore.updateElement(fullId, patch);
          }
        });
      });
      return null;
    });
    if (errorCode) return errorCode;
  }

  return null;
};

// commit-first가 필요한 op의 비동기 실행 (update의 영속 patch, delete)
const executePersistedOperation = async (
  operation: string,
  payload: Record<string, unknown>,
  requestGeneration: number,
  rpcRequestId: string,
): Promise<string | null> => {
  const store = usePluginDisplayElementStore.getState();
  // 큐 실행 전후로 세대 재검증 - reset을 가로지른 작업은 projection 없이 폐기
  const generationLive = () =>
    requestGeneration === getPluginAuthorityGeneration();

  if (operation === PLUGIN_RPC_OPERATIONS.setHidden) {
    const targets = payload.targets;
    if (
      !Array.isArray(targets) ||
      !targets.every(
        (target) =>
          target !== null &&
          typeof target === 'object' &&
          typeof (target as { fullId?: unknown }).fullId === 'string' &&
          typeof (target as { hidden?: unknown }).hidden === 'boolean',
      )
    ) {
      return 'INVALID_PAYLOAD';
    }
    return commitPersistedElementUpdates(
      (targets as Array<{ fullId: string; hidden: boolean }>).map(
        ({ fullId, hidden }) => ({ fullId, patch: { hidden } }),
      ),
      requestGeneration,
      rpcRequestId,
      generationLive,
    );
  }

  if (operation === PLUGIN_RPC_OPERATIONS.setZIndexes) {
    const entries = payload.entries;
    if (
      !Array.isArray(entries) ||
      !entries.every(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof (entry as { fullId?: unknown }).fullId === 'string' &&
          isValidPluginZIndex((entry as { zIndex?: unknown }).zIndex),
      )
    ) {
      return 'INVALID_PAYLOAD';
    }
    return commitPersistedElementUpdates(
      (entries as Array<{ fullId: string; zIndex: number }>).map(
        ({ fullId, zIndex }) => ({ fullId, patch: { zIndex } }),
      ),
      requestGeneration,
      rpcRequestId,
      generationLive,
    );
  }

  if (operation === PLUGIN_RPC_OPERATIONS.update) {
    const fullId = payload.fullId;
    const patch = payload.patch;
    if (
      typeof fullId !== 'string' ||
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch)
    ) {
      return 'INVALID_PAYLOAD';
    }
    const target = store.elements.find((el) => el.fullId === fullId);
    if (!target) return 'ELEMENT_NOT_FOUND';

    const typedPatch = patch as PluginElementUpdatePatch;
    // prospective는 큐 실행 시점에 구성 - main debounce commit과 stale 스냅샷 경합 방지
    return enqueuePluginInstancesCommit(target.pluginId, async () => {
      if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
      const liveStore = usePluginDisplayElementStore.getState();
      const live = liveStore.elements.find((el) => el.fullId === fullId);
      if (!live) return 'ELEMENT_NOT_FOUND';
      const materializedPatch = materializePluginElementUpdate(
        live,
        typedPatch,
      );
      const prospective = liveStore.elements
        .filter((el) => el.definitionId === live.definitionId)
        .map((el) =>
          el.fullId === fullId ? { ...el, ...materializedPatch } : el,
        );
      const committed = await commitPluginInstances(
        live.pluginId,
        toSavedInstances(prospective),
        requestGeneration,
        rpcRequestId,
      );
      if (!committed) return 'INSTANCES_COMMIT_FAILED';
      if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
      applyCommittedPluginInstancesProjection(live.pluginId, () => {
        usePluginDisplayElementStore
          .getState()
          .updateElement(fullId, materializedPatch);
      });
      return null;
    });
  }

  if (operation === PLUGIN_RPC_OPERATIONS.remove) {
    const fullIds = asStringArray(payload.fullIds);
    if (!fullIds) return 'INVALID_PAYLOAD';
    const targets = store.elements.filter((el) => fullIds.includes(el.fullId));
    const byDefinition = new Map<string, string>();
    targets.forEach((el) => byDefinition.set(el.definitionId, el.pluginId));
    const gestureIds = new Map<string, string>();
    byDefinition.forEach((pluginId) => {
      if (!gestureIds.has(pluginId)) {
        gestureIds.set(pluginId, rotatePluginInstancesEditSession(pluginId));
      }
    });

    // 플러그인 단위로 commit 성공 직후 projection 적용 - 부분 실패도 플러그인별 정합 유지
    for (const [definitionId, pluginId] of byDefinition) {
      const errorCode = await enqueuePluginInstancesCommit(
        pluginId,
        async () => {
          if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
          const currentStore = usePluginDisplayElementStore.getState();
          const remainingForDef = currentStore.elements.filter(
            (el) =>
              el.definitionId === definitionId && !fullIds.includes(el.fullId),
          );
          const committed = await commitPluginInstances(
            pluginId,
            toSavedInstances(remainingForDef),
            requestGeneration,
            rpcRequestId,
            gestureIds.get(pluginId),
          );
          if (!committed) return 'INSTANCES_COMMIT_FAILED';
          if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
          // commit await 중 reload 등이 store를 바꿨을 수 있으므로 최신 상태에 적용
          // (캡처 시점 elements를 쓰면 제거된 요소를 되살림)
          applyCommittedPluginInstancesProjection(pluginId, () => {
            const storeNow = usePluginDisplayElementStore.getState();
            storeNow.setElements(
              storeNow.elements.filter(
                (el) =>
                  el.definitionId !== definitionId ||
                  !fullIds.includes(el.fullId),
              ),
            );
          });
          return null;
        },
      );
      if (errorCode) return errorCode;
    }
    return null;
  }

  return 'UNSUPPORTED_OPERATION';
};

const isPersistedOperation = (
  operation: string,
  payload: Record<string, unknown>,
): boolean => {
  if (
    operation === PLUGIN_RPC_OPERATIONS.remove ||
    operation === PLUGIN_RPC_OPERATIONS.setHidden ||
    operation === PLUGIN_RPC_OPERATIONS.setZIndexes
  ) {
    return true;
  }
  if (operation !== PLUGIN_RPC_OPERATIONS.update) return false;
  const patch = payload.patch;
  if (!patch || typeof patch !== 'object') return false;
  return Object.keys(patch).some((key) => PERSISTED_PATCH_KEYS.has(key));
};

const executeOperation = (
  operation: string,
  payload: Record<string, unknown>,
): string | null => {
  const store = usePluginDisplayElementStore.getState();

  if (operation === PLUGIN_RPC_OPERATIONS.update) {
    const fullId = payload.fullId;
    const patch = payload.patch;
    if (
      typeof fullId !== 'string' ||
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch)
    ) {
      return 'INVALID_PAYLOAD';
    }
    const element = store.elements.find(
      (candidate) => candidate.fullId === fullId,
    );
    if (!element) return 'ELEMENT_NOT_FOUND';
    store.updateElement(
      fullId,
      materializePluginElementUpdate(
        element,
        patch as PluginElementUpdatePatch,
      ),
    );
    return null;
  }

  return 'UNSUPPORTED_OPERATION';
};

const handleRequest = (envelope: PluginRpcRequestEnvelope) => {
  const respond = (response: PluginRpcResponse) => {
    void pluginRpcApi
      .respond(envelope.sourceWindowLabel, response)
      .catch((error) => {
        console.error('Failed to send plugin RPC response', error);
      });
  };

  if (envelope.protocolVersion !== PLUGIN_RPC_PROTOCOL_VERSION) {
    respond(failure(envelope.requestId, 'PROTOCOL_MISMATCH'));
    return;
  }
  if (envelope.authorityGeneration !== getPluginAuthorityGeneration()) {
    respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
    return;
  }

  // settings 세션 op는 모델 revision이 아니라 sessionId+seq로 게이트 (C3)
  if (envelope.operation.startsWith('settings:')) {
    const errorCode = handlePluginSettingsOperation(
      envelope.operation,
      envelope.payload,
    );
    respond(
      errorCode
        ? failure(envelope.requestId, errorCode)
        : success(envelope.requestId),
    );
    return;
  }

  // 패널 미러가 낡은 모델 기준으로 보낸 mutation은 거절 - 재조회 유도
  if (envelope.expectedModelRevision < getPluginPanelModelRevision()) {
    respond(failure(envelope.requestId, 'MODEL_REVISION_STALE'));
    return;
  }

  if (envelope.operation === PLUGIN_RPC_OPERATIONS.deleteLayerSelection) {
    const targets = parseLayerDeleteTargets(envelope.payload);
    if (!targets) {
      respond(failure(envelope.requestId, 'INVALID_PAYLOAD'));
      return;
    }
    const requestGeneration = envelope.authorityGeneration;
    const generationLive = () =>
      requestGeneration === getPluginAuthorityGeneration();
    if (!generationLive()) {
      respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
      return;
    }
    void deleteFrozenSelection(
      targets,
      useKeyStore.getState().selectedKeyType,
      {
        expectedAuthorityGeneration: requestGeneration,
        propagateErrors: true,
      },
    )
      .then(() => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        flushPluginPanelModelSyncNow();
        respond(success(envelope.requestId));
      })
      .catch((error) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        console.error('Failed to delete panel layer selection', error);
        respond(failure(envelope.requestId, 'DELETE_SELECTION_FAILED'));
      });
    return;
  }

  if (envelope.operation === PLUGIN_RPC_OPERATIONS.reorderLayerSelection) {
    const descriptor = parseLayerReorderDescriptor(envelope.payload);
    if (!descriptor) {
      respond(failure(envelope.requestId, 'INVALID_PAYLOAD'));
      return;
    }
    const requestGeneration = envelope.authorityGeneration;
    const generationLive = () =>
      requestGeneration === getPluginAuthorityGeneration();
    void commitLayerDropIntent(toLayerDropIntent(descriptor), {
      expectedAuthorityGeneration: requestGeneration,
    })
      .then(() => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        flushPluginPanelModelSyncNow();
        respond(success(envelope.requestId));
      })
      .catch((error) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        console.error('Failed to reorder panel layer selection', error);
        respond(failure(envelope.requestId, 'REORDER_SELECTION_FAILED'));
      });
    return;
  }

  if (
    envelope.operation === PLUGIN_RPC_OPERATIONS.updateCounterAnimationPreset ||
    envelope.operation === PLUGIN_RPC_OPERATIONS.deleteCounterAnimationPreset
  ) {
    const updateRequest =
      envelope.operation === PLUGIN_RPC_OPERATIONS.updateCounterAnimationPreset
        ? parseCounterAnimationUpdateRequest(envelope.payload)
        : null;
    const deleteId =
      envelope.operation === PLUGIN_RPC_OPERATIONS.deleteCounterAnimationPreset
        ? parseCounterAnimationDeleteRequest(envelope.payload)
        : null;
    if (updateRequest === null && deleteId === null) {
      respond(failure(envelope.requestId, 'INVALID_PAYLOAD'));
      return;
    }
    const requestGeneration = envelope.authorityGeneration;
    const generationLive = () =>
      requestGeneration === getPluginAuthorityGeneration();
    if (!generationLive()) {
      respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
      return;
    }
    const options = {
      preflight: () => {
        if (!generationLive()) {
          throw new Error('plugin authority generation changed');
        }
      },
    };
    const persisted = updateRequest
      ? counterAnimationApi.update(updateRequest, options)
      : counterAnimationApi.remove(deleteId!, options);
    void persisted
      .then((result) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        flushPluginPanelModelSyncNow();
        respond(
          success(
            envelope.requestId,
            structuredClone(result) as unknown as Record<string, unknown>,
          ),
        );
      })
      .catch((error) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        console.error('Failed to mutate counter animation preset', error);
        respond(
          failure(envelope.requestId, 'COUNTER_ANIMATION_MUTATION_FAILED'),
        );
      });
    return;
  }

  if (envelope.operation === PLUGIN_RPC_OPERATIONS.patchLayerProperty) {
    const request = parseNativeLayerPropertyRequest(envelope.payload);
    if (!request) {
      respond(failure(envelope.requestId, 'INVALID_PAYLOAD'));
      return;
    }
    const requestGeneration = envelope.authorityGeneration;
    const generationLive = () =>
      requestGeneration === getPluginAuthorityGeneration();
    if (!generationLive()) {
      respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
      return;
    }
    const options = {
      preflight: () => {
        if (!generationLive()) {
          throw new Error('plugin authority generation changed');
        }
      },
    };
    const persisted = (() => {
      if (request.kind === 'single') {
        if (isEditorPaintPropertyPatchV1(request.target.patch)) {
          return patchPaintByTargets(
            [
              {
                elementType: request.target.elementType,
                id: request.target.id,
              },
            ],
            request.target.patch,
            options,
          );
        }
        if (isEditorShadowPropertyPatchV1(request.target.patch)) {
          return patchShadowByTargets(
            [
              {
                elementType: request.target.elementType as
                  | 'key'
                  | 'stat'
                  | 'knob',
                id: request.target.id,
              },
            ],
            request.target.patch,
            options,
          );
        }
        if (isNotePaintPropertyPatchV1(request.target.patch)) {
          return patchNotePaintByIds(
            [request.target.id],
            request.target.patch,
            options,
          );
        }
        if (isCounterFillPropertyPatchV1(request.target.patch)) {
          return patchCounterFillByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch,
            options,
          );
        }
        if (isFontColorPropertyPatchV1(request.target.patch)) {
          return patchFontColorByTargets(
            [
              {
                elementType: request.target.elementType,
                id: request.target.id,
              },
            ],
            request.target.patch,
            options,
          );
        }
        if (
          'counterPlacement' in request.target.patch ||
          'counterAlign' in request.target.patch ||
          'counterAlignMode' in request.target.patch ||
          'counterGap' in request.target.patch
        ) {
          return patchCounterLayoutByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch as EditorCounterLayoutPropertyPatchV1,
            options,
          );
        }
        if (
          'counterFontSize' in request.target.patch ||
          'counterFontWeight' in request.target.patch ||
          'counterFontItalic' in request.target.patch ||
          'counterFontUnderline' in request.target.patch ||
          'counterFontStrikethrough' in request.target.patch ||
          'counterFontFamily' in request.target.patch
        ) {
          return patchCounterTypographyByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch as EditorCounterTypographyPropertyPatchV1,
            options,
          );
        }
        if (
          'counterStrokeIdle' in request.target.patch ||
          'counterStrokeActive' in request.target.patch
        ) {
          return patchCounterStrokeByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch as EditorCounterStrokePropertyPatchV1,
            options,
          );
        }
        if ('soundEnabled' in request.target.patch) {
          return patchSoundEnabledByIds(
            [request.target.id],
            request.target.patch.soundEnabled,
            options,
          );
        }
        if ('counterEnabled' in request.target.patch) {
          return patchCounterEnabledByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch.counterEnabled,
            options,
          );
        }
        if ('counterAnimationEnabled' in request.target.patch) {
          return patchCounterAnimationEnabledByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch.counterAnimationEnabled,
            options,
          );
        }
        if ('counterAnimationPreset' in request.target.patch) {
          return patchCounterAnimationPresetByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch.counterAnimationPreset,
            options,
          );
        }
        return patchElementPropertyById(
          request.target.elementType,
          request.target.id,
          request.target.patch,
          options,
        );
      }
      if (request.kind === 'graphTypeBatch') {
        return patchGraphTypesByIds(request.ids, request.graphType, options);
      }
      if (request.kind === 'graphColorBatch') {
        return patchGraphColorsByIds(request.ids, request.graphColor, options);
      }
      if (request.kind === 'graphPropertyBatch') {
        return patchGraphPropertiesByIds(request.ids, request.patch, options);
      }
      if (request.kind === 'useInlineStylesBatch') {
        return patchUseInlineStylesByTargets(
          request.targets,
          request.useInlineStyles,
          options,
        );
      }
      if (request.kind === 'fontStyleBatch') {
        return patchFontStyleByTargets(request.targets, request.patch, options);
      }
      if (request.kind === 'fontFamilyBatch') {
        return patchFontFamilyByTargets(
          request.targets,
          request.patch,
          options,
        );
      }
      if (request.kind === 'paintBatch') {
        return patchPaintByTargets(request.targets, request.patch, options);
      }
      if (request.kind === 'shadowBatch') {
        return patchShadowByTargets(request.targets, request.patch, options);
      }
      if (request.kind === 'notePaintBatch') {
        return patchNotePaintByIds(request.ids, request.patch, {
          ...options,
          ...(request.gestureId ? { gestureId: request.gestureId } : {}),
        });
      }
      if (request.kind === 'stylePropertyBatch') {
        return patchStylePropertyByTargets(request.targets, request.patch, {
          ...options,
          ...(request.gestureId ? { gestureId: request.gestureId } : {}),
        });
      }
      if (request.kind === 'inactiveImageBatch') {
        return patchInactiveImageByTargets(
          request.targets,
          request.inactiveImage,
          options,
        );
      }
      if (request.kind === 'soundEnabledBatch') {
        return patchSoundEnabledByIds(
          request.ids,
          request.soundEnabled,
          options,
        );
      }
      if (request.kind === 'soundPathBatch') {
        return patchSoundPathByIds(request.ids, request.soundPath, options);
      }
      if (request.kind === 'soundVolumeBatch') {
        return patchSoundVolumeByIds(request.ids, request.soundVolume, {
          ...options,
          ...(request.gestureId ? { gestureId: request.gestureId } : {}),
        });
      }
      if (request.kind === 'activeImageBatch') {
        return patchActiveImageByTargets(
          request.targets,
          request.activeImage,
          options,
        );
      }
      if (request.kind === 'idleTransparentBatch') {
        return patchIdleTransparentByTargets(
          request.targets,
          request.idleTransparent,
          options,
        );
      }
      if (request.kind === 'activeTransparentBatch') {
        return patchActiveTransparentByTargets(
          request.targets,
          request.activeTransparent,
          options,
        );
      }
      if (request.kind === 'counterAnimationPresetBatch') {
        return patchCounterAnimationPresetByTargets(
          request.targets,
          request.intent,
          options,
        );
      }
      if (request.kind === 'counterBooleanBatch') {
        return 'counterEnabled' in request.patch
          ? patchCounterEnabledByTargets(
              request.targets,
              request.patch.counterEnabled,
              options,
            )
          : patchCounterAnimationEnabledByTargets(
              request.targets,
              request.patch.counterAnimationEnabled,
              options,
            );
      }
      if (request.kind === 'counterLayoutBatch') {
        return patchCounterLayoutByTargets(
          request.targets,
          request.patch,
          options,
        );
      }
      if (request.kind === 'counterTypographyBatch') {
        return patchCounterTypographyByTargets(
          request.targets,
          request.patch,
          options,
        );
      }
      if (request.kind === 'counterStrokeBatch') {
        return patchCounterStrokeByTargets(
          request.targets,
          request.patch,
          options,
        );
      }
      if (request.kind === 'counterFillBatch') {
        return patchCounterFillByTargets(
          request.targets,
          request.patch,
          options,
        );
      }
      if (request.kind === 'fontColorBatch') {
        return patchFontColorByTargets(request.targets, request.patch, {
          ...options,
          ...(request.gestureId ? { gestureId: request.gestureId } : {}),
        });
      }
      if (request.kind === 'notePropertyBatch') {
        return patchNotePropertiesByIds(request.ids, request.patch, options);
      }
      return patchKnobPropertiesByIds(request.ids, request.patch, options);
    })();
    void persisted
      .then(() => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        respond(success(envelope.requestId));
      })
      .catch((error) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        console.error('Failed to patch panel native layer property', error);
        respond(failure(envelope.requestId, 'PATCH_LAYER_PROPERTY_FAILED'));
      });
    return;
  }

  if (envelope.operation === PLUGIN_RPC_OPERATIONS.setLayerGroupVisibility) {
    const request = parseLayerGroupVisibility(envelope.payload);
    if (!request) {
      respond(failure(envelope.requestId, 'INVALID_PAYLOAD'));
      return;
    }
    const requestGeneration = envelope.authorityGeneration;
    const generationLive = () =>
      requestGeneration === getPluginAuthorityGeneration();
    if (!generationLive()) {
      respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
      return;
    }
    void setLayerGroupHidden(request.mode, request.groupId, request.hidden, {
      preflight: () => {
        if (!generationLive()) {
          throw new Error('plugin authority generation changed');
        }
      },
    })
      .then((applied) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        if (!applied) {
          respond(failure(envelope.requestId, 'PATCH_LAYER_PROPERTY_FAILED'));
          return;
        }
        respond(success(envelope.requestId));
      })
      .catch((error) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        console.error('Failed to set panel layer group visibility', error);
        respond(failure(envelope.requestId, 'PATCH_LAYER_PROPERTY_FAILED'));
      });
    return;
  }

  if (envelope.operation === PLUGIN_RPC_OPERATIONS.setLayerBounds) {
    const target = parseNativeLayerBoundsTarget(envelope.payload);
    if (!target) {
      respond(failure(envelope.requestId, 'INVALID_PAYLOAD'));
      return;
    }
    const requestGeneration = envelope.authorityGeneration;
    const generationLive = () =>
      requestGeneration === getPluginAuthorityGeneration();
    if (!generationLive()) {
      respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
      return;
    }
    void commitElementGeometryById(
      target.elementType,
      target.id,
      target.patch,
      {
        ...(target.gestureId ? { gestureId: target.gestureId } : {}),
        preflight: () => {
          if (!generationLive()) {
            throw new Error('plugin authority generation changed');
          }
        },
      },
    )
      .then(() => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        respond(success(envelope.requestId));
      })
      .catch((error) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        console.error('Failed to set panel native layer bounds', error);
        respond(failure(envelope.requestId, 'SET_LAYER_BOUNDS_FAILED'));
      });
    return;
  }

  if (envelope.operation === PLUGIN_RPC_OPERATIONS.setLayerBatchGeometry) {
    const request = parseBatchGeometryDescriptor(envelope.payload);
    if (!request) {
      respond(failure(envelope.requestId, 'INVALID_PAYLOAD'));
      return;
    }
    const requestGeneration = envelope.authorityGeneration;
    const generationLive = () =>
      requestGeneration === getPluginAuthorityGeneration();
    if (!generationLive()) {
      respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
      return;
    }
    void commitBatchGeometryByIds(request.descriptor, {
      ...(request.gestureId ? { gestureId: request.gestureId } : {}),
      preflight: () => {
        if (!generationLive()) {
          throw new Error('plugin authority generation changed');
        }
      },
    })
      .then(() => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        respond(success(envelope.requestId));
      })
      .catch((error) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        console.error('Failed to set panel native batch geometry', error);
        respond(failure(envelope.requestId, 'SET_LAYER_BOUNDS_FAILED'));
      });
    return;
  }

  // 영속 필드 mutation은 canonical commit 성공 후에만 projection·응답 (C4)
  if (isPersistedOperation(envelope.operation, envelope.payload)) {
    void executePersistedOperation(
      envelope.operation,
      envelope.payload,
      envelope.authorityGeneration,
      envelope.requestId,
    ).then((errorCode) => {
      if (!errorCode) flushPluginPanelModelSyncNow();
      respond(
        errorCode
          ? failure(envelope.requestId, errorCode)
          : success(envelope.requestId),
      );
    });
    return;
  }

  const errorCode = executeOperation(envelope.operation, envelope.payload);
  // 적용분을 즉시 push해 응답 revision과 패널 미러를 동시에 전진
  if (!errorCode) flushPluginPanelModelSyncNow();
  respond(
    errorCode
      ? failure(envelope.requestId, errorCode)
      : success(envelope.requestId),
  );
};

/** main 창 bootstrap에서 1회 호출 */
export const initPluginRpcHandler = (): (() => void) => {
  const unsubscribe = pluginRpcApi.onRequest(handleRequest);
  return () => {
    unsubscribe();
    clearPluginInstancesEditSessions();
  };
};
