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
