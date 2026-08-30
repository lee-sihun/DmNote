/**
 * defineElement API 구현
 * 플러그인에서 커스텀 UI 요소를 정의하는 기능을 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { buildValidTabIdSet } from '@constants/keyModes';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { removeDisplayElementsInternal } from '../displayElement/displayElementApi';
import {
  applyCanonicalPluginInstances,
  notePluginInstancesMutation,
  registerPluginInstancesReapplier,
} from '../displayElement/instancesUndoSync';
import { pluginInstancesApi } from '@api/modules/pluginInstancesApi';
import {
  createPluginInstancesSaveDebounce,
  enqueuePluginInstancesCommit,
  flushPluginInstancesEditSession,
  hasActivePluginInstancesEditContext,
  hasConflictingPluginInstancesGesture,
  isPluginInstancesGestureStaged,
  registerPluginInstancesEditSessionFlush,
  registerPluginInstancesStagedRelease,
  touchPluginInstancesEditSession,
} from '../displayElement/instancesCommitQueue';
import { noteBackendPluginRevision } from '@plugins/runtime/pluginModelRevision';
import { getPluginAuthorityGeneration } from '@plugins/runtime/pluginAuthorityGeneration';
import { trackPluginWork } from '@plugins/runtime/pluginRuntimeReadiness';
import {
  useHistoryStatusStore,
  syncHistoryStatus,
} from '@stores/data/useHistoryStatusStore';
import {
  createPluginInstanceLifecycle,
  createPluginInstanceSaveBarrier,
  normalizePluginInstanceTabId,
  type PluginRestoreReadiness,
} from '../displayElement/instanceLifecycle';
import { getDefaultSettings } from '../settingsSections';
import type {
  PluginDefinition,
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
  PluginDisplayElementActionContext,
  PluginDisplayElementConfig,
  DMNoteAPI,
} from '@src/types/plugin/api';
import type { SettingsState } from '@src/types/settings/settings';
import { trackEditorWrite } from '@src/renderer/editor/runtime/editorWriteBarrier';
import { createInstanceSettingsDialogFactory } from './instanceSettingsDialog';
import {
  createPluginInstanceSnapshotApplier,
  type SavedInstance,
} from './pluginInstanceSnapshotApplier';

export type { SavedInstance } from './pluginInstanceSnapshotApplier';

export const buildSavedPluginInstances = (
  elements: readonly PluginDisplayElementInternal[],
  definitionId: string,
): SavedInstance[] =>
  elements
    .filter((element) => element.definitionId === definitionId)
    .map((element) => ({
      instanceId: element.id,
      position: element.position,
      settings: element.settings as SavedInstance['settings'],
      measuredSize: element.measuredSize,
      tabId: normalizePluginInstanceTabId(element.tabId),
      hidden: element.hidden === true,
      zIndex: element.zIndex,
      groupId: element.groupId,
    }));

interface DefineElementDependencies {
  pluginId: string;
  api: DMNoteAPI;
  registerCleanup: (cleanup: () => void) => void;
  wrapFunctionWithContext: (
    fn: (...args: unknown[]) => unknown,
  ) => (...args: unknown[]) => unknown;
  isReloading: () => boolean;
  waitForReloadEnd: () => Promise<void>;
}

/**
 * defineElement 함수를 생성합니다.
 */
