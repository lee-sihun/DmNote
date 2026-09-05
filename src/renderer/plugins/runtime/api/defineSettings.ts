/**
 * defineSettings API 구현
 * 플러그인 전역 설정을 정의하는 기능을 제공합니다.
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  openPluginSettingsSession,
  cancelPluginSettingsSessionForPlugin,
} from '@plugins/runtime/pluginSettingsSession';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import {
  getDefaultSettings,
  omitLayoutSettingValues,
} from '../settingsSections';
import { createPluginSettingsDialogContent } from './pluginSettingsDialogContent';
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
    const saveSettings = async (
      previousSettings: Record<string, unknown>,
    ): Promise<void> => {
      const attemptedSettings = currentSettings;
      try {
        await namespacedStorage.set(SETTINGS_KEY, attemptedSettings);
      } catch (err) {
        console.error(`[Plugin ${pluginId}] Failed to save settings:`, err);
        let restoredSettings = previousSettings;
        try {
          const saved = await namespacedStorage.get(SETTINGS_KEY);
          restoredSettings = omitLayoutSettingValues(definition.settings, {
            ...defaultSettings,
            ...(saved && typeof saved === 'object' ? saved : {}),
          });
        } catch (syncError) {
          console.error(
            `[Plugin ${pluginId}] Failed to reload settings:`,
            syncError,
          );
        }
        // 실패 뒤 시작된 새 편집은 복원으로 덮지 않음
        if (currentSettings === attemptedSettings) {
          currentSettings = { ...restoredSettings };
          triggerPanelRerender();
          notifyOverlay(currentSettings);
        }
        throw err;
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
      const modalScope = `plugin-settings-${encodeURIComponent(pluginId)}`;
      const dialogContent = await createPluginSettingsDialogContent({
        pluginId,
        api,
        settingsDefinition: definition.settings,
        settings: dialogSettings,
        modalScope,
        translate,
        createColorPickerId: (key) => `plugin-settings-${pluginId}-${key}`,
        onNormalizationError: reportNormalizationError,
        onSettingValueChange: (key, newValue, updateVisibility) => {
          const prev = window.__dmn_current_plugin_id;
          window.__dmn_current_plugin_id = pluginId;
          try {
            dialogSettings[key] = newValue;
            applyPreview(dialogSettings);
            updateVisibility();
          } finally {
            window.__dmn_current_plugin_id = prev;
          }
        },
      });

      try {
        const confirmed = await api.ui.dialog.custom(
          dialogContent.htmlContent,
          {
            showCancel: true,
            confirmText: dialogContent.confirmText,
            cancelText: dialogContent.cancelText,
          },
        );

        if (confirmed) {
          // 확인: 현재 설정을 저장 (미리보기 상태가 이미 currentSettings에 반영됨)
          await saveSettings(originalSettings);

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
        dialogContent.dispose();
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
            await saveSettings(prevSettings);

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
        await saveSettings(oldSettings);

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
        await saveSettings(oldSettings);

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
