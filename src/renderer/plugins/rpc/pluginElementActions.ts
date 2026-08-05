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

import { sendPluginRpc } from './pluginRpcClient';

export const PLUGIN_RPC_OPERATIONS = {
  setHidden: 'elements:setHidden',
  remove: 'elements:delete',
  setZIndexes: 'elements:setZIndexes',
  update: 'elements:update',
} as const;

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
}

const outboundQueue: QueuedElementOp[] = [];
let drainPromise: Promise<boolean> | null = null;

const RECONCILE_WAIT_MS = 1000;

const sendQueuedOp = async (op: QueuedElementOp) => {
  const outcome = await sendPluginRpc(op.operation, op.payload, mirrorRevision);
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
    if (outcome.kind === 'ok') continue;
    if (outcome.kind === 'error') {
      console.error(`Plugin RPC ${op.operation} failed: ${outcome.errorCode}`);
    }

    // 거절·불명 - fresh snapshot 수렴 뒤 마지막 의도를 1회 재시도
    requestFreshSnapshot();
    await waitForMirrorRevisionAdvance(RECONCILE_WAIT_MS);
    const retry = await sendQueuedOp(op);
    if (retry.kind === 'ok') continue;
    succeeded = false;
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
