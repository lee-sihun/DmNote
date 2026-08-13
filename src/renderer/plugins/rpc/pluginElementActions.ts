/**
 * 플러그인 요소 mutation의 창 무관 진입점
 * main: 로컬 store(단일 authority)에 직접 적용
 * panel: main으로 RPC 위임, outcome-unknown이면 전체 스냅샷 재조회로 수렴
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import {
  PANEL_MODEL_REQUEST_MESSAGE,
  getPluginPanelModelRevision,
} from '@utils/plugin/panelModelSync';
import { rotatePluginInstancesEditSession } from '@plugins/runtime/displayElement/instancesCommitQueue';
import type { NativeElementType } from '@src/renderer/editor/model/elementIdMap';
import type { BatchGeometryDescriptor } from '@src/renderer/editor/runtime/elementOps';
import type {
  EditorElementPropertyPatchV1,
  EditorFontFamilyPropertyPatchV1,
  EditorFontStylePropertyPatchV1,
  EditorGraphRuntimePropertyPatchV1,
  EditorKnobRuntimePropertyPatchV1,
  EditorNotePropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorCounterStrokePropertyPatchV1,
  EditorPaintPropertyPatchV1,
} from '@src/types/editor';

import { getPluginAuthorityGeneration, sendPluginRpc } from './pluginRpcClient';

export const PLUGIN_RPC_OPERATIONS = {
  setHidden: 'elements:setHidden',
  remove: 'elements:delete',
  setZIndexes: 'elements:setZIndexes',
  update: 'elements:update',
  deleteLayerSelection: 'layers:deleteSelection',
  reorderLayerSelection: 'layers:reorderSelection',
  patchLayerProperty: 'layers:patchProperty',
  setLayerBounds: 'layers:setBounds',
  setLayerBatchGeometry: 'layers:setBatchGeometry',
  setLayerGroupVisibility: 'layers:setGroupVisibility',
  updateCounterAnimationPreset: 'counterAnimation:updatePreset',
  deleteCounterAnimationPreset: 'counterAnimation:deletePreset',
} as const;

export type LayerDeleteTarget = {
  elementType: 'key' | 'stat' | 'graph' | 'knob' | 'plugin';
  id: string;
};

export interface NativeLayerPropertyTarget {
  elementType: NativeElementType;
  id: string;
  patch: EditorElementPropertyPatchV1;
}

export interface NativeLayerBoundsTarget {
  elementType: NativeElementType;
  id: string;
  patch:
    | { dx: number; dy?: never; width?: never; height?: never }
    | { dx?: never; dy: number; width?: never; height?: never }
    | { dx?: never; dy?: never; width: number; height?: never }
    | { dx?: never; dy?: never; width?: never; height: number };
  gestureId?: string;
}

export type NativeLayerBatchGeometryDescriptor = BatchGeometryDescriptor;

export interface LayerReorderAnchorsWire {
  toDisplayIndex: number;
  targetGroupId: string | null;
  anchorBeforeId: string | null;
  anchorAfterId: string | null;
  anchorHeaderGroupId: string | null;
  anchorBeforeHeaderGroupId: string | null;
  anchorAfterHeaderGroupId: string | null;
  boundary: 'top' | 'bottom' | null;
}

export type LayerReorderIntentWire =
  | {
      kind: 'items';
      mode: string;
      draggedIds: string[];
      collapsedGroupIds: string[];
      anchors: LayerReorderAnchorsWire;
      preserveFullGroups: boolean;
    }
  | {
      kind: 'group';
      mode: string;
      groupId: string;
      extraIds: string[];
      collapsedGroupIds: string[];
      anchors: LayerReorderAnchorsWire;
    };

const isPanelWindow = () => window.__dmn_window_type === 'panel';

const rotateTargetPluginSessions = (
  fullIds: string[],
  gestureId?: string,
): void => {
  const targetIds = new Set(fullIds);
  const pluginIds = new Set(
    usePluginDisplayElementStore
      .getState()
      .elements.filter((element) => targetIds.has(element.fullId))
      .map((element) => element.pluginId),
  );
  pluginIds.forEach((pluginId) => {
    if (gestureId) {
      rotatePluginInstancesEditSession(pluginId, gestureId);
    } else {
      rotatePluginInstancesEditSession(pluginId);
    }
  });
};

// 패널 미러의 마지막 수신 backend revision - RPC expectedModelRevision 토큰
let mirrorRevision = 0;
let revisionWaiters: Array<() => void> = [];
export const notePluginMirrorRevision = (revision: number): void => {
  if (revision > mirrorRevision) {
    mirrorRevision = revision;
    const waiters = revisionWaiters;
    revisionWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
};

// 거절·불명 후 재시도 전 fresh snapshot 도착을 대기 (상한 있음)
export const waitForMirrorRevisionAdvance = (
  timeoutMs: number,
): Promise<void> =>
  new Promise((resolve) => {
    const onAdvance = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      revisionWaiters = revisionWaiters.filter((w) => w !== onAdvance);
      resolve();
    }, timeoutMs);
    revisionWaiters.push(onAdvance);
  });

const requestFreshSnapshot = () => {
  sendBridgeMessageBestEffort('main', PANEL_MODEL_REQUEST_MESSAGE, {});
};

// 요소 mutation은 직렬화 큐로 발행 - 각 요청이 직전 응답의 revision을 관측해
// 버스트에서 stale revision 거절 루프가 생기지 않게 함
interface QueuedElementOp {
  operation: string;
  payload: Record<string, unknown>;
  authorityGeneration?: number;
  retryPolicy?: 'default' | 'idempotentDelete' | 'staleOnly' | 'none';
  resolve?: (succeeded: boolean) => void;
  resolvePayload?: (payload: Record<string, unknown> | null) => void;
}

const outboundQueue: QueuedElementOp[] = [];
let drainPromise: Promise<boolean> | null = null;

const RECONCILE_WAIT_MS = 1000;

const sendQueuedOp = async (op: QueuedElementOp) => {
  const outcome = await sendPluginRpc(
    op.operation,
    op.payload,
    mirrorRevision,
    op.authorityGeneration,
  );
  // 응답에는 성공·실패 모두 최신 backend revision이 실림
  if (outcome.kind !== 'unknown' && outcome.response) {
    notePluginMirrorRevision(outcome.response.modelRevision);
  }
  return outcome;
};

const drainQueue = async (): Promise<boolean> => {
  let succeeded = true;
  while (outboundQueue.length > 0) {
    const op = outboundQueue.shift()!;
    const outcome = await sendQueuedOp(op);
    if (outcome.kind === 'ok') {
      op.resolve?.(true);
      op.resolvePayload?.(outcome.response.payload ?? null);
      continue;
    }
    if (op.retryPolicy === 'none') {
      succeeded = false;
      op.resolve?.(false);
      op.resolvePayload?.(null);
      requestFreshSnapshot();
      continue;
    }
    const retryableStaleOutcome =
      op.retryPolicy === 'staleOnly' &&
      outcome.kind === 'error' &&
      (outcome.errorCode === 'MODEL_REVISION_STALE' ||
        outcome.errorCode === 'PLUGIN_MODEL_REVISION_CONFLICT');
    if (op.retryPolicy === 'staleOnly' && !retryableStaleOutcome) {
      succeeded = false;
      op.resolve?.(false);
      op.resolvePayload?.(null);
      requestFreshSnapshot();
      continue;
    }
    const retryableDeleteOutcome =
      op.retryPolicy === 'idempotentDelete' &&
      (outcome.kind === 'unknown' ||
        (outcome.kind === 'error' &&
          (outcome.errorCode === 'MODEL_REVISION_STALE' ||
            outcome.errorCode === 'PLUGIN_MODEL_REVISION_CONFLICT')));
    if (op.retryPolicy === 'idempotentDelete' && !retryableDeleteOutcome) {
      succeeded = false;
      op.resolve?.(false);
      op.resolvePayload?.(null);
      requestFreshSnapshot();
      continue;
    }
    if (outcome.kind === 'error') {
      console.error(`Plugin RPC ${op.operation} failed: ${outcome.errorCode}`);
    }

    // 거절·불명 - fresh snapshot 수렴 뒤 마지막 의도를 1회 재시도
    requestFreshSnapshot();
    await waitForMirrorRevisionAdvance(RECONCILE_WAIT_MS);
    if (
      op.authorityGeneration !== undefined &&
      op.authorityGeneration !== getPluginAuthorityGeneration()
    ) {
      succeeded = false;
      op.resolve?.(false);
      op.resolvePayload?.(null);
      continue;
    }
    const retry = await sendQueuedOp(op);
    if (retry.kind === 'ok') {
      op.resolve?.(true);
      op.resolvePayload?.(retry.response.payload ?? null);
      continue;
    }
    succeeded = false;
    op.resolve?.(false);
    op.resolvePayload?.(null);
    if (retry.kind === 'error') {
      console.error(
        `Plugin RPC ${op.operation} retry failed: ${retry.errorCode}`,
      );
    }
    requestFreshSnapshot();
  }
  return succeeded;
};

const ensureQueueDrain = (): Promise<boolean> => {
  if (!drainPromise) {
    drainPromise = drainQueue().finally(() => {
      drainPromise = null;
    });
  }
  return drainPromise;
};

type PositionPatch = Partial<PluginDisplayElementInternal['position']>;
type MeasuredSizePatch = Partial<
  NonNullable<PluginDisplayElementInternal['measuredSize']>
>;

export type PluginElementUpdatePatch = Omit<
  Partial<PluginDisplayElementInternal>,
  'position' | 'measuredSize' | 'settings'
> & {
  position?: PositionPatch;
  measuredSize?: MeasuredSizePatch;
  settings?: Record<string, unknown>;
};

export const mergePluginElementUpdatePatches = (
  base: PluginElementUpdatePatch,
  next: PluginElementUpdatePatch,
): PluginElementUpdatePatch => ({
  ...base,
  ...next,
  ...(base.position || next.position
    ? { position: { ...base.position, ...next.position } }
    : {}),
  ...(base.measuredSize || next.measuredSize
    ? { measuredSize: { ...base.measuredSize, ...next.measuredSize } }
    : {}),
  ...(base.settings || next.settings
    ? { settings: { ...base.settings, ...next.settings } }
    : {}),
});

export const materializePluginElementUpdate = (
  element: PluginDisplayElementInternal,
  patch: PluginElementUpdatePatch,
): Partial<PluginDisplayElementInternal> => {
  const { position, measuredSize, settings, ...rest } = patch;
  return {
    ...rest,
    ...(position ? { position: { ...element.position, ...position } } : {}),
    ...(measuredSize
      ? {
          measuredSize: {
            width:
              measuredSize.width ??
              element.measuredSize?.width ??
              element.estimatedSize?.width ??
              200,
            height:
              measuredSize.height ??
              element.measuredSize?.height ??
              element.estimatedSize?.height ??
              150,
          },
        }
      : {}),
    ...(settings ? { settings: { ...element.settings, ...settings } } : {}),
  };
};

const delegate = (
  operation: string,
  payload: Record<string, unknown>,
): void => {
  // 같은 요소의 연속 update는 미발신 마지막 op와 병합 (순서 보존)
  if (operation === PLUGIN_RPC_OPERATIONS.update) {
    const last = outboundQueue[outboundQueue.length - 1];
    if (
      last &&
      last.operation === operation &&
      last.payload.fullId === payload.fullId
    ) {
      last.payload = {
        ...last.payload,
        patch: mergePluginElementUpdatePatches(
          last.payload.patch as PluginElementUpdatePatch,
          payload.patch as PluginElementUpdatePatch,
        ),
      };
      return;
    }
  }
  outboundQueue.push({ operation, payload });
  void ensureQueueDrain();
};

export const deleteLayerSelectionViaAuthority = (
  targets: readonly LayerDeleteTarget[],
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.deleteLayerSelection,
      payload: { targets: targets.map((target) => ({ ...target })) },
      authorityGeneration,
      retryPolicy: 'idempotentDelete',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const reorderLayerSelectionViaAuthority = (
  descriptor: LayerReorderIntentWire,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.reorderLayerSelection,
      payload: { descriptor: structuredClone(descriptor) },
      authorityGeneration,
      retryPolicy: 'none',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchNativeLayerPropertyViaAuthority = (
  target: NativeLayerPropertyTarget,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: { target: structuredClone(target) },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchNativeLayerBoundsViaAuthority = (
  target: NativeLayerBoundsTarget,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.setLayerBounds,
      payload: { target: structuredClone(target) },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const commitBatchGeometryViaAuthority = (
  descriptor: NativeLayerBatchGeometryDescriptor,
  gestureId?: string,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.setLayerBatchGeometry,
      payload: {
        descriptor: structuredClone(descriptor),
        ...(gestureId ? { gestureId } : {}),
      },
      authorityGeneration,
      retryPolicy: 'none',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const setLayerGroupVisibilityViaAuthority = (
  mode: string,
  groupId: string,
  hidden: boolean,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.setLayerGroupVisibility,
      payload: { mode, groupId, hidden },
      authorityGeneration,
      retryPolicy: 'none',
      resolve,
    });
    void ensureQueueDrain();
  });
};

const patchNativeLayerPropertiesViaAuthority = (
  elementType: 'graph' | 'knob',
  ids: readonly string[],
  patch: EditorElementPropertyPatchV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: ids.map((id) => ({ elementType, id })),
        patch: structuredClone(patch),
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchGraphTypesViaAuthority = (
  ids: readonly string[],
  graphType: 'line' | 'bar',
): Promise<boolean> =>
  patchNativeLayerPropertiesViaAuthority('graph', ids, { graphType });

export const patchGraphColorsViaAuthority = (
  ids: readonly string[],
  graphColor: string,
): Promise<boolean> =>
  patchNativeLayerPropertiesViaAuthority('graph', ids, { graphColor });

export const patchGraphPropertiesViaAuthority = (
  ids: readonly string[],
  patch: EditorGraphRuntimePropertyPatchV1,
): Promise<boolean> =>
  patchNativeLayerPropertiesViaAuthority('graph', ids, patch);

export const patchKnobPropertiesViaAuthority = (
  ids: readonly string[],
  patch: EditorKnobRuntimePropertyPatchV1,
): Promise<boolean> =>
  patchNativeLayerPropertiesViaAuthority('knob', ids, patch);

export const patchUseInlineStylesViaAuthority = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  useInlineStyles: boolean,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: { useInlineStyles },
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchFontStyleViaAuthority = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorFontStylePropertyPatchV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: structuredClone(patch),
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchFontFamilyViaAuthority = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorFontFamilyPropertyPatchV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: structuredClone(patch),
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchStylePropertyViaAuthority = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorPreviewStylePropertyPatchV1,
  gestureId?: string,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: structuredClone(patch),
        ...(gestureId ? { gestureId } : {}),
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchPaintViaAuthority = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorPaintPropertyPatchV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: structuredClone(patch),
      },
      authorityGeneration,
      retryPolicy: 'staleOnly',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchInactiveImageViaAuthority = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  inactiveImage: string,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: { inactiveImage },
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchSoundPathViaAuthority = (
  ids: readonly string[],
  soundPath: string,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: ids.map((id) => ({ elementType: 'key' as const, id })),
        patch: { soundPath },
      },
      authorityGeneration,
      retryPolicy: 'staleOnly',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchSoundEnabledViaAuthority = (
  ids: readonly string[],
  soundEnabled: boolean,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: ids.map((id) => ({ elementType: 'key' as const, id })),
        patch: { soundEnabled },
      },
      authorityGeneration,
      retryPolicy: 'staleOnly',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchSoundVolumeViaAuthority = (
  ids: readonly string[],
  soundVolume: number,
  gestureId?: string,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: ids.map((id) => ({ elementType: 'key' as const, id })),
        patch: { soundVolume },
        ...(gestureId ? { gestureId } : {}),
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchCounterAnimationPresetViaAuthority = (
  targets: readonly { elementType: 'key' | 'stat'; id: string }[],
  intent: import('@src/types/editor').EditorCounterAnimationPresetIntentV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: { counterAnimationPreset: structuredClone(intent) },
      },
      authorityGeneration,
      retryPolicy: 'staleOnly',
      resolve,
    });
    void ensureQueueDrain();
  });
};

const patchCounterBooleanViaAuthority = (
  targets: readonly { elementType: 'key' | 'stat'; id: string }[],
  patch: { counterEnabled: boolean } | { counterAnimationEnabled: boolean },
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch,
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchCounterEnabledViaAuthority = (
  targets: readonly { elementType: 'key' | 'stat'; id: string }[],
  enabled: boolean,
): Promise<boolean> =>
  patchCounterBooleanViaAuthority(targets, { counterEnabled: enabled });

export const patchCounterAnimationEnabledViaAuthority = (
  targets: readonly { elementType: 'key' | 'stat'; id: string }[],
  enabled: boolean,
): Promise<boolean> =>
  patchCounterBooleanViaAuthority(targets, {
    counterAnimationEnabled: enabled,
  });

export const patchCounterLayoutViaAuthority = (
  targets: readonly { elementType: 'key' | 'stat'; id: string }[],
  patch: import('@src/types/editor').EditorCounterLayoutPropertyPatchV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch,
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchCounterTypographyViaAuthority = (
  targets: readonly { elementType: 'key' | 'stat'; id: string }[],
  patch: import('@src/types/editor').EditorCounterTypographyPropertyPatchV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch,
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchCounterStrokeViaAuthority = (
  targets: readonly { elementType: 'key' | 'stat'; id: string }[],
  patch: EditorCounterStrokePropertyPatchV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch,
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const updateCounterAnimationPresetViaAuthority = (
  request: import('@src/types/key/counterAnimation').CounterAnimationUpdateRequest,
): Promise<
  | import('@src/types/key/counterAnimation').CounterAnimationUpsertResponse
  | null
> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.updateCounterAnimationPreset,
      payload: { request: structuredClone(request) },
      authorityGeneration,
      retryPolicy: 'staleOnly',
      resolvePayload: (payload) =>
        resolve(
          payload as unknown as
            | import('@src/types/key/counterAnimation').CounterAnimationUpsertResponse
            | null,
        ),
    });
    void ensureQueueDrain();
  });
};

export const deleteCounterAnimationPresetViaAuthority = (
  id: string,
): Promise<
  | import('@src/types/key/counterAnimation').CounterAnimationDeleteResponse
  | null
> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.deleteCounterAnimationPreset,
      payload: { id },
      authorityGeneration,
      retryPolicy: 'staleOnly',
      resolvePayload: (payload) =>
        resolve(
          payload as unknown as
            | import('@src/types/key/counterAnimation').CounterAnimationDeleteResponse
            | null,
        ),
    });
    void ensureQueueDrain();
  });
};

export const patchActiveImageViaAuthority = (
  targets: readonly { elementType: 'key' | 'knob'; id: string }[],
  activeImage: string,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: { activeImage },
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchIdleTransparentViaAuthority = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  idleTransparent: boolean,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: { idleTransparent },
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchActiveTransparentViaAuthority = (
  targets: readonly { elementType: 'key' | 'knob'; id: string }[],
  activeTransparent: boolean,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: targets.map(({ elementType, id }) => ({ elementType, id })),
        patch: { activeTransparent },
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const patchNotePropertiesViaAuthority = (
  ids: readonly string[],
  patch: EditorNotePropertyPatchV1,
): Promise<boolean> => {
  const authorityGeneration = getPluginAuthorityGeneration();
  return new Promise((resolve) => {
    outboundQueue.push({
      operation: PLUGIN_RPC_OPERATIONS.patchLayerProperty,
      payload: {
        targets: ids.map((id) => ({ elementType: 'key', id })),
        patch: structuredClone(patch),
      },
      authorityGeneration,
      retryPolicy: 'default',
      resolve,
    });
    void ensureQueueDrain();
  });
};

export const drainPendingPluginElementWrites = async (): Promise<boolean> => {
  let succeeded = true;
  while (drainPromise || outboundQueue.length > 0) {
    const result = await ensureQueueDrain();
    if (!result) succeeded = false;
  }
  return succeeded;
};

/** 가시성 일괄 변경 */
export const setPluginElementsHidden = (
  targets: Array<{ fullId: string; hidden: boolean }>,
): void => {
  if (targets.length === 0) return;
  if (isPanelWindow()) {
    delegate(PLUGIN_RPC_OPERATIONS.setHidden, { targets });
    return;
  }
  rotateTargetPluginSessions(targets.map(({ fullId }) => fullId));
  const store = usePluginDisplayElementStore.getState();
  targets.forEach(({ fullId, hidden }) => {
    store.updateElement(fullId, { hidden });
  });
};

