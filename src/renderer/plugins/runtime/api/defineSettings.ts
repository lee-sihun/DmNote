/**
 * defineSettings API 구현
 * 플러그인 전역 설정을 정의하는 기능을 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { handlerRegistry } from '../handlers';
import type { NamespacedStorage } from '../context';
import type {
  PluginSettingsDefinition,
  PluginSettingsInstance,
  Unsubscribe,
} from '@src/types/plugin/api';

interface DefineSettingsDependencies {
  pluginId: string;
  namespacedStorage: NamespacedStorage;
  registerCleanup: (cleanup: () => void) => void;
}

/**
 * defineSettings 함수를 생성합니다.
 */
export const createDefineSettings = (deps: DefineSettingsDependencies) => {
  const { pluginId, namespacedStorage, registerCleanup } = deps;

  return (definition: PluginSettingsDefinition): PluginSettingsInstance => {
    const SETTINGS_KEY = '__plugin_settings__';

    // 기본값 계산
    const defaultSettings: Record<string, unknown> = {};
    if (definition.settings) {
      for (const [key, schema] of Object.entries(definition.settings)) {
        if (schema.type !== 'divider') {
          defaultSettings[key] = schema.default;
        }
      }
    }

    // 현재 설정값 (메모리 캐시)
    let currentSettings: Record<string, unknown> = { ...defaultSettings };
    let isInitialized = false;

    // 설정 변경 구독자 목록
    const subscribers: Set<
      (
        newSettings: Record<string, unknown>,
        oldSettings: Record<string, unknown>,
      ) => void
    > = new Set();

    // 모든 구독자에게 변경 알림
    const notifySubscribers = (
      newSettings: Record<string, unknown>,
      oldSettings: Record<string, unknown>,
    ) => {
      subscribers.forEach((listener) => {
        try {
          listener(newSettings, oldSettings);
        } catch (err) {
          console.error(
            `[Plugin ${pluginId}] Error in settings subscriber:`,
            err,
          );
        }
      });
    };

    // 같은 플러그인의 모든 패널 리렌더링 트리거
    const triggerPanelRerender = () => {
      const elements = usePluginDisplayElementStore
        .getState()
        .elements.filter((el) => el.pluginId === pluginId);

      elements.forEach((el) => {
        // state에 _settingsVersion을 증가시켜 리렌더링 트리거
        const currentState = el.state || {};
        const version = (Number(currentState._settingsVersion) || 0) + 1;
        usePluginDisplayElementStore.getState().updateElement(el.fullId, {
          state: { ...currentState, _settingsVersion: version },
        });
      });
    };

    // 오버레이에 설정 변경 알림 (메인 → 오버레이 동기화)
    const notifyOverlay = (newSettings: Record<string, unknown>) => {
      if (window.__dmn_window_type === 'main') {
        try {
          // JSON 직렬화/역직렬화로 순수 데이터만 복사 (순환 참조 및 특수 객체 제거)
          const safeSettings = JSON.parse(JSON.stringify(newSettings));

          window.api?.bridge?.sendTo('overlay', 'plugin:settings:changed', {
            pluginId,
            settings: safeSettings,
          });
        } catch (err) {
          console.error(`[Plugin ${pluginId}] Failed to notify overlay:`, err);
        }
      }
    };

    // 번역 함수
    const translate = (
      key: string,
      params?: Record<string, string | number>,
      fallback?: string,
    ): string => {
      if (!definition.messages) return fallback || key;
      return translatePluginMessage({
        messages: definition.messages,
        locale: window.__dmn_current_locale || 'ko',
        key,
        params,
        fallback,
      });
    };

    // storage에서 설정 로드
    const loadSettings = async (): Promise<void> => {
      try {
        const saved = await namespacedStorage.get(SETTINGS_KEY);
        if (saved && typeof saved === 'object') {
          currentSettings = {
            ...defaultSettings,
            ...(saved as Record<string, unknown>),
          };
        }
        isInitialized = true;
      } catch (err) {
        console.error(`[Plugin ${pluginId}] Failed to load settings:`, err);
        isInitialized = true;
      }
    };

    // storage에 설정 저장
    const saveSettings = async (): Promise<void> => {
      try {
        await namespacedStorage.set(SETTINGS_KEY, currentSettings);
      } catch (err) {
        console.error(`[Plugin ${pluginId}] Failed to save settings:`, err);
      }
    };

    // 설정 다이얼로그 열기
    const openSettingsDialogModal = async (): Promise<boolean> => {
      if (!isInitialized) {
        await loadSettings();
      }

      const dialogSettings = { ...currentSettings };
      const originalSettings = { ...currentSettings };

      // 실시간 미리보기 적용 함수
      const applyPreview = (newSettings: Record<string, unknown>) => {
        currentSettings = { ...newSettings };
        triggerPanelRerender();
        notifyOverlay(currentSettings);
      };

      // ── 조건부 visibility 헬퍼 ──
      const _evalVisible = (
        visible:
          | boolean
          | ((settings: Record<string, unknown>) => boolean)
          | undefined,
        settings: Record<string, unknown>,
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
            el.style.display = _evalVisible(
              s.visible as
                | boolean
                | ((settings: Record<string, unknown>) => boolean)
                | undefined,
              dialogSettings,
            )
              ? ''
              : 'none';
        }
      };

      let htmlContent =
        '<div class="flex flex-col gap-[19px] w-full text-left">';

      if (definition.settings && Object.keys(definition.settings).length > 0) {
        for (const [key, schema] of Object.entries(definition.settings)) {
          const _vis = _evalVisible(
            schema.visible as
              | boolean
              | ((settings: Record<string, unknown>) => boolean)
              | undefined,
            dialogSettings,
          );
          if (schema.type === 'divider') {
            htmlContent += `<div data-setting-key="${key}" style="${
              _vis ? '' : 'display:none'
            }" class="w-full h-[1px] bg-[#3A3943]"></div>`;
          } else {
            const value =
              dialogSettings[key] !== undefined
                ? dialogSettings[key]
                : schema.default;
            let componentHtml = '';
            const labelText = translate(schema.label, undefined, schema.label);
            const placeholderText =
              typeof schema.placeholder === 'string'
                ? translate(schema.placeholder, undefined, schema.placeholder)
                : schema.placeholder;

            const handleChange = (newValue: unknown) => {
              // 플러그인 컨텍스트 설정
              const prev = window.__dmn_current_plugin_id;
              window.__dmn_current_plugin_id = pluginId;
              try {
                dialogSettings[key] = newValue;
                // 실시간 미리보기 적용
                applyPreview(dialogSettings);
                _updateVisibility();
              } finally {
                window.__dmn_current_plugin_id = prev;
              }
            };

            if (schema.type === 'boolean') {
              componentHtml = window.api.ui.components.checkbox({
                checked: !!value,
                onChange: handleChange as (
                  checked: boolean,
                ) => void | Promise<void>,
              });
            } else if (schema.type === 'color') {
              const handleColorClick = (e: Event) => {
                const target = (e.target as HTMLElement).closest('button');
                if (!target) return;

                const pickerId = `plugin-settings-${pluginId}-${key}`;

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

                target.classList.remove('border-[#3A3943]');
                target.classList.add('border-[#459BF8]');

                window.api.ui.pickColor({
                  initialColor: String(dialogSettings[key] ?? ''),
                  id: pickerId,
                  referenceElement: target as HTMLElement,
                  onColorChange: (newColor) => {
                    // 컬러피커 프리뷰만 업데이트 (버튼 내 색상 미리보기)
                    const preview = target.querySelector('div');
                    if (preview) preview.style.backgroundColor = newColor;
                  },
                  onColorChangeComplete: (newColor) => {
                    // 마우스를 떼었을 때 실제 적용
                    dialogSettings[key] = newColor;
                    applyPreview(dialogSettings);
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
                type:
                  schema.type === 'string' ? 'text' : (schema.type as 'number'),
                value: value as string | number,
                onChange: handleChange as (
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
                onChange: handleChange as (
                  value: string,
                ) => void | Promise<void>,
              });
            }

            htmlContent += `
            <div data-setting-key="${key}" style="${
              _vis ? '' : 'display:none'
            }" class="flex justify-between w-full items-center">
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
            const locale = s.language || 'ko';
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
          const locale = s.language || 'ko';
          return locale === 'en' ? ['Apply', 'Cancel'] : ['저장', '취소'];
        })
        .catch(() => ['저장', '취소']);

      const confirmed = await window.api.ui.dialog.custom(htmlContent, {
        showCancel: true,
        confirmText: saveText,
        cancelText: cancelText,
      });

      if (confirmed) {
        // 확인: 현재 설정을 저장 (미리보기 상태가 이미 currentSettings에 반영됨)
        await saveSettings();

        // onChange 콜백 호출
        if (definition.onChange) {
          try {
            definition.onChange(currentSettings, originalSettings);
          } catch (err) {
            console.error(
              `[Plugin ${pluginId}] Error in onChange callback:`,
              err,
            );
          }
        }

        // 구독자에게 알림
        notifySubscribers(currentSettings, originalSettings);

        return true;
      } else {
        // 취소: 원래 설정으로 복원
        currentSettings = { ...originalSettings };
        triggerPanelRerender();
        notifyOverlay(currentSettings);

        return false;
      }
    };

    // 설정 패널 열기 (속성 패널 방식)
    const openSettingsPanel = async (): Promise<boolean> => {
      if (!isInitialized) {
        await loadSettings();
      }

      const panelSettings = { ...currentSettings };
      const originalSettings = { ...currentSettings };

      const applyPreview = (newSettings: Record<string, unknown>) => {
        currentSettings = { ...newSettings };
        triggerPanelRerender();
        notifyOverlay(currentSettings);
      };

      return new Promise((resolve) => {
        usePropertiesPanelStore.getState().openPluginSettingsPanel({
          pluginId,
          definition,
          settings: panelSettings,
          originalSettings,
          onChange: (nextSettings) => {
            const prev = window.__dmn_current_plugin_id;
            window.__dmn_current_plugin_id = pluginId;
            try {
              applyPreview(nextSettings);
            } finally {
              window.__dmn_current_plugin_id = prev;
            }
          },
          onConfirm: async (nextSettings, prevSettings) => {
            currentSettings = { ...nextSettings };
            await saveSettings();

            if (definition.onChange) {
              try {
                definition.onChange(currentSettings, prevSettings);
              } catch (err) {
                console.error(
                  `[Plugin ${pluginId}] Error in onChange callback:`,
                  err,
                );
              }
            }

            notifySubscribers(currentSettings, prevSettings);
          },
          onCancel: (prevSettings) => {
            currentSettings = { ...prevSettings };
            triggerPanelRerender();
            notifyOverlay(currentSettings);
          },
          resolve,
        });
      });
    };

    const openSettingsDialog = async (): Promise<boolean> => {
      const settingsUI = definition.settingsUI ?? 'panel';
      const canUsePanel =
        settingsUI !== 'modal' && window.__dmn_window_type === 'main';

      if (canUsePanel) {
        try {
          return await openSettingsPanel();
        } catch (error) {
          console.error(
            `[Plugin ${pluginId}] Failed to open settings panel:`,
            error,
          );
        }
      }

      return openSettingsDialogModal();
    };

    // 오버레이에서 설정 변경 메시지 수신 리스너
    if (window.__dmn_window_type === 'overlay') {
      const bridgeCleanup = window.api?.bridge?.on(
        'plugin:settings:changed',
        (data: { pluginId: string; settings: Record<string, unknown> }) => {
          if (data.pluginId === pluginId) {
            const oldSettings = { ...currentSettings };
            currentSettings = { ...defaultSettings, ...data.settings };

            // onChange 콜백 호출
            if (definition.onChange) {
              try {
                definition.onChange(currentSettings, oldSettings);
              } catch (err) {
                console.error(
                  `[Plugin ${pluginId}] Error in onChange callback:`,
                  err,
                );
              }
            }

            // 구독자에게 알림
            notifySubscribers(currentSettings, oldSettings);

            // 패널 리렌더링 트리거
            triggerPanelRerender();
          }
        },
      );

      if (bridgeCleanup) {
        registerCleanup(bridgeCleanup);
      }
    }

    // 초기 설정 로드 (비동기)
    loadSettings();

    // PluginSettingsInstance 반환
    const instance: PluginSettingsInstance = {
      get: () => {
        return { ...currentSettings };
      },
      set: async (updates: Record<string, unknown>) => {
        const oldSettings = { ...currentSettings };
        currentSettings = { ...currentSettings, ...updates };
        await saveSettings();

        // onChange 콜백 호출
        if (definition.onChange) {
          try {
            definition.onChange(currentSettings, oldSettings);
          } catch (err) {
            console.error(
              `[Plugin ${pluginId}] Error in onChange callback:`,
              err,
            );
          }
        }

        // 구독자에게 알림
        notifySubscribers(currentSettings, oldSettings);

        // 같은 플러그인의 패널 리렌더링
        triggerPanelRerender();

        // 오버레이에 설정 변경 알림
        notifyOverlay(currentSettings);
      },
      open: openSettingsDialog,
      reset: async () => {
        const oldSettings = { ...currentSettings };
        currentSettings = { ...defaultSettings };
        await saveSettings();

        // onChange 콜백 호출
        if (definition.onChange) {
          try {
            definition.onChange(currentSettings, oldSettings);
          } catch (err) {
            console.error(
              `[Plugin ${pluginId}] Error in onChange callback:`,
              err,
            );
          }
        }

        // 구독자에게 알림
        notifySubscribers(currentSettings, oldSettings);

        // 같은 플러그인의 패널 리렌더링
        triggerPanelRerender();

        // 오버레이에 설정 변경 알림
        notifyOverlay(currentSettings);
      },
      subscribe: (
        listener: (
          newSettings: Record<string, unknown>,
          oldSettings: Record<string, unknown>,
        ) => void,
      ): Unsubscribe => {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
    };

    return instance;
  };
};
