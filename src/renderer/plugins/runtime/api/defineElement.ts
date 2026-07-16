/**
 * defineElement API 구현
 * 플러그인에서 커스텀 UI 요소를 정의하는 기능을 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { buildValidTabIdSet } from '@constants/keyModes';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { removeDisplayElementsInternal } from '../displayElement/displayElementApi';
import {
  createPluginInstanceLifecycle,
  createPluginInstanceSaveBarrier,
  normalizePluginInstanceTabId,
} from '../displayElement/instanceLifecycle';
import {
  SECTION_WRAPPER_CLASS,
  SECTION_LABEL_CLASS,
  SECTION_CARD_CLASS,
  FORM_ROW_CLASS,
  FORM_LABEL_CLASS,
} from '@utils/cardRecipes';
import { handlerRegistry } from '../handlers';
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
} from '@src/types/plugin/api';
import type { SettingsState } from '@src/types/settings/settings';

interface SavedInstance {
  position: { x: number; y: number };
  settings?: Record<string, string | number | boolean>;
  measuredSize?: { width: number; height: number };
  tabId?: string;
}

interface DefineElementDependencies {
  pluginId: string;
  namespacedStorage: NamespacedStorage;
  registerCleanup: (cleanup: () => void) => void;
  wrapFunctionWithContext: (
    fn: (...args: unknown[]) => unknown,
  ) => (...args: unknown[]) => unknown;
  isReloading: () => boolean;
}

/**
 * defineElement 함수를 생성합니다.
 */
