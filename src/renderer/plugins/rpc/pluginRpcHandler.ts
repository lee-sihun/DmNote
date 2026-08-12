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
  patchElementPropertyById,
  patchFontStyleByTargets,
  patchGraphColorsByIds,
  patchGraphPropertiesByIds,
  patchGraphTypesByIds,
  patchKnobPropertiesByIds,
  patchNotePropertiesByIds,
  patchUseInlineStylesByTargets,
} from '@src/renderer/editor/runtime/elementOps';
import type {
  EditorElementPropertyPatchV1,
  EditorFontStylePropertyPatchV1,
  EditorGraphRuntimePropertyPatchV1,
  EditorKnobRuntimePropertyPatchV1,
  EditorNotePropertyPatchV1,
} from '@src/types/editor';
import type {
  LayerReorderAnchorsWire,
  LayerReorderIntentWire,
} from './pluginElementActions';

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

const success = (requestId: string): PluginRpcResponse => ({
  protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION,
  requestId,
  authorityGeneration: getPluginAuthorityGeneration(),
  modelRevision: getPluginPanelModelRevision(),
  ok: true,
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
  const patchValid =
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
      ));
  const graphOnlyPatch =
    hasExactKeys(patch, ['graphType']) ||
    hasExactKeys(patch, ['graphColor']) ||
    hasExactKeys(patch, ['showAvgLine']) ||
    hasExactKeys(patch, ['graphAnimationEnabled']) ||
    hasExactKeys(patch, ['graphSpeed']);
  const knobOnlyPatch =
    hasExactKeys(patch, ['sensitivity']) || hasExactKeys(patch, ['reverse']);
  if (
    !patchValid ||
    (graphOnlyPatch && target.elementType !== 'graph') ||
    (knobOnlyPatch && target.elementType !== 'knob')
  ) {
    return null;
  }
  return target as unknown as NativeLayerPropertyTarget;
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
  if (
    !hasExactKeys(payload, ['targets', 'patch']) ||
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
    notePropertyPatch === null
  ) {
    return null;
  }
  const elementType =
    useInlineStyles !== null || fontStylePatch !== null
      ? null
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
      (elementType !== null && target.elementType !== elementType) ||
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
