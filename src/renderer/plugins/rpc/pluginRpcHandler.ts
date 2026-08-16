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
  renameLayerGroupById,
  setElementGroupsByTargets,
} from '@src/renderer/editor/runtime/elementOps';
import {
  setMixedElementGroups,
  setMixedLayerGroupHidden,
} from '@src/renderer/editor/runtime/mixedElementGroups';
import { commitMixedBatchGeometry } from '@src/renderer/editor/runtime/mixedBatchGeometry';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
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
  isEditorElementPropertyPatchV1,
  isEditorPaintPropertyPatchV1,
  isEditorShadowPropertyPatchV1,
  type EditorElementTypeV1,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isCanonicalGestureId = (value: unknown): value is string =>
  typeof value === 'string' &&
  new TextEncoder().encode(value).length <= MAX_GESTURE_ID_BYTES &&
  CANONICAL_UUID_PATTERN.test(value);

const parseNoteNumericStylePropertyPatch = (
  patch: Record<string, unknown>,
): EditorPreviewStylePropertyPatchV1 | null => {
  if (
    patch.property === 'noteOffsetX' &&
    (patch.value === null ||
      (typeof patch.value === 'number' &&
        Number.isFinite(patch.value) &&
        patch.value >= -500 &&
        patch.value <= 500))
  ) {
    return { property: 'noteOffsetX', value: patch.value as number | null };
  }
  if (
    patch.property === 'noteOffsetY' &&
    (patch.value === null ||
      (typeof patch.value === 'number' &&
        Number.isFinite(patch.value) &&
        patch.value >= -500 &&
        patch.value <= 500))
  ) {
    return { property: 'noteOffsetY', value: patch.value as number | null };
  }
  if (
    patch.property === 'noteWidth' &&
    (patch.value === null ||
      (typeof patch.value === 'number' &&
        Number.isFinite(patch.value) &&
        patch.value > 0))
  ) {
    return { property: 'noteWidth', value: patch.value as number | null };
  }
  if (
    patch.property === 'noteBorderWidth' &&
    typeof patch.value === 'number' &&
    Number.isFinite(patch.value) &&
    patch.value >= 0 &&
    patch.value <= 20
  ) {
    return { property: 'noteBorderWidth', value: patch.value };
  }
  if (
    patch.property === 'noteBorderRadius' &&
    typeof patch.value === 'number' &&
    Number.isFinite(patch.value) &&
    patch.value >= 1 &&
    patch.value <= 100
  ) {
    return { property: 'noteBorderRadius', value: patch.value };
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
      (elementType !== 'plugin' && !isNativeElementId(id)) ||
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
    !isNativeElementId(target.id) ||
    !isEditorElementPropertyPatchV1(
      target.patch,
      target.elementType as EditorElementTypeV1,
    )
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
    !isNativeElementId(target.id) ||
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
): {
  descriptor: BatchGeometryDescriptor;
  pluginTargets: string[];
  gestureId?: string;
} | null => {
  // pluginTargets는 신 payload 전용 - 없는 구 payload는 native 전용 하위 호환
  const hasPluginTargets = Object.prototype.hasOwnProperty.call(
    payload,
    'pluginTargets',
  );
  const allowedKeys = hasPluginTargets
    ? ['descriptor', 'gestureId', 'pluginTargets']
    : ['descriptor', 'gestureId'];
  const payloadKeys = Object.keys(payload);
  if (
    !('descriptor' in payload) ||
    payloadKeys.some((key) => !allowedKeys.includes(key)) ||
    ('gestureId' in payload && !isCanonicalGestureId(payload.gestureId)) ||
    payload.descriptor === null ||
    typeof payload.descriptor !== 'object' ||
    Array.isArray(payload.descriptor)
  ) {
    return null;
  }
  const pluginTargets = hasPluginTargets
    ? asStringArray(payload.pluginTargets)
    : [];
  if (
    !pluginTargets ||
    pluginTargets.length > MAX_LAYER_RPC_TARGETS ||
    pluginTargets.some((fullId) => fullId.trim().length === 0) ||
    new Set(pluginTargets).size !== pluginTargets.length
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
    // native 0개는 plugin 단독 배치(plugin 2개 이상)일 때만 허용
    (descriptor.targets.length === 0 && pluginTargets.length < 2) ||
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
      !isNativeElementId(target.id) ||
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
  // 크기 일괄은 native 전용 - 플러그인 크기는 content-driven (fail-closed)
  if (operation.kind === 'resize' && pluginTargets.length > 0) return null;
  const minimum =
    operation.kind === 'distribute' ? 3 : operation.kind === 'resize' ? 1 : 2;
  // 최소 개수는 native+plugin 합산 - 혼합 참여로 native만으로 모자라도 성립
  if (targets.length + pluginTargets.length < minimum) return null;
  return {
    descriptor: {
      mode: descriptor.mode,
      targets,
      operation: operation as BatchGeometryDescriptor['operation'],
    },
    pluginTargets,
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
      patch:
        | { property: 'counterEnabled'; value: boolean }
        | { property: 'counterAnimationEnabled'; value: boolean };
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
    patch.property === 'graphType' &&
    (patch.value === 'line' || patch.value === 'bar')
      ? patch.value
      : null;
  const graphColor =
    patch.property === 'graphColor' && typeof patch.value === 'string'
      ? patch.value
      : null;
  const graphRuntimePatch: EditorGraphRuntimePropertyPatchV1 | null =
    patch.property === 'showAvgLine' && typeof patch.value === 'boolean'
      ? { property: 'showAvgLine', value: patch.value }
      : patch.property === 'graphAnimationEnabled' &&
        typeof patch.value === 'boolean'
      ? { property: 'graphAnimationEnabled', value: patch.value }
      : patch.property === 'graphSpeed' &&
        typeof patch.value === 'number' &&
        Number.isSafeInteger(patch.value) &&
        patch.value >= 0 &&
        patch.value <= 4_294_967_295
      ? { property: 'graphSpeed', value: patch.value }
      : null;
  const knobRuntimePatch: EditorKnobRuntimePropertyPatchV1 | null =
    patch.property === 'sensitivity' &&
    typeof patch.value === 'number' &&
    Number.isFinite(patch.value)
      ? { property: 'sensitivity', value: patch.value }
      : patch.property === 'reverse' && typeof patch.value === 'boolean'
      ? { property: 'reverse', value: patch.value }
      : null;
  const useInlineStyles =
    patch.property === 'useInlineStyles' && typeof patch.value === 'boolean'
      ? patch.value
      : null;
  const fontStylePatch: EditorFontStylePropertyPatchV1 | null =
    patch.property === 'fontWeight' &&
    typeof patch.value === 'number' &&
    Number.isSafeInteger(patch.value) &&
    patch.value >= 0 &&
    patch.value <= 4_294_967_295
      ? { property: 'fontWeight', value: patch.value }
      : patch.property === 'fontItalic' && typeof patch.value === 'boolean'
      ? { property: 'fontItalic', value: patch.value }
      : patch.property === 'fontUnderline' && typeof patch.value === 'boolean'
      ? { property: 'fontUnderline', value: patch.value }
      : patch.property === 'fontStrikethrough' &&
        typeof patch.value === 'boolean'
      ? { property: 'fontStrikethrough', value: patch.value }
      : null;
  const fontFamilyPatch: EditorFontFamilyPropertyPatchV1 | null =
    patch.property === 'fontFamily' && typeof patch.value === 'string'
      ? { property: 'fontFamily', value: patch.value }
      : null;
  const noteNumericStylePatch = parseNoteNumericStylePropertyPatch(patch);
  const paintPatch = isEditorPaintPropertyPatchV1(patch) ? patch : null;
  const shadowPatch = isEditorShadowPropertyPatchV1(patch) ? patch : null;
  const notePaintPatch = isNotePaintPropertyPatchV1(patch) ? patch : null;
  const stylePropertyPatch: EditorPreviewStylePropertyPatchV1 | null =
    patch.property === 'displayText' && typeof patch.value === 'string'
      ? { property: 'displayText', value: patch.value }
      : patch.property === 'className' && typeof patch.value === 'string'
      ? { property: 'className', value: patch.value }
      : patch.property === 'borderWidth' &&
        typeof patch.value === 'number' &&
        Number.isFinite(patch.value) &&
        patch.value >= 0 &&
        patch.value <= 20
      ? { property: 'borderWidth', value: patch.value }
      : patch.property === 'borderRadius' &&
        typeof patch.value === 'number' &&
        Number.isFinite(patch.value) &&
        patch.value >= 0 &&
        patch.value <= 999
      ? { property: 'borderRadius', value: patch.value }
      : patch.property === 'fontSize' &&
        typeof patch.value === 'number' &&
        Number.isFinite(patch.value) &&
        patch.value >= 8 &&
        patch.value <= 72
      ? { property: 'fontSize', value: patch.value }
      : patch.property === 'noteGlowSize' &&
        typeof patch.value === 'number' &&
        Number.isFinite(patch.value) &&
        patch.value >= 0 &&
        patch.value <= 50
      ? { property: 'noteGlowSize', value: patch.value }
      : noteNumericStylePatch !== null
      ? noteNumericStylePatch
      : null;
  const inactiveImage =
    patch.property === 'inactiveImage' && typeof patch.value === 'string'
      ? patch.value
      : null;
  const soundPath =
    patch.property === 'soundPath' && typeof patch.value === 'string'
      ? patch.value
      : null;
  const soundEnabled =
    patch.property === 'soundEnabled' && typeof patch.value === 'boolean'
      ? patch.value
      : null;
  const soundVolume =
    patch.property === 'soundVolume' &&
    typeof patch.value === 'number' &&
    Number.isFinite(patch.value) &&
    patch.value >= 0 &&
    patch.value <= 200
      ? patch.value
      : null;
  const activeImage =
    patch.property === 'activeImage' && typeof patch.value === 'string'
      ? patch.value
      : null;
  const idleTransparent =
    patch.property === 'idleTransparent' && typeof patch.value === 'boolean'
      ? patch.value
      : null;
  const activeTransparent =
    patch.property === 'activeTransparent' && typeof patch.value === 'boolean'
      ? patch.value
      : null;
  const counterAnimationPreset =
    patch.property === 'counterAnimationPreset'
      ? parseCounterAnimationPresetIntent(patch.value)
      : null;
  const counterBooleanPatch =
    patch.property === 'counterEnabled' && typeof patch.value === 'boolean'
      ? { property: 'counterEnabled' as const, value: patch.value }
      : patch.property === 'counterAnimationEnabled' &&
        typeof patch.value === 'boolean'
      ? { property: 'counterAnimationEnabled' as const, value: patch.value }
      : null;
  const counterLayoutPatch: EditorCounterLayoutPropertyPatchV1 | null =
    patch.property === 'counterPlacement' &&
    (patch.value === 'inside' || patch.value === 'outside')
      ? { property: 'counterPlacement', value: patch.value }
      : patch.property === 'counterAlign' &&
        ['top', 'bottom', 'left', 'right'].includes(patch.value as string)
      ? {
          property: 'counterAlign',
          value: patch.value as 'top' | 'bottom' | 'left' | 'right',
        }
      : patch.property === 'counterAlignMode' &&
        (patch.value === 'center' || patch.value === 'between')
      ? { property: 'counterAlignMode', value: patch.value }
      : patch.property === 'counterGap' &&
        Number.isSafeInteger(patch.value) &&
        (patch.value as number) >= 0 &&
        (patch.value as number) <= 4_294_967_295
      ? { property: 'counterGap', value: patch.value as number }
      : null;
  const counterTypographyPatch: EditorCounterTypographyPropertyPatchV1 | null =
    patch.property === 'counterFontSize' &&
    Number.isSafeInteger(patch.value) &&
    (patch.value as number) >= 8 &&
    (patch.value as number) <= 72
      ? { property: 'counterFontSize', value: patch.value as number }
      : patch.property === 'counterFontWeight' &&
        Number.isSafeInteger(patch.value) &&
        (patch.value as number) >= 100 &&
        (patch.value as number) <= 900
      ? { property: 'counterFontWeight', value: patch.value as number }
      : patch.property === 'counterFontItalic' &&
        typeof patch.value === 'boolean'
      ? { property: 'counterFontItalic', value: patch.value }
      : patch.property === 'counterFontUnderline' &&
        typeof patch.value === 'boolean'
      ? { property: 'counterFontUnderline', value: patch.value }
      : patch.property === 'counterFontStrikethrough' &&
        typeof patch.value === 'boolean'
      ? { property: 'counterFontStrikethrough', value: patch.value }
      : patch.property === 'counterFontFamily' &&
        typeof patch.value === 'string'
      ? { property: 'counterFontFamily', value: patch.value }
      : null;
  const counterStrokePatch: EditorCounterStrokePropertyPatchV1 | null =
    patch.property === 'counterStrokeIdle' && typeof patch.value === 'string'
      ? { property: 'counterStrokeIdle', value: patch.value }
      : patch.property === 'counterStrokeActive' &&
        typeof patch.value === 'string'
      ? { property: 'counterStrokeActive', value: patch.value }
      : null;
  const counterFillPatch: EditorCounterFillPropertyPatchV1 | null =
    isCounterFillPropertyPatchV1(patch) ? patch : null;
  const fontColorPatch: EditorFontColorPropertyPatchV1 | null =
    isFontColorPropertyPatchV1(patch) ? patch : null;
  const notePropertyPatch: EditorNotePropertyPatchV1 | null =
    patch.property === 'noteEffectEnabled' && typeof patch.value === 'boolean'
      ? { property: 'noteEffectEnabled', value: patch.value }
      : patch.property === 'noteAutoYCorrection' &&
        typeof patch.value === 'boolean'
      ? { property: 'noteAutoYCorrection', value: patch.value }
      : patch.property === 'noteGlowEnabled' && typeof patch.value === 'boolean'
      ? { property: 'noteGlowEnabled', value: patch.value }
      : patch.property === 'noteAlignment' &&
        ['left', 'center', 'right'].includes(patch.value as string)
      ? {
          property: 'noteAlignment',
          value: patch.value as 'left' | 'center' | 'right',
        }
      : patch.property === 'noteBorderSide' &&
        ['all', 'vertical', 'horizontal'].includes(patch.value as string)
      ? {
          property: 'noteBorderSide',
          value: patch.value as 'all' | 'vertical' | 'horizontal',
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
        counterStrokePatch.property === 'counterStrokeActive' &&
        target.elementType !== 'key') ||
      (counterFillPatch !== null &&
        counterFillPatch.property === 'counterFillActive' &&
        target.elementType !== 'key') ||
      (fontColorPatch !== null &&
        fontColorPatch.property === 'activeFontColor' &&
        target.elementType !== 'key' &&
        target.elementType !== 'knob') ||
      (stylePropertyPatch !== null &&
        stylePropertyPatch.property === 'borderRadius' &&
        stylePropertyPatch.value > 100 &&
        target.elementType !== 'knob') ||
      (stylePropertyPatch !== null &&
        stylePropertyPatch.property === 'noteGlowSize' &&
        target.elementType !== 'key') ||
      (paintPatch !== null &&
        (paintPatch.property === 'activeBackgroundPaint' ||
          paintPatch.property === 'activeBorderPaint') &&
        target.elementType !== 'key' &&
        target.elementType !== 'knob') ||
      (shadowPatch !== null &&
        (target.elementType === 'graph' ||
          (shadowPatch.property === 'activeShadow' &&
            target.elementType !== 'key' &&
            target.elementType !== 'knob'))) ||
      (notePaintPatch !== null && target.elementType !== 'key') ||
      (stylePropertyPatch !== null &&
        (stylePropertyPatch.property === 'noteOffsetX' ||
          stylePropertyPatch.property === 'noteOffsetY' ||
          stylePropertyPatch.property === 'noteWidth' ||
          stylePropertyPatch.property === 'noteBorderWidth' ||
          stylePropertyPatch.property === 'noteBorderRadius') &&
        target.elementType !== 'key') ||
      (elementType !== null &&
        elementType !== 'active-capable' &&
        elementType !== 'counter-capable' &&
        target.elementType !== elementType) ||
      typeof target.id !== 'string' ||
      !isNativeElementId(target.id) ||
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
const MAX_LAYER_GROUP_NAME_BYTES = 1024;
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

const parseSetElementGroups = (
  payload: Record<string, unknown>,
): {
  mode: string;
  targets: Array<{ elementType: NativeElementType; id: string }>;
  pluginTargets: string[];
  targetGroup:
    | { kind: 'existing'; id: string }
    | { kind: 'create'; id: string; name: string }
    | null;
} | null => {
  // pluginTargets는 신 payload 전용 - 없는 구 payload는 native 전용 하위 호환
  const hasPluginTargets = Object.prototype.hasOwnProperty.call(
    payload,
    'pluginTargets',
  );
  if (
    !(hasPluginTargets
      ? hasExactKeys(payload, [
          'mode',
          'targets',
          'targetGroup',
          'pluginTargets',
        ])
      : hasExactKeys(payload, ['mode', 'targets', 'targetGroup'])) ||
    typeof payload.mode !== 'string' ||
    payload.mode.length === 0 ||
    textBytes(payload.mode) > MAX_LAYER_MODE_BYTES ||
    !Array.isArray(payload.targets) ||
    payload.targets.length > MAX_LAYER_RPC_TARGETS
  ) {
    return null;
  }
  const pluginTargets = hasPluginTargets
    ? asStringArray(payload.pluginTargets)
    : [];
  if (
    !pluginTargets ||
    pluginTargets.length > MAX_LAYER_RPC_TARGETS ||
    pluginTargets.some((fullId) => fullId.trim().length === 0) ||
    new Set(pluginTargets).size !== pluginTargets.length
  ) {
    return null;
  }
  // 빈 native targets는 plugin 대상이 있을 때만 의미가 있다
  if (payload.targets.length === 0 && pluginTargets.length === 0) {
    return null;
  }
  const targets: Array<{ elementType: NativeElementType; id: string }> = [];
  const ids = new Set<string>();
  for (const value of payload.targets) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ['elementType', 'id']) ||
      !['key', 'stat', 'graph', 'knob'].includes(value.elementType as string) ||
      !isNativeElementId(value.id) ||
      ids.has(value.id)
    ) {
      return null;
    }
    ids.add(value.id);
    targets.push({
      elementType: value.elementType as NativeElementType,
      id: value.id,
    });
  }
  let targetGroup:
    | { kind: 'existing'; id: string }
    | { kind: 'create'; id: string; name: string }
    | null = null;
  if (payload.targetGroup !== null) {
    if (!isRecord(payload.targetGroup)) return null;
    const group = payload.targetGroup;
    const create = group.kind === 'create';
    if (
      (group.kind !== 'existing' && !create) ||
      !hasExactKeys(group, create ? ['kind', 'id', 'name'] : ['kind', 'id']) ||
      typeof group.id !== 'string' ||
      group.id.length === 0 ||
      textBytes(group.id) > MAX_LAYER_GROUP_ID_BYTES ||
      (create &&
        (typeof group.name !== 'string' ||
          group.name.length === 0 ||
          textBytes(group.name) > MAX_LAYER_GROUP_NAME_BYTES))
    ) {
      return null;
    }
    targetGroup = create
      ? { kind: 'create', id: group.id, name: group.name as string }
      : { kind: 'existing', id: group.id };
  }
  return { mode: payload.mode, targets, pluginTargets, targetGroup };
};

const parseRenameLayerGroup = (
  payload: Record<string, unknown>,
): { mode: string; groupId: string; name: string } | null => {
  if (
    !hasExactKeys(payload, ['mode', 'groupId', 'name']) ||
    typeof payload.mode !== 'string' ||
    payload.mode.length === 0 ||
    textBytes(payload.mode) > MAX_LAYER_MODE_BYTES ||
    typeof payload.groupId !== 'string' ||
    payload.groupId.length === 0 ||
    textBytes(payload.groupId) > MAX_LAYER_GROUP_ID_BYTES ||
    typeof payload.name !== 'string' ||
    payload.name.length === 0 ||
    textBytes(payload.name) > MAX_LAYER_GROUP_NAME_BYTES
  ) {
    return null;
  }
  return payload as { mode: string; groupId: string; name: string };
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
  'groupId',
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
    instanceId: el.id,
    position: el.position,
    settings: el.settings as Record<string, unknown> | undefined,
    measuredSize: el.measuredSize,
    tabId: normalizePluginInstanceTabId(el.tabId),
    hidden: el.hidden === true,
    zIndex: el.zIndex,
    groupId: el.groupId,
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
  sharedGestureId: string,
): Promise<string | null> => {
  const store = usePluginDisplayElementStore.getState();
  const updatesByPlugin = new Map<
    string,
    {
      persisted: PersistedElementUpdate[];
      sessionOnly: PersistedElementUpdate[];
    }
  >();
  // 대상 소실은 부분 적용 대신 전체 거절 - update 경로와 동일 계약
  for (const update of updates) {
    const target = store.elements.find((el) => el.fullId === update.fullId);
    if (!target) return 'ELEMENT_NOT_FOUND';
    let pluginUpdates = updatesByPlugin.get(target.pluginId);
    if (!pluginUpdates) {
      pluginUpdates = { persisted: [], sessionOnly: [] };
      updatesByPlugin.set(target.pluginId, pluginUpdates);
    }
    // 세션 전용(무def) 요소는 영속 커밋 대상에서 제외 - 스토어 반영만 유지
    (target.definitionId === undefined
      ? pluginUpdates.sessionOnly
      : pluginUpdates.persisted
    ).push(update);
  }

  const gestureIds = new Map<string, string>();
  updatesByPlugin.forEach(({ persisted }, pluginId) => {
    // 커밋 없는 세션 전용 플러그인은 편집 세션 회전 불필요
    if (persisted.length === 0) return;
    gestureIds.set(
      pluginId,
      rotatePluginInstancesEditSession(pluginId, sharedGestureId),
    );
  });

  for (const [pluginId, { persisted, sessionOnly }] of updatesByPlugin) {
    if (persisted.length === 0) {
      // 세션 전용 요소만 대상 - 커밋·projection 없이 스토어 반영만. 단건·혼합
      // 경로와 순서 일관성을 위해 스토어 쓰기도 같은 플러그인 큐 슬롯에서 수행
      const errorCode = await enqueuePluginInstancesCommit(
        pluginId,
        async () => {
          if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
          const liveStore = usePluginDisplayElementStore.getState();
          // 선행 플러그인 커밋 대기 중 소실된 대상은 거절 (영속 경로 재검증과 동일 계약)
          const liveFullIds = new Set(
            liveStore.elements.map((el) => el.fullId),
          );
          if (sessionOnly.some(({ fullId }) => !liveFullIds.has(fullId))) {
            return 'ELEMENT_NOT_FOUND';
          }
          sessionOnly.forEach(({ fullId, patch }) => {
            liveStore.updateElement(fullId, patch);
          });
          return null;
        },
      );
      if (errorCode) return errorCode;
      continue;
    }
    const pluginUpdates = [...persisted, ...sessionOnly];
    const errorCode = await enqueuePluginInstancesCommit(pluginId, async () => {
      if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
      const liveStore = usePluginDisplayElementStore.getState();
      // 큐 대기 중 재주입으로 신원이 갈린 대상은 거절 (update 슬롯 재검증과 동일)
      const liveFullIds = new Set(liveStore.elements.map((el) => el.fullId));
      if (pluginUpdates.some(({ fullId }) => !liveFullIds.has(fullId))) {
        return 'ELEMENT_NOT_FOUND';
      }
      const patchesById = new Map(
        persisted.map(({ fullId, patch }) => [fullId, patch]),
      );
      // 영속 모집단은 def 요소만 - 세션 전용 요소가 커밋에 실려 재시작 시
      // 환생하는 것을 차단
      const prospective = liveStore.elements
        .filter(
          (el) => el.pluginId === pluginId && el.definitionId !== undefined,
        )
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
      // 공유 gestureId - 플러그인별 커밋이 히스토리 한 엔트리로 병합
      crypto.randomUUID(),
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
      // 공유 gestureId - 플러그인별 커밋이 히스토리 한 엔트리로 병합
      crypto.randomUUID(),
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
      // 세션 전용(무def) 요소는 영속 모집단 밖 - 커밋 없이 스토어 반영만.
      // definitionId 단독 술어로 모으면 undefined끼리 매칭돼 타 플러그인
      // 세션 요소까지 이 플러그인 인스턴스로 치환 커밋되는 오염이 생긴다
      if (live.definitionId === undefined) {
        liveStore.updateElement(fullId, materializedPatch);
        return null;
      }
      // live.definitionId는 위 분기로 defined가 보장되어 undefined 요소와
      // 매칭될 수 없다
      const prospective = liveStore.elements
        .filter(
          (el) =>
            el.pluginId === live.pluginId &&
            el.definitionId === live.definitionId,
        )
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
    const byId = new Map(store.elements.map((el) => [el.fullId, el]));
    // 대상 소실은 부분 적용 대신 전체 거절 - update 경로와 동일 계약
    const targets: PluginDisplayElementInternal[] = [];
    for (const fullId of fullIds) {
      const target = byId.get(fullId);
      if (!target) return 'ELEMENT_NOT_FOUND';
      targets.push(target);
    }
    // 세션 전용(무def) 요소는 영속 커밋 없이 스토어 제거만
    const sessionRemovalIds = new Set(
      targets
        .filter((el) => el.definitionId === undefined)
        .map((el) => el.fullId),
    );
    // 영속 그룹은 (pluginId, definitionId) 쌍 기준 - definitionId 단독 키는
    // undefined끼리 병합돼 마지막 요소의 pluginId로 커밋되는 오염이 생긴다
    const persistedGroups = new Map<
      string,
      { pluginId: string; definitionId: string }
    >();
    targets.forEach((el) => {
      if (el.definitionId === undefined) return;
      persistedGroups.set(`${el.pluginId}\u0000${el.definitionId}`, {
        pluginId: el.pluginId,
        definitionId: el.definitionId,
      });
    });
    if (sessionRemovalIds.size > 0) {
      if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
      store.setElements(
        store.elements.filter((el) => !sessionRemovalIds.has(el.fullId)),
      );
    }
    // 공유 gestureId - 플러그인별 커밋이 히스토리 한 엔트리로 병합
    const sharedGestureId = crypto.randomUUID();
    const gestureIds = new Map<string, string>();
    persistedGroups.forEach(({ pluginId }) => {
      if (!gestureIds.has(pluginId)) {
        gestureIds.set(
          pluginId,
          rotatePluginInstancesEditSession(pluginId, sharedGestureId),
        );
      }
    });

    // 플러그인 단위로 commit 성공 직후 projection 적용 - 부분 실패도 플러그인별 정합 유지
    for (const { pluginId, definitionId } of persistedGroups.values()) {
      const defTargetIds = targets
        .filter(
          (el) => el.pluginId === pluginId && el.definitionId === definitionId,
        )
        .map((el) => el.fullId);
      const errorCode = await enqueuePluginInstancesCommit(
        pluginId,
        async () => {
          if (!generationLive()) return 'AUTHORITY_GENERATION_STALE';
          const currentStore = usePluginDisplayElementStore.getState();
          // 큐 대기 중 재주입으로 신원이 갈린 대상은 거절 (update 슬롯 재검증과 동일)
          const liveFullIds = new Set(
            currentStore.elements.map((el) => el.fullId),
          );
          if (defTargetIds.some((fullId) => !liveFullIds.has(fullId))) {
            return 'ELEMENT_NOT_FOUND';
          }
          const remainingForDef = currentStore.elements.filter(
            (el) =>
              el.pluginId === pluginId &&
              el.definitionId === definitionId &&
              !fullIds.includes(el.fullId),
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
                  el.pluginId !== pluginId ||
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
    void deleteFrozenSelection(targets, {
      expectedAuthorityGeneration: requestGeneration,
      propagateErrors: true,
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
          request.target.patch.property === 'counterPlacement' ||
          request.target.patch.property === 'counterAlign' ||
          request.target.patch.property === 'counterAlignMode' ||
          request.target.patch.property === 'counterGap'
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
          request.target.patch.property === 'counterFontSize' ||
          request.target.patch.property === 'counterFontWeight' ||
          request.target.patch.property === 'counterFontItalic' ||
          request.target.patch.property === 'counterFontUnderline' ||
          request.target.patch.property === 'counterFontStrikethrough' ||
          request.target.patch.property === 'counterFontFamily'
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
          request.target.patch.property === 'counterStrokeIdle' ||
          request.target.patch.property === 'counterStrokeActive'
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
        if (request.target.patch.property === 'soundEnabled') {
          return patchSoundEnabledByIds(
            [request.target.id],
            request.target.patch.value,
            options,
          );
        }
        if (request.target.patch.property === 'counterEnabled') {
          return patchCounterEnabledByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch.value,
            options,
          );
        }
        if (request.target.patch.property === 'counterAnimationEnabled') {
          return patchCounterAnimationEnabledByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch.value,
            options,
          );
        }
        if (request.target.patch.property === 'counterAnimationPreset') {
          return patchCounterAnimationPresetByTargets(
            [
              {
                elementType: request.target.elementType as 'key' | 'stat',
                id: request.target.id,
              },
            ],
            request.target.patch.value,
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
        return request.patch.property === 'counterEnabled'
          ? patchCounterEnabledByTargets(
              request.targets,
              request.patch.value,
              options,
            )
          : patchCounterAnimationEnabledByTargets(
              request.targets,
              request.patch.value,
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

  if (
    envelope.operation === PLUGIN_RPC_OPERATIONS.setElementGroups ||
    envelope.operation === PLUGIN_RPC_OPERATIONS.renameLayerGroup
  ) {
    const setRequest =
      envelope.operation === PLUGIN_RPC_OPERATIONS.setElementGroups
        ? parseSetElementGroups(envelope.payload)
        : null;
    const renameRequest =
      envelope.operation === PLUGIN_RPC_OPERATIONS.renameLayerGroup
        ? parseRenameLayerGroup(envelope.payload)
        : null;
    if (!setRequest && !renameRequest) {
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
    const persisted = setRequest
      ? setRequest.pluginTargets.length > 0
        ? setMixedElementGroups(
            setRequest.mode,
            setRequest.targets,
            setRequest.pluginTargets,
            setRequest.targetGroup,
            options,
          )
        : setElementGroupsByTargets(
            setRequest.mode,
            setRequest.targets,
            setRequest.targetGroup,
            options,
          )
      : renameLayerGroupById(
          renameRequest!.mode,
          renameRequest!.groupId,
          renameRequest!.name,
          options,
        );
    void persisted
      .then((applied) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        respond(
          applied
            ? success(envelope.requestId)
            : failure(envelope.requestId, 'PATCH_LAYER_PROPERTY_FAILED'),
        );
      })
      .catch((error) => {
        if (!generationLive()) {
          respond(failure(envelope.requestId, 'AUTHORITY_GENERATION_STALE'));
          return;
        }
        console.error('Failed to update panel layer groups', error);
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
    // 플러그인 멤버가 섞인 그룹은 mixed 진입점이 단일 게스처로 정산
    void setMixedLayerGroupHidden(
      request.mode,
      request.groupId,
      request.hidden,
      {
        preflight: () => {
          if (!generationLive()) {
            throw new Error('plugin authority generation changed');
          }
        },
      },
    )
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
    const batchGeometryOptions = {
      ...(request.gestureId ? { gestureId: request.gestureId } : {}),
      preflight: () => {
        if (!generationLive()) {
          throw new Error('plugin authority generation changed');
        }
      },
    };
    // 플러그인 대상이 있으면 mixed 진입점이 단일 게스처로 정산
    const batchGeometryCommit =
      request.pluginTargets.length > 0
        ? commitMixedBatchGeometry(
            request.descriptor,
            request.pluginTargets,
            batchGeometryOptions,
          )
        : commitBatchGeometryByIds(request.descriptor, batchGeometryOptions);
    void batchGeometryCommit
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