export const createDefineElement = (deps: DefineElementDependencies) => {
  const {
    pluginId,
    api,
    registerCleanup,
    wrapFunctionWithContext,
    isReloading,
    waitForReloadEnd,
  } = deps;
  const createOpenInstanceSettings = createInstanceSettingsDialogFactory({
    pluginId,
    api,
    wrapFunctionWithContext,
  });

  return (definition: PluginDefinition) => {
    const defId = pluginId;
    const internalDef: PluginDefinitionInternal = {
      ...definition,
      id: defId,
      pluginId: pluginId,
    };

    usePluginDisplayElementStore.getState().registerDefinition(internalDef);

    let pendingRestorationSave: {
      resolve: () => void;
      reject: (error: unknown) => void;
    } | null = null;
    const instanceSaveBarrier = createPluginInstanceSaveBarrier(() => {
      if (pendingRestorationSave) return;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const pending = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      pendingRestorationSave = { resolve, reject };
      void trackEditorWrite(pending);
    });

    const isHistoryRejection = (error: unknown): boolean => {
      const message = String(error);
      return (
        message.includes('HISTORY_EPOCH_CONFLICT') ||
        message.includes('HISTORY_IN_PROGRESS')
      );
    };

    // barrier 거절 복구 - 큐 잔여 스냅샷을 먼저 폐기해 canonical 되덮기 방지
    const reapplyCanonicalAfterRejection = async () => {
      cancelPendingInstanceSave();
      await applyCanonicalPluginInstances(pluginId, true).catch((pullError) => {
        console.error(
          `[Plugin ${pluginId}] Failed to reapply canonical instances:`,
          pullError,
        );
      });
    };

    // canonical commit (C4) - admission·epoch·dedupe·no-op·gesture 병합은 백엔드 규율
    const commitInstancesInner = async (
      instances: SavedInstance[],
      gestureId: string,
      observedHistoryEpoch: number,
    ) => {
      const buildRequest = () => {
        const mutationId = crypto.randomUUID();
        notePluginInstancesMutation(mutationId);
        return {
          pluginId,
          instances,
          mutationId,
          gestureId,
          observedHistoryEpoch,
          authorityGeneration: getPluginAuthorityGeneration(),
        };
      };
      try {
        const result = await pluginInstancesApi.commit(buildRequest());
        noteBackendPluginRevision(result.modelRevision);
      } catch (error) {
        // 낡은 epoch 관측 = barrier(undo·프리셋 복원)와 경합 - barrier가 이긴다
        // 캡처값 재시도는 undo 직전 상태를 되살리므로 폐기하고, 다른 gesture가
        // 소유 중이 아니면 canonical 재주입으로 메모리와 저장을 재수렴
        if (isHistoryRejection(error)) {
          console.warn(
            `[Plugin ${pluginId}] Instance save dropped by history barrier`,
          );
          await syncHistoryStatus();
          if (!hasConflictingPluginInstancesGesture(pluginId, gestureId)) {
            await reapplyCanonicalAfterRejection();
          }
          return;
        }
        throw error;
      }
    };

    // undo 재결합 직전 pending 저장 취소용 - main 블록에서 실제 구현 주입
    let cancelPendingInstanceSave: () => void = () => {};
    // 취소 세대 - debounce 타이머뿐 아니라 이미 큐에 들어간 저장도 무효화
    let instanceSaveGeneration = 0;

    const instanceLifecycle =
      window.__dmn_window_type === 'main'
        ? createPluginInstanceLifecycle<SavedInstance>({
            isBootstrapped: () => useKeyStore.getState().isBootstrapped,
            subscribeBootstrap: (listener) =>
              useKeyStore.subscribe((state, previousState) => {
                if (state.isBootstrapped !== previousState.isBootstrapped) {
                  listener();
                }
              }),
            loadInstances: async () => {
              const snapshot = await pluginInstancesApi.get(pluginId);
              noteBackendPluginRevision(snapshot.modelRevision);
              return snapshot.instances as SavedInstance[];
            },
            // 탭 정리는 백엔드 단일 write-lock에서 원자 수행 - get과 commit
            // 사이에 bulk clear 등이 끼어 지워진 인스턴스가 부활하지 않음.
            // 유효 탭은 큐 실행 시점 파생, invoke 비행 중 탭 undo는 epoch가 거절
            reconcilePersist: () => {
              const observedHistoryEpoch =
                useHistoryStatusStore.getState().historyEpoch;
              return enqueuePluginInstancesCommit(pluginId, async () => {
                const validTabIds = buildValidTabIdSet(
                  useKeyStore.getState().customTabs.map((tab) => tab.id),
                );
                const mutationId = crypto.randomUUID();
                notePluginInstancesMutation(mutationId);
                try {
                  const result = await pluginInstancesApi.reconcile({
                    pluginId,
                    validTabIds: [...validTabIds],
                    mutationId,
                    observedHistoryEpoch,
                    authorityGeneration: getPluginAuthorityGeneration(),
                  });
                  noteBackendPluginRevision(result.modelRevision);
                } catch (error) {
                  if (isHistoryRejection(error)) {
                    await syncHistoryStatus();
                    if (!hasActivePluginInstancesEditContext(pluginId)) {
                      await reapplyCanonicalAfterRejection();
                    }
                    return;
                  }
                  throw error;
                }
              });
            },
            getMemoryInstances: () =>
              usePluginDisplayElementStore
                .getState()
                .elements.filter((element) => element.definitionId === defId)
                .map((element) => ({
                  fullId: element.fullId,
                  tabId: element.tabId,
                })),
            releaseMemoryInstances: removeDisplayElementsInternal,
          })
        : null;

    const buildInstances = (
      elements: readonly PluginDisplayElementInternal[],
    ): SavedInstance[] => buildSavedPluginInstances(elements, defId);

    const buildInstancesFromStore = (): SavedInstance[] =>
      buildInstances(usePluginDisplayElementStore.getState().elements);

    const saveInstances = async ({
      waitForReload = false,
      gestureId,
      captureCurrentSnapshot = false,
    }: {
      waitForReload?: boolean;
      gestureId?: string;
      captureCurrentSnapshot?: boolean;
    } = {}) => {
      // 일반 리로드 중 저장은 폐기, 복원 중 생긴 실제 편집만 리로드 종료 뒤 저장
      if (!instanceSaveBarrier.shouldSave()) return;
      if (waitForReload) {
        while (isReloading()) await waitForReloadEnd();
      } else if (isReloading()) {
        return;
      }
      if (!instanceLifecycle) return;

      const generationAtCapture = instanceSaveGeneration;
      // 스냅샷과 같은 시점의 epoch를 고정 - 앞선 큐가 끝난 뒤 현재 epoch를
      // 다시 읽으면 undo/reset 전 저장이 새 장벽을 통과할 수 있음
      const observedHistoryEpoch =
        useHistoryStatusStore.getState().historyEpoch;
      const capturedInstances = captureCurrentSnapshot
        ? buildInstancesFromStore().map((instance) => ({
            ...instance,
            position: { ...instance.position },
            settings: instance.settings ? { ...instance.settings } : undefined,
            measuredSize: instance.measuredSize
              ? { ...instance.measuredSize }
              : undefined,
          }))
        : null;
      // 일반 저장은 큐 실행 시점 캡처, 제스처 경계 flush만 이전 상태 고정
      await enqueuePluginInstancesCommit(pluginId, async () => {
        if (waitForReload) {
          while (isReloading()) await waitForReloadEnd();
        } else if (isReloading()) {
          return;
        }
        if (!instanceSaveBarrier.shouldSave()) return;
        if (generationAtCapture !== instanceSaveGeneration) return;
        await commitInstancesInner(
          capturedInstances ?? buildInstancesFromStore(),
          gestureId ?? touchPluginInstancesEditSession(pluginId),
          observedHistoryEpoch,
        );
      });
    };

    const flushPendingRestorationSave = async () => {
      const pending = pendingRestorationSave;
      if (!pending) return;
      pendingRestorationSave = null;
      try {
        await saveInstances({ waitForReload: true });
        pending.resolve();
      } catch (error) {
        pending.reject(error);
        throw error;
      }
    };

    const discardPendingRestorationSave = () => {
      const pending = pendingRestorationSave;
      pendingRestorationSave = null;
      pending?.resolve();
    };

    const failPendingRestorationSave = (error: unknown) => {
      const pending = pendingRestorationSave;
      pendingRestorationSave = null;
      pending?.reject(error);
    };

    if (window.__dmn_window_type === 'main') {
      // 드래그 등 프레임 단위 변경의 commit 스팸 방지 - trailing debounce
      const INSTANCE_SAVE_DEBOUNCE_MS = 200;
      const instanceSaveDebounce = createPluginInstancesSaveDebounce({
        delayMs: INSTANCE_SAVE_DEBOUNCE_MS,
        save: ({ gestureId, captureCurrentSnapshot }) =>
          saveInstances({ gestureId, captureCurrentSnapshot }),
        // 실패한 스냅샷을 메모리에 방치하면 저장과 화면이 갈라진다 -
        // 다른 gesture 소유 중이 아니면 canonical로 롤백 (pendingWrite
        // reject는 debounce가 유지해 종료 drain 실패 전파 계약 보존)
        onError: (error, { gestureId }) => {
          console.error(
            `[Plugin ${pluginId}] Failed to save instances:`,
            error,
          );
          if (
            gestureId !== undefined &&
            hasConflictingPluginInstancesGesture(pluginId, gestureId)
          ) {
            return;
          }
          void applyCanonicalPluginInstances(pluginId, true).catch(
            (pullError) => {
              console.error(
                `[Plugin ${pluginId}] Failed to reapply canonical instances:`,
                pullError,
              );
            },
          );
        },
      });
      let stagedSavePending = false;
      // staged 중 삼킨 변경도 barrier가 관측하도록 release까지 tracked write 유지
      let settleStagedPendingWrite: (() => void) | null = null;
      const noteStagedSavePending = () => {
        if (stagedSavePending) return;
        stagedSavePending = true;
        const pending = new Promise<void>((resolve) => {
          settleStagedPendingWrite = () => {
            settleStagedPendingWrite = null;
            resolve();
          };
        });
        void trackEditorWrite(pending);
      };
      cancelPendingInstanceSave = () => {
        stagedSavePending = false;
        settleStagedPendingWrite?.();
        instanceSaveDebounce.cancel();
        instanceSaveGeneration += 1;
      };
      registerCleanup(cancelPendingInstanceSave);
      registerCleanup(
        registerPluginInstancesEditSessionFlush(pluginId, () => {
          instanceSaveDebounce.flush();
        }),
      );
      registerCleanup(
        registerPluginInstancesStagedRelease(pluginId, (gestureId) => {
          if (!stagedSavePending) return;
          stagedSavePending = false;
          // staged gestureId 계승 + 즉시 flush - release 후 새 세션 분열 방지
          instanceSaveDebounce.schedule(
            touchPluginInstancesEditSession(pluginId, gestureId),
          );
          instanceSaveDebounce.flush();
          settleStagedPendingWrite?.();
        }),
      );

      const unsubStore = usePluginDisplayElementStore.subscribe(
        (state, prevState) => {
          const currentInstances = buildInstances(state.elements);
          const prevInstances = buildInstances(prevState.elements);

          if (
            JSON.stringify(currentInstances) !== JSON.stringify(prevInstances)
          ) {
            // 복원 재주입 중 변경은 저장 대상이 아님 (undo 반영 echo 차단)
            if (!instanceSaveBarrier.shouldSave()) return;
            // 변경 시점 기준으로 edit-session TTL 갱신 - debounce가 세션을 쪼개지 않게
            const gestureId = touchPluginInstancesEditSession(pluginId);
            if (isPluginInstancesGestureStaged(pluginId)) {
              noteStagedSavePending();
              return;
            }
            instanceSaveDebounce.schedule(gestureId);
          }
        },
      );
      registerCleanup(unsubStore);

      const unsubValidTabs = useKeyStore.subscribe((state, previousState) => {
        if (!state.isBootstrapped) return;

        const validTabIds = buildValidTabIdSet(
          state.customTabs.map((tab) => tab.id),
        );
        const previousValidTabIds = previousState.isBootstrapped
          ? buildValidTabIdSet(previousState.customTabs.map((tab) => tab.id))
          : null;
        const validTabsChanged =
          previousValidTabIds === null ||
          validTabIds.size !== previousValidTabIds.size ||
          [...validTabIds].some((tabId) => !previousValidTabIds.has(tabId));
        if (!validTabsChanged) return;

        void instanceLifecycle?.reconcile(validTabIds).catch((error) => {
          console.error(
            `[Plugin ${pluginId}] Failed to reconcile instances:`,
            error,
          );
        });
      });
      registerCleanup(unsubValidTabs);
    }

    const defaultSettings: Record<string, string | number | boolean> =
      getDefaultSettings(definition.settings);

    let currentLocale = 'ko';
    const applyLocale = (next?: string) => {
      if (typeof next === 'string' && next.trim().length > 0) {
        currentLocale = next;
      }
    };

    if (api.i18n?.getLocale) {
      api.i18n
        .getLocale()
        .then(applyLocale)
        .catch(() => undefined);
    } else if (api.settings?.get) {
      api.settings
        .get()
        .then((settings) => applyLocale((settings as SettingsState)?.language))
        .catch(() => undefined);
    }

    let localeCleanup: (() => void) | null = null;
    if (api.i18n?.onLocaleChange) {
      localeCleanup = api.i18n.onLocaleChange(applyLocale);
      if (localeCleanup) {
        registerCleanup(() => {
          try {
            if (localeCleanup) localeCleanup();
          } catch (error) {
            console.error(
              `[Plugin ${pluginId}] Failed to cleanup locale listener`,
              error,
            );
          }
        });
      }
    }

    const translate = (
      key?: string,
      params?: Record<string, string | number>,
      fallback?: string,
    ) =>
      translatePluginMessage({
        messages: definition.messages,
        locale: currentLocale,
        key,
        params,
        fallback,
      });

    const buildActionsProxy = (elementId: string) =>
      new Proxy(
        {},
        {
          get: (_target, prop: string | symbol) => {
            if (typeof prop !== 'string') return undefined;
            return (...args: unknown[]) => {
              sendBridgeMessageBestEffort(
                'overlay',
                'plugin:displayElement:invokeAction',
                {
                  elementId,
                  action: prop,
                  args,
                },
              );
            };
          },
        },
      );

    const buildCustomContextMenuItems = () =>
      (definition.contextMenu?.items || []).map((item, index) => ({
        id: item.action || `custom-${index}`,
        label: item.label,
        position: item.position,
        visible: item.visible,
        disabled: item.disabled,
        onClick: (ctx: PluginDisplayElementActionContext) => {
          const actions =
            ctx?.actions ||
            buildActionsProxy(
              (ctx?.element as PluginDisplayElementInternal)?.fullId || '',
            );

          if (typeof item.onClick === 'function') {
            return item.onClick({ ...ctx, actions });
          }

          if (item.action && typeof actions[item.action] === 'function') {
            return actions[item.action]();
          }
        },
      }));

    const useModalSettings = definition.settingsUI === 'modal';

    const openInstanceSettings = createOpenInstanceSettings({
      definition,
      defaultSettings,
      translate,
    });

    const handleElementClick = (e: Event) => {
      if (!useModalSettings) return;
      const target = e.currentTarget as HTMLElement;
      const instanceId = target.getAttribute('data-plugin-element');
      if (instanceId) {
        return openInstanceSettings(instanceId);
      }
    };

    if (window.__dmn_window_type === 'main') {
      const createLabel =
        definition.contextMenu?.create || `${definition.name} 생성`;

      // maxInstances 제한 체크를 위한 헬퍼 함수 (현재 탭 기준)
      const getInstanceCountForTab = (tabId: string) => {
        return usePluginDisplayElementStore
          .getState()
          .elements.filter(
            (el) => el.definitionId === defId && el.tabId === tabId,
          ).length;
      };

      const menuId = api.ui.contextMenu.addGridMenuItem({
        id: `create-${defId}`,
        label: createLabel,
        // maxInstances 제한 도달 시 메뉴 비활성화 (현재 탭 기준)
        disabled: () => {
          const maxInstances = definition.maxInstances;
          if (!maxInstances || maxInstances <= 0) return false;
          const currentTabId = useKeyStore.getState().selectedKeyType;
          return getInstanceCountForTab(currentTabId) >= maxInstances;
        },
        onClick: async (context) => {
          // 클릭 시에도 한 번 더 체크 (동시 클릭 방지, 현재 탭 기준)
          const maxInstances = definition.maxInstances;
          if (maxInstances && maxInstances > 0) {
            const currentTabId = useKeyStore.getState().selectedKeyType;
            if (getInstanceCountForTab(currentTabId) >= maxInstances) {
              console.warn(
                `[Plugin ${pluginId}] Max instances (${maxInstances}) reached for ${defId} in tab ${currentTabId}`,
              );
              return;
            }
          }

          api.ui.displayElement.add({
            html: '<!-- plugin-element -->',
            position: {
              x: context.position.dx,
              y: context.position.dy,
            },
            draggable: true,
            definitionId: defId,
            settings: { ...defaultSettings },
            state: definition.previewState || {},
            onClick: useModalSettings ? handleElementClick : undefined,
            contextMenu: {
              enableDelete: true,
              deleteLabel: definition.contextMenu?.delete || '삭제',
              customItems: buildCustomContextMenuItems(),
            },
          } as unknown as PluginDisplayElementConfig);
          // 생성은 discrete 편집 - debounce 대기 없이 즉시 커밋
          flushPluginInstancesEditSession(pluginId);
        },
      });

      registerCleanup(() => {
        api.ui.contextMenu.removeMenuItem(menuId);
      });
    }

    const applyInstancesSnapshot = createPluginInstanceSnapshotApplier({
      pluginId,
      definitionId: defId,
      definition,
      defaultSettings,
      instanceSaveBarrier,
      useModalSettings,
      handleElementClick,
      buildCustomContextMenuItems,
    });

    if (window.__dmn_window_type === 'main') {
      // undo/redo의 canonical 재결합 - diff 적용기가 소멸·생존·신규를 정산
      registerCleanup(
        registerPluginInstancesReapplier(pluginId, defId, {
          // 이벤트 도착 즉시 호출 - 낡은 메모리를 커밋할 pending 저장 차단
          cancelPendingSave: () => cancelPendingInstanceSave(),
          reapply: (instances) => {
            applyInstancesSnapshot(instances as SavedInstance[], 'ready');
          },
        }),
      );
    }

    if (instanceLifecycle) {
      let restoreStarted = false;
      let settleScheduledRestore: (() => void) | null = null;
      const scheduledRestore = new Promise<PluginRestoreReadiness>(
        (resolve, reject) => {
          settleScheduledRestore = () => resolve('pending');
          const restoreTimer = setTimeout(() => {
            restoreStarted = true;
            settleScheduledRestore = null;
            try {
              void instanceLifecycle
                .startRestore(
                  () => {
                    const keyState = useKeyStore.getState();
                    return buildValidTabIdSet(
                      keyState.customTabs.map((tab) => tab.id),
                    );
                  },
                  (savedInstances, readiness) =>
                    applyInstancesSnapshot(savedInstances, readiness),
                )
                .then(resolve, reject);
            } catch (error) {
              reject(error);
            }
          }, 0);
          registerCleanup(() => {
            clearTimeout(restoreTimer);
            if (!restoreStarted) {
              settleScheduledRestore?.();
              settleScheduledRestore = null;
            }
          });
        },
      );
      // 인스턴스 복구까지 끝나야 오버레이 리빌 게이트가 열린다
      const restoreWork = scheduledRestore.then(
        async () => {
          if (instanceSaveBarrier.finishRestoration()) {
            await flushPendingRestorationSave();
          }
        },
        (error) => {
          instanceSaveBarrier.failRestoration();
          failPendingRestorationSave(error);
          throw error;
        },
      );
      trackPluginWork(restoreWork);
      void trackEditorWrite(restoreWork).catch((error) => {
        console.error(
          `[Plugin ${pluginId}] Failed to restore instances:`,
          error,
        );
      });

      registerCleanup(() => {
        instanceLifecycle.dispose();
        instanceSaveBarrier.cancelRestoration();
        discardPendingRestorationSave();
      });
    } else {
      instanceSaveBarrier.finishRestoration();
    }
  };
};
