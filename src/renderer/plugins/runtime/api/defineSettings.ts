/**
 * defineSettings API 구현
 * 플러그인 전역 설정을 정의하는 기능을 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  openPluginSettingsSession,
  cancelPluginSettingsSessionForPlugin,
} from '@plugins/rpc/pluginSettingsSession';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
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
  PluginSettingsDefinition,
  PluginSettingsInstance,
  DMNoteAPI,
  Unsubscribe,
} from '@src/types/plugin/api';

interface DefineSettingsDependencies {
  pluginId: string;
  api: DMNoteAPI;
  namespacedStorage: NamespacedStorage;
  registerCleanup: (cleanup: () => void) => void;
}

/**
 * defineSettings 함수를 생성합니다.
 */
export const createDefineSettings = (deps: DefineSettingsDependencies) => {
  const { pluginId, api, namespacedStorage, registerCleanup } = deps;
  const visibilityErrorKeys = new Set<string>();

  return (definition: PluginSettingsDefinition): PluginSettingsInstance => {
    const SETTINGS_KEY = '__plugin_settings__';

    // 기본값 계산
    const defaultSettings: Record<string, unknown> = getDefaultSettings(
      definition.settings,
    );

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

          sendBridgeMessageBestEffort('overlay', 'plugin:settings:changed', {
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
          currentSettings = omitLayoutSettingValues(definition.settings, {
            ...defaultSettings,
            ...(saved as Record<string, unknown>),
          });
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

    // 설정 노브로그 열기
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
          dialogSettings,
          reportNormalizationError,
        );
      const modalScope = `plugin-settings-${encodeURIComponent(pluginId)}`;
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

      const commitSettingValue = (key: string, newValue: unknown) => {
        const prev = window.__dmn_current_plugin_id;
        window.__dmn_current_plugin_id = pluginId;
        try {
          dialogSettings[key] = newValue;
          applyPreview(dialogSettings);
          updateVisibility();
        } finally {
          window.__dmn_current_plugin_id = prev;
        }
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
                dialogSettings[key] !== undefined
                  ? dialogSettings[key]
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

              const handleChange = (newValue: unknown) => {
                // DOM 문자열을 스키마 타입으로 복원, 복원 불가면 커밋 스킵
                const coerced = coerceSettingValue(schema, newValue);
                if (coerced === null) return;
                commitSettingValue(key, coerced);
              };

              if (schema.type === 'boolean') {
                componentHtml = modalHandlers.capture(() =>
                  api.ui.components.checkbox({
                    checked: !!value,
                    onChange: handleChange as (
                      checked: boolean,
                    ) => void | Promise<void>,
                  }),
                );
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

                  target.classList.add('shadow-focus-ring');

                  api.ui.pickColor({
                    initialColor: String(dialogSettings[key] ?? ''),
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
                      commitSettingValue(key, newColor);
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
                    onChange: handleChange as (
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
                    onChange: handleChange as (
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
      } finally {
        modalHandlers.dispose();
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
        openPluginSettingsSession({
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
      const bridgeCleanup = api.bridge?.on(
        'plugin:settings:changed',
        (data: { pluginId: string; settings: Record<string, unknown> }) => {
          if (data.pluginId === pluginId) {
            const oldSettings = { ...currentSettings };
            currentSettings = omitLayoutSettingValues(definition.settings, {
              ...defaultSettings,
              ...data.settings,
            });

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

    // plugin unload·runtime reload 시 열려 있는 설정 세션 settle(false)
    if (window.__dmn_window_type === 'main') {
      registerCleanup(() => cancelPluginSettingsSessionForPlugin(pluginId));
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
        currentSettings = omitLayoutSettingValues(definition.settings, {
          ...currentSettings,
          ...updates,
        });
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
