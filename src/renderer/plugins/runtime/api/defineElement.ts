/**
 * defineElement API 구현
 * 플러그인에서 커스텀 UI 요소를 정의하는 기능을 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { buildValidTabIdSet } from '@constants/keyModes';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import {
  addDisplayElementInternal,
  removeDisplayElementsInternal,
  type InternalDisplayElementConfig,
} from '../displayElement/displayElementApi';
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
import {
  SECTION_WRAPPER_CLASS,
  SECTION_LABEL_CLASS,
  SECTION_CARD_CLASS,
  FORM_ROW_CLASS,
  FORM_LABEL_CLASS,
} from '@utils/cardRecipes';
import { handlerRegistry } from '../handlers';
import { createPluginDialogHandlerScope } from './pluginDialogHandlers';
import {
  coerceSettingValue,
  getDefaultSettings,
  normalizeSettingsSections,
  omitLayoutSettingValues,
} from '../settingsSections';
import type { NamespacedStorage } from '../context';
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

export interface SavedInstance {
  // 영구 인스턴스 ID - backfill 전 구데이터는 없을 수 있음
  instanceId?: string;
  position: { x: number; y: number };
  settings?: Record<string, string | number | boolean>;
  measuredSize?: { width: number; height: number };
  tabId?: string;
  hidden?: boolean;
  zIndex?: number;
  // 레이어 그룹 소속 - normalize된 tabId 모드의 그룹만 유효
  groupId?: string;
}

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
  namespacedStorage: NamespacedStorage;
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
    namespacedStorage,
    registerCleanup,
    wrapFunctionWithContext,
    isReloading,
    waitForReloadEnd,
  } = deps;
  const visibilityErrorKeys = new Set<string>();

  return (definition: PluginDefinition) => {
    const defId = pluginId;
    const internalDef: PluginDefinitionInternal = {
      ...definition,
      id: defId,
      pluginId: pluginId,
    };

    usePluginDisplayElementStore.getState().registerDefinition(internalDef);

    const INSTANCES_KEY = 'instances';

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
    ) => {
      const buildRequest = () => {
        const mutationId = crypto.randomUUID();
        notePluginInstancesMutation(mutationId);
        return {
          pluginId,
          instances,
          mutationId,
          gestureId,
          observedHistoryEpoch: useHistoryStatusStore.getState().historyEpoch,
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
              const stored = await namespacedStorage.get(INSTANCES_KEY);
              return Array.isArray(stored) ? (stored as SavedInstance[]) : null;
            },
            // 탭 정리는 백엔드 단일 write-lock에서 원자 수행 - get과 commit
            // 사이에 bulk clear 등이 끼어 지워진 인스턴스가 부활하지 않음.
            // 유효 탭은 큐 실행 시점 파생, invoke 비행 중 탭 undo는 epoch가 거절
            reconcilePersist: () =>
              enqueuePluginInstancesCommit(pluginId, async () => {
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
                    observedHistoryEpoch:
                      useHistoryStatusStore.getState().historyEpoch,
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
              }),
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

    const openInstanceSettings = async (instanceId: string) => {
      const element = usePluginDisplayElementStore
        .getState()
        .elements.find((el) => el.fullId === instanceId);

      if (!element) {
        console.warn(
          `[Plugin ${pluginId}] Cannot find element ${instanceId} for settings`,
        );
        return;
      }

      const currentSettings: Record<string, unknown> = omitLayoutSettingValues(
        definition.settings,
        {
          ...defaultSettings,
          ...(element.settings || {}),
        },
      );
      const originalSettings = { ...currentSettings };

      const reportNormalizationError = (
        key: string,
        error: unknown,
        kind: 'visibility' | 'unsupported-type',
      ) => {
        if (visibilityErrorKeys.has(key)) return;
        visibilityErrorKeys.add(key);
        const message =
          kind === 'unsupported-type'
            ? `Unsupported setting type for "${key}"`
            : `Failed to evaluate visibility for setting "${key}"`;
        console.error(`[Plugin ${pluginId}] ${message}:`, error);
      };
      const getNormalizedSections = () =>
        normalizeSettingsSections(
          definition.settings,
          currentSettings,
          reportNormalizationError,
        );
      const modalScope = `plugin-element-${encodeURIComponent(
        pluginId,
      )}-${encodeURIComponent(instanceId)}`;
      const findModalElement = (attribute: string, value: string) =>
        Array.from(
          document.querySelectorAll<HTMLElement>(`[${attribute}]`),
        ).find((element) => element.getAttribute(attribute) === value);
      const updateVisibility = () => {
        const sections = getNormalizedSections();
        sections.forEach((section, sectionIndex) => {
          const sectionElement = findModalElement(
            'data-settings-section',
            `${modalScope}-${sectionIndex}`,
          );
          if (sectionElement) {
            sectionElement.style.display = section.renderVisible ? '' : 'none';
          }
          section.entries.forEach((entry, entryIndex) => {
            const entryElement = findModalElement(
              'data-settings-entry',
              `${modalScope}-${sectionIndex}-${entryIndex}`,
            );
            if (entryElement) {
              entryElement.style.display = entry.renderVisible ? '' : 'none';
            }
          });
        });
        const emptyElement = findModalElement(
          'data-settings-empty',
          modalScope,
        );
        if (emptyElement) {
          emptyElement.style.display = sections.some(
            (section) => section.renderVisible,
          )
            ? 'none'
            : '';
        }
      };
      const commitSettingValue = async (
        key: string,
        newValue: string | number | boolean,
      ) => {
        currentSettings[key] = newValue;
        api.ui.displayElement.update(instanceId, {
          settings: { ...currentSettings },
        });
        updateVisibility();
      };

      const modalHandlers = createPluginDialogHandlerScope();
      let htmlContent = '';
      try {
        const normalizedSections = getNormalizedSections();
        // 패널(renderPluginSettingsForm)과 동일한 섹션 카드 구조·토큰 - section이
        // 없어도 암시적 카드 하나로 렌더 (모달-패널 외형 통합, 2026-07-12 결정)
        htmlContent = '<div class="flex flex-col gap-[12px] w-full text-left">';

        for (const [sectionIndex, section] of normalizedSections.entries()) {
          htmlContent += `<div data-settings-section="${modalScope}-${sectionIndex}" style="${
            section.renderVisible ? '' : 'display:none'
          }" class="${SECTION_WRAPPER_CLASS}">`;
          if (section.label) {
            const sectionLabel = translate(
              section.label,
              undefined,
              section.label,
            );
            htmlContent += `<p class="${SECTION_LABEL_CLASS}">${sectionLabel}</p>`;
          }
          htmlContent += `<div class="${SECTION_CARD_CLASS}">`;
          for (const [entryIndex, entry] of section.entries.entries()) {
            const { key, schema } = entry;
            const entryAttributes = `data-settings-entry="${modalScope}-${sectionIndex}-${entryIndex}" style="${
              entry.renderVisible ? '' : 'display:none'
            }"`;
            {
              const value =
                currentSettings[key] !== undefined
                  ? currentSettings[key]
                  : schema.default;
              let componentHtml = '';
              const labelText = translate(
                schema.label,
                undefined,
                schema.label,
              );
              const placeholderText =
                typeof schema.placeholder === 'string'
                  ? translate(schema.placeholder, undefined, schema.placeholder)
                  : schema.placeholder;

              const wrappedChange = wrapFunctionWithContext((newValue) => {
                // DOM 문자열을 스키마 타입으로 복원, 복원 불가면 커밋 스킵
                const coerced = coerceSettingValue(schema, newValue);
                if (coerced === null) return;
                return commitSettingValue(key, coerced);
              });

              if (schema.type === 'boolean') {
                componentHtml = modalHandlers.capture(() =>
                  api.ui.components.checkbox({
                    checked: !!value,
                    onChange: wrappedChange as unknown as (
                      checked: boolean,
                    ) => void | Promise<void>,
                  }),
                );
              } else if (schema.type === 'color') {
                const handleColorClick = (e: Event) => {
                  const target = (e.target as HTMLElement).closest('button');
                  if (!target) return;

                  const pickerId = `plugin-${pluginId}-${instanceId}-${key}`;

                  if (
                    window.__dmn_showColorPicker &&
                    window.__dmn_getColorPickerState
                  ) {
                    const state = window.__dmn_getColorPickerState();
                    if (state?.isOpen && state.id === pickerId) {
                      window.__dmn_showColorPicker({
                        initialColor: state.color,
                        id: pickerId,
                      });
                      return;
                    }
                  }

                  target.classList.add('shadow-focus-ring');

                  api.ui.pickColor({
                    initialColor: String(currentSettings[key] ?? ''),
                    id: pickerId,
                    referenceElement: target as HTMLElement,
                    onColorChange: (newColor) => {
                      // 스와치(버튼 자체) 미리보기 업데이트
                      target.style.setProperty(
                        '--dmn-color-swatch-color',
                        newColor,
                      );
                    },
                    onColorChangeComplete: (newColor) => {
                      wrappedChange(newColor);
                    },
                    onClose: () => {
                      target.classList.remove('shadow-focus-ring');
                    },
                  });
                };

                const handlerId = modalHandlers.trackRegistryHandler(
                  handlerRegistry.register(pluginId, handleColorClick),
                );

                // 패널 ColorInput과 동일한 스와치 단독 버튼
                componentHtml = `
              <button type="button"
                class="dmn-color-swatch-button w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
                style="--dmn-color-swatch-color: ${value}"
                data-plugin-handler="${handlerId}"
              >
                <span class="dmn-color-swatch-surface">
                  <span class="dmn-color-swatch-color"></span>
                  <span class="dmn-color-swatch-ring"></span>
                </span>
              </button>
            `;
              } else if (schema.type === 'string' || schema.type === 'number') {
                const strVal = String(value);
                let inputWidth: number;

                if (schema.type === 'number') {
                  inputWidth = 60;
                } else {
                  if (strVal.length <= 4) inputWidth = 60;
                  else if (strVal.length <= 10) inputWidth = 100;
                  else inputWidth = 200;
                }

                componentHtml = modalHandlers.capture(() =>
                  api.ui.components.input({
                    type:
                      schema.type === 'string'
                        ? 'text'
                        : (schema.type as 'number'),
                    value: value as string | number,
                    onChange: wrappedChange as unknown as (
                      value: string,
                    ) => void | Promise<void>,
                    min: schema.min,
                    max: schema.max,
                    step: schema.step,
                    placeholder: placeholderText,
                    width: inputWidth,
                  }),
                );
              } else if (schema.type === 'select') {
                const translatedOptions = (schema.options || []).map(
                  (option: { label: string; value: string }) => ({
                    ...option,
                    label: translate(option.label, undefined, option.label),
                  }),
                );
                componentHtml = modalHandlers.capture(() =>
                  api.ui.components.dropdown({
                    options: translatedOptions,
                    selected: value as string,
                    onChange: wrappedChange as unknown as (
                      value: string,
                    ) => void | Promise<void>,
                  }),
                );
              }

              htmlContent += `
            <div ${entryAttributes} class="${FORM_ROW_CLASS}">
              <p class="${FORM_LABEL_CLASS}">${labelText}</p>
              ${componentHtml}
            </div>
          `;
            }
          }
          htmlContent += '</div></div>';
        }

        const noSettingsText = await api.settings
          .get()
          .then((s) => {
            const locale = s.language || 'ko';
            return locale === 'en'
              ? 'No settings available.'
              : '설정할 항목이 없습니다.';
          })
          .catch(() => '설정할 항목이 없습니다.');
        htmlContent += `<div data-settings-empty="${modalScope}" style="${
          normalizedSections.some((section) => section.renderVisible)
            ? 'display:none'
            : ''
        }" class="text-fg-faint text-body text-center">${noSettingsText}</div>`;

        htmlContent += '</div>';

        const [saveText, cancelText] = await api.settings
          .get()
          .then((s) => {
            const locale = s.language || 'ko';
            return locale === 'en' ? ['Apply', 'Cancel'] : ['저장', '취소'];
          })
          .catch(() => ['저장', '취소']);

        const confirmed = await api.ui.dialog.custom(htmlContent, {
          showCancel: true,
          confirmText: saveText,
          cancelText: cancelText,
        });

        if (!confirmed) {
          api.ui.displayElement.update(instanceId, {
            settings: originalSettings,
          });
        }
        // 모달 정산은 확정 경계 - 확정·취소 revert 모두 즉시 커밋
        flushPluginInstancesEditSession(pluginId);
      } finally {
        modalHandlers.dispose();
      }
    };

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

    // 저장 스냅샷을 화면 요소에 diff 적용 - 초기 복원과 undo 재결합이 공유.
    // 생존 fullId는 canonical 소유 필드만 갱신하므로 핸들·모달·선택이 유지됨
    const applyInstancesSnapshot = (
      savedInstances: SavedInstance[],
      readiness: 'ready' | 'failed',
    ) => {
      instanceSaveBarrier.runRestoreMutation(() => {
        if (readiness === 'failed') {
          console.warn(
            `[Plugin ${pluginId}] Bootstrap timed out; restoring all instances`,
          );
        }

        const maxInstances = definition.maxInstances;
        let instancesToRestore = savedInstances;

        if (maxInstances && maxInstances > 0) {
          // 캡은 탭별 수용 카운터로 원배열 순서를 보존하며 적용.
          // 탭별 재그룹은 canonical 순서를 깨 undo 직후 echo 저장이
          // 실변경 커밋이 되고 redo 스택을 소거한다
          const acceptedByTab = new Map<string, number>();
          instancesToRestore = savedInstances.filter((instance) => {
            const tabId = normalizePluginInstanceTabId(instance.tabId);
            const accepted = acceptedByTab.get(tabId) ?? 0;
            if (accepted >= maxInstances) return false;
            acceptedByTab.set(tabId, accepted + 1);
            return true;
          });
        }

        // backfill 전 무ID 항목은 diff 신원이 없음 - 그 스냅샷만 전량 재주입 폴백
        const canDiff = instancesToRestore.every(
          (instance) =>
            typeof instance.instanceId === 'string' &&
            instance.instanceId.length > 0,
        );

        // 기대 fullId 집합 - 폴백은 빈 집합이라 소멸 단계가 전량 제거
        const expectedFullIds = new Set(
          canDiff
            ? instancesToRestore.map(
                (instance) => `${pluginId}::${instance.instanceId}`,
              )
            : [],
        );

        // 소멸: 이 definition 요소 중 기대 밖 fullId 제거.
        // 초기 복원 창(barrier 복원 완료 전)에서는 스킵 - define 직후 추가된
        // 요소(barrier가 flush 대기 중인 편집)를 지우면 flush 커밋에서 조용히
        // 소실된다. 복원 완료 후 reapply와 실패 복원은 canonical이 진실이라
        // 소멸 유지
        const preserveRestoreWindowAdds =
          readiness === 'ready' && instanceSaveBarrier.isRestoring();
        if (!preserveRestoreWindowAdds) {
          const staleFullIds = usePluginDisplayElementStore
            .getState()
            .elements.filter(
              (element) =>
                element.definitionId === defId &&
                !expectedFullIds.has(element.fullId),
            )
            .map((element) => element.fullId);
          if (staleFullIds.length > 0) {
            removeDisplayElementsInternal(staleFullIds);
          }
        }

        const survivingFullIds = new Set(
          usePluginDisplayElementStore
            .getState()
            .elements.filter((element) => element.definitionId === defId)
            .map((element) => element.fullId),
        );

        instancesToRestore.forEach((instance) => {
          const fullId = canDiff ? `${pluginId}::${instance.instanceId}` : null;
          // canonical 소유 7필드 (PERSISTED_FIELDS와 동일 범위)
          const persistedFields = {
            position: instance.position,
            settings: omitLayoutSettingValues(
              definition.settings,
              instance.settings || { ...defaultSettings },
            ) as Record<string, string | number | boolean>,
            measuredSize: instance.measuredSize,
            tabId: normalizePluginInstanceTabId(instance.tabId),
            hidden: instance.hidden ?? false,
            zIndex: instance.zIndex,
            groupId: instance.groupId,
          };

          if (fullId && survivingFullIds.has(fullId)) {
            // 생존: 소유 필드만 갱신 - html·state·핸들러는 렌더러 소유라 불변
            usePluginDisplayElementStore
              .getState()
              .updateElement(fullId, persistedFields);
            return;
          }

          // 비동기 복원 중 플러그인 컨텍스트 재설정
          window.__dmn_current_plugin_id = pluginId;

          // 신규: 저장된 영구 ID로 재주입 (무ID는 새 UUID 발급)
          addDisplayElementInternal({
            html: '<!-- plugin-element -->',
            instanceId: instance.instanceId,
            draggable: true,
            definitionId: defId,
            state: definition.previewState || {},
            onClick: useModalSettings ? handleElementClick : undefined,
            contextMenu: {
              enableDelete: true,
              deleteLabel: definition.contextMenu?.delete || '삭제',
              customItems: buildCustomContextMenuItems(),
            },
            ...persistedFields,
          } as unknown as InternalDisplayElementConfig);
        });

        // buildSavedPluginInstances가 순서 민감 - def 블록을 스냅샷 순서로 재배열
        if (canDiff) {
          const state = usePluginDisplayElementStore.getState();
          const byFullId = new Map(
            state.elements
              .filter((element) => element.definitionId === defId)
              .map((element) => [element.fullId, element]),
          );
          const ordered = instancesToRestore
            .map((instance) =>
              byFullId.get(`${pluginId}::${instance.instanceId}`),
            )
            .filter(
              (element): element is PluginDisplayElementInternal =>
                element !== undefined,
            );
          let cursor = 0;
          let orderChanged = false;
          const reordered = state.elements.map((element) => {
            if (element.definitionId !== defId) return element;
            // 복원 창에서 소멸을 스킵한 기대 밖 요소는 제자리 유지
            if (!expectedFullIds.has(element.fullId)) return element;
            const replacement = ordered[cursor] ?? element;
            cursor += 1;
            if (replacement !== element) orderChanged = true;
            return replacement;
          });
          if (orderChanged) {
            state.setElements(reordered);
          }
        }
      });
    };

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
