/**
 * defineElement API 구현
 * 플러그인에서 커스텀 UI 요소를 정의하는 기능을 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/useKeyStore';
import { useStatItemStore } from '@stores/useStatItemStore';
import { useGraphItemStore } from '@stores/useGraphItemStore';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { handlerRegistry } from '../handlers';
import type { NamespacedStorage } from '../context';
import type {
  PluginDefinition,
  PluginDefinitionInternal,
} from '@src/types/api';

interface DefineElementDependencies {
  pluginId: string;
  namespacedStorage: NamespacedStorage;
  registerCleanup: (cleanup: () => void) => void;
  wrapFunctionWithContext: (fn: any) => any;
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

  return (definition: PluginDefinition) => {
    const defId = pluginId;
    const internalDef: PluginDefinitionInternal = {
      ...definition,
      id: defId,
      pluginId: pluginId,
    };

    usePluginDisplayElementStore.getState().registerDefinition(internalDef);

    const INSTANCES_KEY = 'instances';

    // 복원 중에는 saveInstances가 호출되지 않도록 플래그 설정
    let isRestoring = true;

    const saveInstances = async () => {
      // 전역 리로드 중이거나 개별 복원 중에는 저장하지 않음
      if (isReloading() || isRestoring) return;

      const elements = usePluginDisplayElementStore
        .getState()
        .elements.filter((el) => el.definitionId === defId);

      const instances = elements.map((el) => ({
        position: el.position,
        settings: el.settings,
        measuredSize: el.measuredSize,
        tabId: el.tabId,
      }));

      await namespacedStorage.set(INSTANCES_KEY, instances);
    };

    if ((window as any).__dmn_window_type === 'main') {
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
            saveInstances();
          }
        },
      );
      registerCleanup(unsubStore);
    }

    const defaultSettings: Record<string, any> = {};
    if (definition.settings) {
      Object.entries(definition.settings).forEach(([key, schema]) => {
        if (schema.type !== 'divider') {
          defaultSettings[key] = schema.default;
        }
      });
    }

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
        .then((settings) => applyLocale((settings as any)?.language))
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
            return (...args: any[]) => {
              try {
                window.api?.bridge?.sendTo(
                  'overlay',
                  'plugin:displayElement:invokeAction',
                  {
                    elementId,
                    action: prop,
                    args,
                  },
                );
              } catch (error) {
                console.error(
                  `[Plugin ${pluginId}] Failed to invoke exposed action '${String(
                    prop,
                  )}'`,
                  error,
                );
              }
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
        onClick: (ctx: any) => {
          const actions =
            ctx?.actions || buildActionsProxy(ctx?.element?.fullId || '');

          if (typeof item.onClick === 'function') {
            return item.onClick({ ...ctx, actions });
          }

          if (
            item.action &&
            typeof (actions as any)[item.action] === 'function'
          ) {
            return (actions as any)[item.action]();
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
      const { pushState } = await import('@stores/useHistoryStore').then((m) =>
        m.useHistoryStore.getState(),
      );
      pushState(
        keyMappings,
        positions,
        statPositions,
        graphPositions,
        pluginElements,
      );

      const currentSettings = {
        ...defaultSettings,
        ...(element.settings || {}),
      };
      const originalSettings = { ...currentSettings };

      let htmlContent =
        '<div class="flex flex-col gap-[19px] w-full text-left">';

      const _evalVisible = (
        visible:
          | boolean
          | ((settings: Record<string, any>) => boolean)
          | undefined,
        settings: Record<string, any>,
      ): boolean => {
        if (visible === undefined) return true;
        return typeof visible === 'function' ? visible(settings) : visible;
      };

      const _updateVisibility = () => {
        if (!definition.settings) return;
        for (const [k, s] of Object.entries(definition.settings)) {
          if (s.visible === undefined) continue;
          const el = document.querySelector(
            `[data-setting-key="${k}"]`,
          ) as HTMLElement | null;
          if (el)
            el.style.display = _evalVisible(s.visible, currentSettings)
              ? ''
              : 'none';
        }
      };

      if (definition.settings) {
        for (const [key, schema] of Object.entries(definition.settings)) {
          const _vis = _evalVisible(schema.visible, currentSettings);
          if (schema.type === 'divider') {
            htmlContent += `<div data-setting-key="${key}" style="${_vis ? '' : 'display:none'}" class="w-full h-[1px] bg-[#3A3943]"></div>`;
          } else {
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

            const handleChange = async (newValue: any) => {
              currentSettings[key] = newValue;
              const newSettings = { ...currentSettings };

              window.api.ui.displayElement.update(instanceId, {
                settings: newSettings,
              });
              _updateVisibility();
            };

            const wrappedChange = wrapFunctionWithContext(handleChange);

            if (schema.type === 'boolean') {
              componentHtml = window.api.ui.components.checkbox({
                checked: !!value,
                onChange: wrappedChange,
              });
            } else if (schema.type === 'color') {
              const handleColorClick = (e: any) => {
                const target = (e.target as HTMLElement).closest('button');
                if (!target) return;

                const pickerId = `plugin-${pluginId}-${instanceId}-${key}`;

                if (
                  (window as any).__dmn_showColorPicker &&
                  (window as any).__dmn_getColorPickerState
                ) {
                  const state = (window as any).__dmn_getColorPickerState();
                  if (state?.isOpen && state.id === pickerId) {
                    (window as any).__dmn_showColorPicker({
                      initialColor: state.color,
                      id: pickerId,
                    });
                    return;
                  }
                }

                target.classList.remove('border-[#3A3943]');
                target.classList.add('border-[#459BF8]');

                window.api.ui.pickColor({
                  initialColor: currentSettings[key],
                  id: pickerId,
                  referenceElement: target as HTMLElement,
                  onColorChange: (newColor) => {
                    const preview = target.querySelector('div');
                    if (preview) preview.style.backgroundColor = newColor;
                  },
                  onColorChangeComplete: (newColor) => {
                    wrappedChange(newColor);
                  },
                  onClose: () => {
                    target.classList.remove('border-[#459BF8]');
                    target.classList.add('border-[#3A3943]');
                  },
                });
              };

              const handlerId = handlerRegistry.register(
                pluginId,
                handleColorClick,
              );

              componentHtml = `
              <button type="button" 
                class="relative w-[80px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] flex items-center justify-center text-[#DBDEE8] text-style-2"
                data-plugin-handler="${handlerId}"
              >
                <div class="absolute left-[6px] top-[4.5px] w-[11px] h-[11px] rounded-[2px] border border-[#3A3943]" style="background-color: ${value}"></div>
                <span class="ml-[16px] text-left truncate w-[50px]">Linear</span>
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
                type: schema.type === 'string' ? 'text' : (schema.type as any),
                value: value,
                onChange: wrappedChange,
                min: schema.min,
                max: schema.max,
                step: schema.step,
                placeholder: placeholderText,
                width: inputWidth,
              });
            } else if (schema.type === 'select') {
              const translatedOptions = (schema.options || []).map(
                (option: { label: string; value: any }) => ({
                  ...option,
                  label: translate(option.label, undefined, option.label),
                }),
              );
              componentHtml = window.api.ui.components.dropdown({
                options: translatedOptions,
                selected: value,
                onChange: wrappedChange,
              });
            }

            htmlContent += `
            <div data-setting-key="${key}" style="${_vis ? '' : 'display:none'}" class="flex justify-between w-full items-center">
              <p class="text-white text-style-2">${labelText}</p>
              ${componentHtml}
            </div>
          `;
          }
        }
      } else {
        const noSettingsText = await window.api.settings
          .get()
          .then((s) => {
            const locale = (s as any).language || 'ko';
            return locale === 'en'
              ? 'No settings available.'
              : '설정할 항목이 없습니다.';
          })
          .catch(() => '설정할 항목이 없습니다.');
        htmlContent += `<div class="text-gray-400 text-center">${noSettingsText}</div>`;
      }

      htmlContent += '</div>';

      const [saveText, cancelText] = await window.api.settings
        .get()
        .then((s) => {
          const locale = (s as any).language || 'ko';
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

    if ((window as any).__dmn_window_type === 'main') {
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
          } as any);
        },
      });

      registerCleanup(() => {
        window.api.ui.contextMenu.removeMenuItem(menuId);
      });
    }

    // Undo/Redo를 위한 요소 복원 함수 등록
    const restoreElementForUndo = (savedElement: any) => {
      const previousPluginId = (window as any).__dmn_current_plugin_id;
      (window as any).__dmn_current_plugin_id = pluginId;

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
        (window as any).__dmn_current_plugin_id = previousPluginId;
      }
    };

    // 전역에 복원 함수 등록
    if (!(window as any).__dmn_element_restorers) {
      (window as any).__dmn_element_restorers = new Map();
    }
    (window as any).__dmn_element_restorers.set(defId, restoreElementForUndo);

    // 플러그인 클린업 시 복원 함수 제거
    registerCleanup(() => {
      (window as any).__dmn_element_restorers?.delete(defId);
    });

    // 인스턴스 복원
    setTimeout(async () => {
      try {
        if ((window as any).__dmn_window_type === 'main') {
          const savedInstances = (await namespacedStorage.get(
            INSTANCES_KEY,
          )) as any[];

          if (savedInstances && Array.isArray(savedInstances)) {
            // maxInstances 제한 적용: 탭별로 제한 개수만큼만 복원
            const maxInstances = definition.maxInstances;
            let instancesToRestore = savedInstances;

            if (maxInstances && maxInstances > 0) {
              // 탭별로 그룹화
              const instancesByTab = new Map<string, any[]>();
              savedInstances.forEach((inst) => {
                const tabId = inst.tabId || '4key'; // 기본 탭
                if (!instancesByTab.has(tabId)) {
                  instancesByTab.set(tabId, []);
                }
                instancesByTab.get(tabId)!.push(inst);
              });

              // 각 탭별로 maxInstances만큼만 선택
              instancesToRestore = [];
              instancesByTab.forEach((instances) => {
                instancesToRestore.push(...instances.slice(0, maxInstances));
              });
            }

            instancesToRestore.forEach((inst) => {
              // 각 add 호출 직전에 plugin context 재설정 (비동기 경합 방지)
              (window as any).__dmn_current_plugin_id = pluginId;

              window.api.ui.displayElement.add({
                html: '<!-- plugin-element -->',
                position: inst.position,
                draggable: true,
                definitionId: defId,
                settings: inst.settings || { ...defaultSettings },
                state: definition.previewState || {},
                measuredSize: inst.measuredSize,
                tabId: inst.tabId,
                onClick: useModalSettings ? handleElementClick : undefined,
                contextMenu: {
                  enableDelete: true,
                  deleteLabel: definition.contextMenu?.delete || '삭제',
                  customItems: buildCustomContextMenuItems(),
                },
              } as any);
            });
          }
        }
      } catch (err) {
        console.error(`[Plugin ${pluginId}] Failed to restore instances:`, err);
      } finally {
        isRestoring = false;
      }
    }, 0);
  };
};