/** 요소 삭제 */
export const deletePluginElements = (
  fullIds: string[],
  gestureId?: string,
): void => {
  if (fullIds.length === 0) return;
  if (isPanelWindow()) {
    delegate(PLUGIN_RPC_OPERATIONS.remove, { fullIds });
    return;
  }
  const store = usePluginDisplayElementStore.getState();
  const targetIds = new Set(fullIds);
  rotateTargetPluginSessions(fullIds, gestureId);
  const remaining = store.elements.filter(
    (element) => !targetIds.has(element.fullId),
  );
  store.setElements(remaining);
};

/** 단일 요소 patch (위치·크기·인스턴스 settings 등) */
export const updatePluginElement = (
  fullId: string,
  patch: PluginElementUpdatePatch,
): void => {
  if (isPanelWindow()) {
    delegate(PLUGIN_RPC_OPERATIONS.update, { fullId, patch });
    return;
  }
  const store = usePluginDisplayElementStore.getState();
  const element = store.elements.find(
    (candidate) => candidate.fullId === fullId,
  );
  if (!element) return;
  store.updateElement(fullId, materializePluginElementUpdate(element, patch));
};

/** z-order 일괄 지정 */
export const setPluginElementZIndexes = (
  entries: Array<{ fullId: string; zIndex: number }>,
): void => {
  if (entries.length === 0) return;
  if (isPanelWindow()) {
    delegate(PLUGIN_RPC_OPERATIONS.setZIndexes, { entries });
    return;
  }
  rotateTargetPluginSessions(entries.map(({ fullId }) => fullId));
  const store = usePluginDisplayElementStore.getState();
  entries.forEach(({ fullId, zIndex }) => {
    store.updateElement(fullId, { zIndex });
  });
};

export const currentAuthorityModelRevision = (): number =>
  isPanelWindow() ? mirrorRevision : getPluginPanelModelRevision();