export const createDefineElement = (deps: DefineElementDependencies) => {
  const {
    pluginId,
    namespacedStorage,
    registerCleanup,
    wrapFunctionWithContext,
    isReloading,
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

    const instanceSaveBarrier = createPluginInstanceSaveBarrier();

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
            persistInstances: (instances) =>
              namespacedStorage.set(INSTANCES_KEY, instances),
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

    const saveInstances = async () => {
      // 전역 리로드 중이거나 개별 복원 중에는 저장하지 않음
      if (isReloading() || !instanceSaveBarrier.shouldSave()) return;

      const elements = usePluginDisplayElementStore
        .getState()
        .elements.filter((el) => el.definitionId === defId);

      const instances: SavedInstance[] = elements.map((el) => ({
        position: el.position,
        settings: el.settings as SavedInstance['settings'],
        measuredSize: el.measuredSize,
        tabId: normalizePluginInstanceTabId(el.tabId),
      }));

      await instanceLifecycle?.saveInstances(instances);
    };

    if (window.__dmn_window_type === 'main') {
      const unsubStore = usePluginDisplayElementStore.subscribe(
        (state, prevState) => {
          const currentElements = state.elements.filter(
            (el) => el.definitionId === defId,
          );
          const prevElements = prevState.elements.filter(
            (el) => el.definitionId === defId,
          );

          if (
            JSON.stringify(currentElements) !== JSON.stringify(prevElements)
          ) {
            void saveInstances().catch((error) => {
              console.error(
                `[Plugin ${pluginId}] Failed to save instances:`,
                error,
              );
            });
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

    if (window.api?.i18n?.getLocale) {
      window.api.i18n
        .getLocale()
        .then(applyLocale)
        .catch(() => undefined);
    } else if (window.api?.settings?.get) {
      window.api.settings
        .get()
        .then((settings) => applyLocale((settings as SettingsState)?.language))
        .catch(() => undefined);
    }

    let localeCleanup: (() => void) | null = null;
    if (window.api?.i18n?.onLocaleChange) {
      localeCleanup = window.api.i18n.onLocaleChange(applyLocale);
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

      // 설정 변경 전 히스토리 저장
      const { keyMappings, positions } = useKeyStore.getState();
      const statPositions = useStatItemStore.getState().positions;
      const graphPositions = useGraphItemStore.getState().positions;
      const pluginElements = usePluginDisplayElementStore.getState().elements;
      const { pushState } = await import('@stores/data/useHistoryStore').then(
        (m) => m.useHistoryStore.getState(),
      );
      pushState({
        keyMappings,
        positions,
        statPositions,
        graphPositions,
        pluginElements,
      });

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
        window.api.ui.displayElement.update(instanceId, {
          settings: { ...currentSettings },
        });
        updateVisibility();
      };

      const normalizedSections = getNormalizedSections();
      // 패널(renderPluginSettingsForm)과 동일한 섹션 카드 구조·토큰 — section이
      // 없어도 암시적 카드 하나로 렌더 (모달-패널 외형 통합, 2026-07-12 결정)
      let htmlContent =
        '<div class="flex flex-col gap-[12px] w-full text-left">';

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
            const labelText = translate(schema.label, undefined, schema.label);
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
              componentHtml = window.api.ui.components.checkbox({
                checked: !!value,
                onChange: wrappedChange as unknown as (
                  checked: boolean,
                ) => void | Promise<void>,
              });
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

                window.api.ui.pickColor({
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

              const handlerId = handlerRegistry.register(
                pluginId,
                handleColorClick,
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

              componentHtml = window.api.ui.components.input({
                type:
                  schema.type === 'string' ? 'text' : (schema.type as 'number'),
                value: value as string | number,
                onChange: wrappedChange as unknown as (
                  value: string,
                ) => void | Promise<void>,
                min: schema.min,
                max: schema.max,
                step: schema.step,
                placeholder: placeholderText,
                width: inputWidth,
              });
            } else if (schema.type === 'select') {
              const translatedOptions = (schema.options || []).map(
                (option: { label: string; value: string }) => ({
                  ...option,
                  label: translate(option.label, undefined, option.label),
                }),
              );
              componentHtml = window.api.ui.components.dropdown({
                options: translatedOptions,
                selected: value as string,
                onChange: wrappedChange as unknown as (
                  value: string,
                ) => void | Promise<void>,
              });
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

      const noSettingsText = await window.api.settings
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

      const [saveText, cancelText] = await window.api.settings
        .get()
        .then((s) => {
          const locale = s.language || 'ko';
          return locale === 'en' ? ['Apply', 'Cancel'] : ['저장', '취소'];
        })
        .catch(() => ['저장', '취소']);

      const confirmed = await window.api.ui.dialog.custom(htmlContent, {
        showCancel: true,
        confirmText: saveText,
        cancelText: cancelText,
      });

      if (!confirmed) {
        window.api.ui.displayElement.update(instanceId, {
          settings: originalSettings,
        });
      }
    };

    const handleElementClick = (e: Event) => {
      if (!useModalSettings) return;
      const target = e.currentTarget as HTMLElement;
      const instanceId = target.getAttribute('data-plugin-element');
      if (instanceId) {
        openInstanceSettings(instanceId);
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

      const menuId = window.api.ui.contextMenu.addGridMenuItem({
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

          window.api.ui.displayElement.add({
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
        },
      });

      registerCleanup(() => {
        window.api.ui.contextMenu.removeMenuItem(menuId);
      });
    }

    // Undo/Redo를 위한 요소 복원 함수 등록
    const restoreElementForUndo = (
      savedElement: PluginDisplayElementInternal,
    ) => {
      const previousPluginId = window.__dmn_current_plugin_id;
      window.__dmn_current_plugin_id = pluginId;

      try {
        const onClickId = useModalSettings
          ? handlerRegistry.register(pluginId, handleElementClick)
          : undefined;

        const restoredElement = {
          ...savedElement,
          onClick: onClickId,
          _onClickId: onClickId,
          contextMenu: {
            enableDelete: true,
            deleteLabel: definition.contextMenu?.delete || '삭제',
            customItems: buildCustomContextMenuItems(),
          },
        };

        return restoredElement;
      } finally {
        window.__dmn_current_plugin_id = previousPluginId;
      }
    };

    // 전역에 복원 함수 등록
    if (!window.__dmn_element_restorers) {
      window.__dmn_element_restorers = new Map();
    }
    window.__dmn_element_restorers.set(defId, restoreElementForUndo);

    // 플러그인 클린업 시 복원 함수 제거
    registerCleanup(() => {
      window.__dmn_element_restorers?.delete(defId);
    });

    if (instanceLifecycle) {
      const restoreTimer = setTimeout(() => {
        void instanceLifecycle
          .startRestore(
            () => {
              const keyState = useKeyStore.getState();
              return buildValidTabIdSet(
                keyState.customTabs.map((tab) => tab.id),
              );
            },
            (savedInstances, readiness) => {
              instanceSaveBarrier.runRestoreMutation(() => {
                if (readiness === 'failed') {
                  console.warn(
                    `[Plugin ${pluginId}] Bootstrap timed out; restoring all instances`,
                  );
                }

                const maxInstances = definition.maxInstances;
                let instancesToRestore = savedInstances;

                if (maxInstances && maxInstances > 0) {
                  const instancesByTab = new Map<string, SavedInstance[]>();
                  savedInstances.forEach((instance) => {
                    const tabId = normalizePluginInstanceTabId(instance.tabId);
                    if (!instancesByTab.has(tabId)) {
                      instancesByTab.set(tabId, []);
                    }
                    instancesByTab.get(tabId)!.push(instance);
                  });

                  instancesToRestore = [];
                  instancesByTab.forEach((instances) => {
                    instancesToRestore.push(
                      ...instances.slice(0, maxInstances),
                    );
                  });
                }

                instancesToRestore.forEach((instance) => {
                  // 비동기 복원 중 플러그인 컨텍스트 재설정
                  window.__dmn_current_plugin_id = pluginId;

                  window.api.ui.displayElement.add({
                    html: '<!-- plugin-element -->',
                    position: instance.position,
                    draggable: true,
                    definitionId: defId,
                    settings: omitLayoutSettingValues(
                      definition.settings,
                      instance.settings || { ...defaultSettings },
                    ) as Record<string, string | number | boolean>,
                    state: definition.previewState || {},
                    measuredSize: instance.measuredSize,
                    tabId: normalizePluginInstanceTabId(instance.tabId),
                    onClick: useModalSettings ? handleElementClick : undefined,
                    contextMenu: {
                      enableDelete: true,
                      deleteLabel: definition.contextMenu?.delete || '삭제',
                      customItems: buildCustomContextMenuItems(),
                    },
                  } as unknown as PluginDisplayElementConfig);
                });
              });
            },
          )
          .then(
            () => {
              if (instanceSaveBarrier.finishRestoration()) {
                void saveInstances().catch((error) => {
                  console.error(
                    `[Plugin ${pluginId}] Failed to flush pending instance changes:`,
                    error,
                  );
                });
              }
            },
            (error) => {
              instanceSaveBarrier.cancelRestoration();
              console.error(
                `[Plugin ${pluginId}] Failed to restore instances:`,
                error,
              );
            },
          );
      }, 0);

      registerCleanup(() => {
        clearTimeout(restoreTimer);
        instanceLifecycle.dispose();
        instanceSaveBarrier.cancelRestoration();
      });
    } else {
      instanceSaveBarrier.finishRestoration();
    }
  };
};
