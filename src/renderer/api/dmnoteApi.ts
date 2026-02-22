import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePluginMenuStore } from "@stores/usePluginMenuStore";
import {
  createButton,
  createCheckbox,
  createInput,
  createDropdown,
  createPanel,
  createFormRow,
} from "@utils/pluginComponents";
import { setupPluginDropdownInteractions } from "@utils/pluginDropdownManager";
import { displayElementApi } from "./pluginDisplayElements";
import { rawKeyEventBus } from "@utils/rawKeyEventBus";
import { keyStatsService } from "@utils/keyStatsService";

import type {
  CssLoadResult,
  CssSetContentResult,
  CssTogglePayload,
  CustomTabDeleteResult,
  CustomTabResult,
  DMNoteAPI,
  KeyCounterUpdate,
  KeysModeResponse,
  KeysResetAllResponse,
  OverlayBounds,
  OverlayAnchorPayload,
  OverlayLockPayload,
  OverlayResizePayload,
  OverlayState,
  OverlayVisibilityPayload,
  Unsubscribe,
  ModeChangePayload,
  CustomTabsChangePayload,
  KeyStatePayload,
  PresetOperationResult,
  JsLoadResult,
  JsSetContentResult,
  JsTogglePayload,
  JsReloadResult,
  JsRemoveResult,
  JsPluginUpdateResult,
  BridgeMessage,
  BridgeMessageListener,
  BridgeAnyListener,
  WindowTarget,
  ButtonOptions,
  CheckboxOptions,
  InputOptions,
  DropdownOptions,
  PanelOptions,
  PluginDisplayElementConfig,
  PluginDisplayElementInternal,
  RawInputPayload,
  KeyStatsPayload,
  AppAutoUpdateResult,
} from "@src/types/api";
import type { BootstrapPayload } from "@src/types/app";
import type { CustomCss } from "@src/types/css";
import type { CustomJs } from "@src/types/js";
import type {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
} from "@src/types/keys";
import type { StatItemPositions } from "@src/types/statItems";
import type { GraphItemPositions } from "@src/types/graphItems";
import type { LayerGroups } from "@src/types/layerGroups";
import type {
  SettingsState,
  SettingsPatchInput,
  SettingsDiff,
} from "@src/types/settings";

const LOCALE_STORAGE_KEY = "dmnote:locale";
const DEFAULT_LOCALE = "ko";
const SUPPORTED_LOCALES = new Set(["ko", "en", "zh-cn", "zh-Hant", "ru"]);

let cachedLocale: string | null = null;
const i18nListeners = new Set<(locale: string) => void>();

function initializeCachedLocale() {
  if (cachedLocale || typeof window === "undefined") return;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.has(stored)) {
      cachedLocale = stored;
    }
  } catch (error) {
    console.warn("[I18n] Failed to read cached locale", error);
  }
}

function notifyLocaleChanged(next: string) {
  if (!next || cachedLocale === next) return;
  cachedLocale = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch (error) {
      console.warn("[I18n] Failed to persist locale", error);
    }
  }
  i18nListeners.forEach((listener) => {
    try {
      listener(next);
    } catch (error) {
      console.error("[I18n] Locale listener failed", error);
    }
  });
}

initializeCachedLocale();

function subscribe<T>(
  event: string,
  listener: (payload: T) => void,
): Unsubscribe {
  const registration = listen<T>(event, ({ payload }) => listener(payload));
  return () => {
    registration.then((unlisten) => unlisten()).catch(() => undefined);
  };
}

const api: DMNoteAPI = {
  app: {
    bootstrap: () => invoke<BootstrapPayload>("app_bootstrap"),
    autoUpdate: (tag: string) =>
      invoke<AppAutoUpdateResult>("app_auto_update", { tag }),
    openExternal: (url: string) => invoke("app_open_external", { url }),
    restart: () => invoke("app_restart"),
    quit: () => invoke("app_quit"),
  },
  window: {
    type: (window as any).__dmn_window_type as "main" | "overlay",
    minimize: () => invoke("window_minimize"),
    close: () => invoke("window_close"),
    showMain: () => invoke("window_show_main"),
    openDevtoolsAll: () => invoke("window_open_devtools_all"),
  },
  settings: {
    get: () => invoke<SettingsState>("settings_get"),
    update: (patch: SettingsPatchInput) =>
      invoke<SettingsState>("settings_update", { patch }),
    onChanged: (listener: (diff: SettingsDiff) => void) =>
      subscribe<SettingsDiff>("settings:changed", listener),
  },
  keys: {
    get: () => invoke<KeyMappings>("keys_get"),
    update: (mappings: KeyMappings) =>
      invoke<KeyMappings>("keys_update", { mappings }),
    getPositions: () => invoke<KeyPositions>("positions_get"),
    updatePositions: (positions: KeyPositions) =>
      invoke<KeyPositions>("positions_update", { positions }),
    setMode: (mode: string) =>
      invoke<KeysModeResponse>("keys_set_mode", { mode }),
    resetAll: () => invoke<KeysResetAllResponse>("keys_reset_all"),
    resetMode: (mode: string) =>
      invoke<KeysModeResponse>("keys_reset_mode", { mode }),
    setCounters: (counters: KeyCounters) =>
      invoke<KeyCounters>("keys_set_counters", { counters }),
    resetCounters: () => invoke<KeyCounters>("keys_reset_counters"),
    resetCountersMode: (mode: string) =>
      invoke<KeyCounters>("keys_reset_counters_mode", { mode }),
    resetSingleCounter: (mode: string, key: string) =>
      invoke<KeyCounters>("keys_reset_single_counter", { mode, key }),
    onChanged: (listener: (keys: KeyMappings) => void) =>
      subscribe<KeyMappings>("keys:changed", listener),
    onPositionsChanged: (listener: (positions: KeyPositions) => void) =>
      subscribe<KeyPositions>("positions:changed", listener),
    onModeChanged: (listener: (payload: ModeChangePayload) => void) =>
      subscribe<ModeChangePayload>("keys:mode-changed", listener),
    onKeyState: (listener: (payload: KeyStatePayload) => void) =>
      subscribe<KeyStatePayload>("keys:state", listener),
    onRawInput: (listener: (payload: RawInputPayload) => void): Unsubscribe => {
      // rawKeyEventBus를 통해 구독 - 구독자가 있을 때만 백엔드가 emit
      let unsubscribeFn: (() => void) | null = null;

      rawKeyEventBus
        .subscribe(listener)
        .then((unsub) => {
          unsubscribeFn = unsub;
        })
        .catch((error) => {
          console.error("[API] Failed to subscribe to raw input:", error);
        });

      return () => {
        if (unsubscribeFn) {
          unsubscribeFn();
        }
      };
    },
    onCounterChanged: (listener: (payload: KeyCounterUpdate) => void) =>
      subscribe<KeyCounterUpdate>("keys:counter", listener),
    onCountersChanged: (listener: (payload: KeyCounters) => void) =>
      subscribe<KeyCounters>("keys:counters", listener),
    customTabs: {
      list: () => invoke<CustomTab[]>("custom_tabs_list"),
      create: (name: string) =>
        invoke<CustomTabResult>("custom_tabs_create", { name }),
      delete: (id: string) =>
        invoke<CustomTabDeleteResult>("custom_tabs_delete", { id }),
      select: (id: string) =>
        invoke<CustomTabDeleteResult>("custom_tabs_select", { id }),
      onChanged: (listener: (payload: CustomTabsChangePayload) => void) =>
        subscribe<CustomTabsChangePayload>("customTabs:changed", listener),
    },
  },
  statItems: {
    getPositions: () => invoke<StatItemPositions>("stat_positions_get"),
    updatePositions: (positions: StatItemPositions) =>
      invoke<StatItemPositions>("stat_positions_update", { positions }),
    onPositionsChanged: (listener: (positions: StatItemPositions) => void) =>
      subscribe<StatItemPositions>("statPositions:changed", listener),
  },
  graphItems: {
    getPositions: () => invoke<GraphItemPositions>("graph_positions_get"),
    updatePositions: (positions: GraphItemPositions) =>
      invoke<GraphItemPositions>("graph_positions_update", { positions }),
    onPositionsChanged: (listener: (positions: GraphItemPositions) => void) =>
      subscribe<GraphItemPositions>("graphPositions:changed", listener),
  },
  layerGroups: {
    get: () => invoke<LayerGroups>("layer_groups_get"),
    update: (groups: LayerGroups) =>
      invoke<LayerGroups>("layer_groups_update", { groups }),
    onChanged: (listener: (groups: LayerGroups) => void) =>
      subscribe<LayerGroups>("layerGroups:changed", listener),
  },
  overlay: {
    get: () => invoke<OverlayState>("overlay_get"),
    setVisible: (visible: boolean) =>
      invoke("overlay_set_visible", { visible }),
    setLock: (locked: boolean) => invoke("overlay_set_lock", { locked }),
    setAnchor: (anchor: string) =>
      invoke<string>("overlay_set_anchor", { anchor }),
    resize: (payload: {
      width: number;
      height: number;
      anchor?: string;
      contentTopOffset?: number;
      fixedPositionDeltaX?: number;
      fixedPositionDeltaY?: number;
    }) => invoke<OverlayBounds>("overlay_resize", { payload }),
    onVisibility: (listener: (payload: OverlayVisibilityPayload) => void) =>
      subscribe<OverlayVisibilityPayload>("overlay:visibility", listener),
    onLock: (listener: (payload: OverlayLockPayload) => void) =>
      subscribe<OverlayLockPayload>("overlay:lock", listener),
    onAnchor: (listener: (payload: OverlayAnchorPayload) => void) =>
      subscribe<OverlayAnchorPayload>("overlay:anchor", listener),
    onResized: (listener: (payload: OverlayResizePayload) => void) =>
      subscribe<OverlayResizePayload>("overlay:resized", listener),
  },
  css: {
    get: () => invoke<CustomCss>("css_get"),
    getUse: () => invoke<boolean>("css_get_use"),
    toggle: (enabled: boolean) =>
      invoke<CssTogglePayload>("css_toggle", { enabled }),
    load: () => invoke<CssLoadResult>("css_load"),
    setContent: (content: string) =>
      invoke<CssSetContentResult>("css_set_content", { content }),
    reset: () => invoke("css_reset"),
    onUse: (listener: (payload: CssTogglePayload) => void) =>
      subscribe<CssTogglePayload>("css:use", listener),
    onContent: (listener: (payload: CustomCss) => void) =>
      subscribe<CustomCss>("css:content", listener),
    // 탭별 CSS API
    tab: {
      getAll: () =>
        invoke<import("@src/types/css").TabCssOverrides>("css_tab_get_all"),
      get: (tabId: string) =>
        invoke<import("@src/types/api").TabCssResponse>("css_tab_get", {
          tabId,
        }),
      load: (tabId: string) =>
        invoke<import("@src/types/api").TabCssLoadResult>("css_tab_load", {
          tabId,
        }),
      clear: (tabId: string) =>
        invoke<import("@src/types/api").TabCssClearResult>("css_tab_clear", {
          tabId,
        }),
      toggle: (tabId: string, enabled: boolean) =>
        invoke<import("@src/types/api").TabCssToggleResult>("css_tab_toggle", {
          tabId,
          enabled,
        }),
      set: (tabId: string, css: import("@src/types/css").TabCss | null) =>
        invoke<import("@src/types/api").TabCssSetResult>("css_tab_set", {
          tabId,
          css,
        }),
      onChanged: (
        listener: (payload: import("@src/types/api").TabCssResponse) => void,
      ) =>
        subscribe<import("@src/types/api").TabCssResponse>(
          "tabCss:changed",
          listener,
        ),
    },
  },
  font: {
    load: () => invoke<import("@src/types/api").FontLoadResult>("font_load"),
  },
  image: {
    load: () => invoke<import("@src/types/api").ImageLoadResult>("image_load"),
  },
  sound: {
    load: () => invoke<import("@src/types/api").SoundLoadResult>("sound_load"),
    list: () => invoke<import("@src/types/api").SoundListItem[]>("sound_list"),
    setEnabled: (soundPath: string, enabled: boolean) =>
      invoke<import("@src/types/api").SoundSetEnabledResult>(
        "sound_set_enabled",
        { soundPath, enabled },
      ),
    remove: (soundPath: string) =>
      invoke<import("@src/types/api").SoundDeleteResult>("sound_delete", {
        soundPath,
      }),
    saveProcessedWav: (wavBase64: string, fileName?: string) =>
      invoke<import("@src/types/api").SoundSaveProcessedWavResult>(
        "sound_save_processed_wav",
        {
          request: { wavBase64, fileName },
        },
      ),
    setLatencyLogging: (enabled: boolean) =>
      invoke("key_sound_set_latency_logging", { enabled }).then(() => undefined),
  },
  js: {
    get: () => invoke<CustomJs>("js_get"),
    getUse: () => invoke<boolean>("js_get_use"),
    toggle: (enabled: boolean) =>
      invoke<JsTogglePayload>("js_toggle", { enabled }),
    load: () => invoke<JsLoadResult>("js_load"),
    reload: () => invoke<JsReloadResult>("js_reload"),
    remove: (id: string) => invoke<JsRemoveResult>("js_remove_plugin", { id }),
    setPluginEnabled: (id: string, enabled: boolean) =>
      invoke<JsPluginUpdateResult>("js_set_plugin_enabled", { id, enabled }),
    setContent: (content: string) =>
      invoke<JsSetContentResult>("js_set_content", { content }),
    reset: () => invoke("js_reset"),
    onUse: (listener: (payload: JsTogglePayload) => void) =>
      subscribe<JsTogglePayload>("js:use", listener),
    onState: (listener: (payload: CustomJs) => void) =>
      subscribe<CustomJs>("js:content", listener),
  },
  presets: {
    save: () => invoke<PresetOperationResult>("preset_save"),
    load: () => invoke<PresetOperationResult>("preset_load"),
  },
  bridge: (() => {
    const listeners = new Map<string, Set<BridgeMessageListener>>();
    const anyListeners = new Set<BridgeAnyListener>();
    const onceListeners = new Map<string, Set<BridgeMessageListener>>();

    // 백엔드에서 브로드캐스트한 메시지 수신
    listen<BridgeMessage>("plugin-bridge:message", ({ payload }) => {
      const { type, data } = payload;

      // 타입별 리스너 호출
      const typeListeners = listeners.get(type);
      if (typeListeners) {
        typeListeners.forEach((listener) => {
          try {
            listener(data);
          } catch (error) {
            console.error(`[Bridge] Error in listener for '${type}':`, error);
          }
        });
      }

      // once 리스너 호출 및 제거
      const onceTypeListeners = onceListeners.get(type);
      if (onceTypeListeners) {
        onceTypeListeners.forEach((listener) => {
          try {
            listener(data);
          } catch (error) {
            console.error(
              `[Bridge] Error in once listener for '${type}':`,
              error,
            );
          }
        });
        onceListeners.delete(type);
      }

      // any 리스너 호출
      anyListeners.forEach((listener) => {
        try {
          listener(type, data);
        } catch (error) {
          console.error("[Bridge] Error in any listener:", error);
        }
      });
    }).catch((error) => {
      console.error("[Bridge] Failed to setup message listener:", error);
    });

    return {
      send: (type: string, data?: any) =>
        invoke("plugin_bridge_send", {
          messageType: type,
          data: data ?? null,
        }),

      sendTo: (target: WindowTarget, type: string, data?: any) =>
        invoke("plugin_bridge_send_to", {
          target,
          messageType: type,
          data: data ?? null,
        }),

      on: <T = any>(type: string, listener: BridgeMessageListener<T>) => {
        if (!listeners.has(type)) {
          listeners.set(type, new Set());
        }
        listeners.get(type)!.add(listener as BridgeMessageListener);

        return () => {
          const typeListeners = listeners.get(type);
          if (typeListeners) {
            typeListeners.delete(listener as BridgeMessageListener);
            if (typeListeners.size === 0) {
              listeners.delete(type);
            }
          }
        };
      },

      once: <T = any>(type: string, listener: BridgeMessageListener<T>) => {
        if (!onceListeners.has(type)) {
          onceListeners.set(type, new Set());
        }
        onceListeners.get(type)!.add(listener as BridgeMessageListener);

        return () => {
          const typeListeners = onceListeners.get(type);
          if (typeListeners) {
            typeListeners.delete(listener as BridgeMessageListener);
            if (typeListeners.size === 0) {
              onceListeners.delete(type);
            }
          }
        };
      },

      onAny: (listener: BridgeAnyListener) => {
        anyListeners.add(listener);
        return () => {
          anyListeners.delete(listener);
        };
      },

      off: (type: string, listener?: BridgeMessageListener) => {
        if (listener) {
          const typeListeners = listeners.get(type);
          if (typeListeners) {
            typeListeners.delete(listener);
            if (typeListeners.size === 0) {
              listeners.delete(type);
            }
          }
        } else {
          listeners.delete(type);
        }
      },
    };
  })(),
  i18n: {
    getLocale: async () => {
      if (cachedLocale) {
        return cachedLocale;
      }
      try {
        const settings = await invoke<SettingsState>("settings_get");
        const next = settings.language || DEFAULT_LOCALE;
        notifyLocaleChanged(next);
        return next;
      } catch (error) {
        console.warn("[I18n] Failed to fetch locale", error);
        return cachedLocale || DEFAULT_LOCALE;
      }
    },
    onLocaleChange: (listener) => {
      i18nListeners.add(listener);
      return () => {
        i18nListeners.delete(listener);
      };
    },
  },
  stats: {
    subscribe: (listener: (stats: KeyStatsPayload) => void): Unsubscribe => {
      // 동기적으로 unsubscribe 함수 반환
      return keyStatsService.subscribe(listener);
    },
    get: (): KeyStatsPayload => {
      return keyStatsService.getStats();
    },
    reset: (): void => {
      keyStatsService.reset();
    },
  },
  plugin: {
    storage: {
      get: <T = any>(key: string) =>
        invoke<T | null>("plugin_storage_get", { key }),

      set: (key: string, value: any) =>
        invoke<void>("plugin_storage_set", { key, value }),

      remove: (key: string) => invoke<void>("plugin_storage_remove", { key }),

      clear: () => invoke<void>("plugin_storage_clear"),

      keys: () => invoke<string[]>("plugin_storage_keys"),

      hasData: (prefix: string) =>
        invoke<boolean>("plugin_storage_has_data", { prefix }),

      clearByPrefix: (prefix: string) =>
        invoke<number>("plugin_storage_clear_by_prefix", { prefix }),
    },
    registerCleanup: () => {
      console.warn(
        "[Plugin API] registerCleanup is managed by useCustomJsInjection and should not be called directly from dmnoteApi",
      );
    },
    defineElement: () => {
      console.warn(
        "[Plugin API] defineElement is managed by useCustomJsInjection and should not be called directly from dmnoteApi",
      );
    },
    defineSettings: () => {
      console.warn(
        "[Plugin API] defineSettings is managed by useCustomJsInjection and should not be called directly from dmnoteApi",
      );
      // 빈 인스턴스 반환 (타입 호환성)
      return {
        get: () => ({}),
        set: async () => {},
        open: async () => false,
        reset: async () => {},
        subscribe: () => () => {},
      };
    },
  },
  ui: {
    contextMenu: {
      addKeyMenuItem: (item) => {
        // 메인 윈도우에서만 동작
        if ((window as any).__dmn_window_type !== "main") {
          console.warn("[UI API] contextMenu is only available in main window");
          return "";
        }

        return usePluginMenuStore.getState().addKeyMenuItem(item);
      },

      addGridMenuItem: (item) => {
        if ((window as any).__dmn_window_type !== "main") {
          console.warn("[UI API] contextMenu is only available in main window");
          return "";
        }

        return usePluginMenuStore.getState().addGridMenuItem(item);
      },

      removeMenuItem: (fullId) => {
        if ((window as any).__dmn_window_type !== "main") {
          console.warn("[UI API] contextMenu is only available in main window");
          return;
        }

        usePluginMenuStore.getState().removeMenuItem(fullId);
      },

      updateMenuItem: (fullId, updates) => {
        if ((window as any).__dmn_window_type !== "main") {
          console.warn("[UI API] contextMenu is only available in main window");
          return;
        }

        usePluginMenuStore.getState().updateMenuItem(fullId, updates);
      },

      clearMyMenuItems: () => {
        if ((window as any).__dmn_window_type !== "main") {
          console.warn("[UI API] contextMenu is only available in main window");
          return;
        }

        const pluginId = (window as any).__dmn_current_plugin_id;
        if (!pluginId) {
          console.warn(
            "[UI API] clearMyMenuItems called outside plugin context",
          );
          return;
        }

        usePluginMenuStore.getState().clearByPluginId(pluginId);
      },
    },
    displayElement: displayElementApi,

    // Dialog API
    dialog: {
      alert: (message: string, options?: { confirmText?: string }) => {
        return new Promise<void>((resolve) => {
          const showAlert = (window as any).__dmn_showAlert;
          if (typeof showAlert !== "function") {
            console.warn("[Dialog API] showAlert function not available");
            resolve();
            return;
          }
          showAlert(message, options?.confirmText);
          // Alert는 확인만 있으므로 바로 resolve
          setTimeout(resolve, 0);
        });
      },

      confirm: (
        message: string,
        options?: {
          confirmText?: string;
          cancelText?: string;
          danger?: boolean;
        },
      ) => {
        return new Promise<boolean>((resolve) => {
          const showConfirm = (window as any).__dmn_showConfirm;
          if (typeof showConfirm !== "function") {
            console.warn("[Dialog API] showConfirm function not available");
            resolve(false);
            return;
          }
          showConfirm(
            message,
            () => resolve(true),
            () => resolve(false),
            options?.confirmText,
          );
        });
      },

      custom: (
        html: string,
        options?: {
          confirmText?: string;
          cancelText?: string;
          showCancel?: boolean;
        },
      ) => {
        return new Promise<boolean>((resolve) => {
          const showCustomDialog = (window as any).__dmn_showCustomDialog;
          if (typeof showCustomDialog !== "function") {
            console.warn(
              "[Dialog API] showCustomDialog function not available",
            );
            resolve(false);
            return;
          }

          // 플러그인 ID 캡처
          const pluginId = (window as any).__dmn_current_plugin_id;

          // HTML 내 data-plugin-handler 이벤트 바인딩을 위한 래퍼
          const wrappedHtml = `<div data-plugin-dialog-content data-plugin-id="${
            pluginId || ""
          }">${html}</div>`;

          showCustomDialog(wrappedHtml, {
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
            confirmText: options?.confirmText,
            cancelText: options?.cancelText,
            showCancel: options?.showCancel,
          });

          // 다음 틱에 이벤트 리스너 등록
          setTimeout(() => {
            const dialogContent = document.querySelector(
              "[data-plugin-dialog-content]",
            );
            if (!dialogContent) return;

            // 체크박스 토글 기능
            dialogContent.addEventListener("click", (e: Event) => {
              const target = e.target as HTMLElement;
              const checkbox = target.closest("[data-checkbox-toggle]");
              if (checkbox) {
                const input = checkbox.querySelector(
                  "input[type=checkbox]",
                ) as HTMLInputElement;
                const knob = checkbox.querySelector("div") as HTMLElement;

                if (input) {
                  input.checked = !input.checked;

                  // 스타일 토글
                  if (input.checked) {
                    checkbox.classList.remove("bg-[#3B4049]");
                    checkbox.classList.add("bg-[#493C1D]");
                    knob.classList.remove("left-[2px]", "bg-[#989BA6]");
                    knob.classList.add("left-[13px]", "bg-[#FFB400]");
                  } else {
                    checkbox.classList.remove("bg-[#493C1D]");
                    checkbox.classList.add("bg-[#3B4049]");
                    knob.classList.remove("left-[13px]", "bg-[#FFB400]");
                    knob.classList.add("left-[2px]", "bg-[#989BA6]");
                  }

                  // change 이벤트 발생
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                }
              }
            });

            setupPluginDropdownInteractions(dialogContent as HTMLElement);

            // Input blur 핸들러: min/max 자동 정규화
            const handleInputBlur = (e: Event) => {
              const targetEl = e.target as HTMLInputElement;
              if (
                targetEl.tagName === "INPUT" &&
                targetEl.type === "number" &&
                targetEl.hasAttribute("data-plugin-input-blur")
              ) {
                const minStr = targetEl.getAttribute("data-plugin-input-min");
                const maxStr = targetEl.getAttribute("data-plugin-input-max");
                const currentValue = targetEl.value;

                // 빈 값이거나 숫자가 아닌 경우
                if (currentValue === "" || isNaN(parseFloat(currentValue))) {
                  // min이 있으면 min으로, 없으면 0으로
                  const defaultValue = minStr ? parseFloat(minStr) : 0;
                  targetEl.value = String(defaultValue);
                  // change 이벤트 발생
                  targetEl.dispatchEvent(
                    new Event("change", { bubbles: true }),
                  );
                  return;
                }

                const numValue = parseFloat(currentValue);
                let clampedValue = numValue;

                // min/max 범위로 제한
                if (minStr && numValue < parseFloat(minStr)) {
                  clampedValue = parseFloat(minStr);
                }
                if (maxStr && numValue > parseFloat(maxStr)) {
                  clampedValue = parseFloat(maxStr);
                }

                // 값이 변경되었으면 업데이트
                if (clampedValue !== numValue) {
                  targetEl.value = String(clampedValue);
                  // change 이벤트 발생
                  targetEl.dispatchEvent(
                    new Event("change", { bubbles: true }),
                  );
                }
              }
            };

            // data-plugin-handler 이벤트 위임
            const handleEvent = (e: Event) => {
              const target = e.target as HTMLElement;
              const handlerAttr =
                e.type === "click"
                  ? "data-plugin-handler"
                  : e.type === "input"
                  ? "data-plugin-handler-input"
                  : e.type === "change"
                  ? "data-plugin-handler-change"
                  : null;

              if (!handlerAttr) return;

              // 클릭된 요소 또는 부모에서 핸들러 찾기
              let element: HTMLElement | null = target;
              let handlerName: string | null = null;

              while (element && element !== dialogContent) {
                handlerName = element.getAttribute(handlerAttr);
                if (handlerName) break;
                element = element.parentElement;
              }

              if (!handlerName) return;

              // 핸들러 실행 (자동 래핑되어 있음)
              const handler = (window as any)[handlerName];
              if (typeof handler === "function") {
                handler(e);
              }
            };

            dialogContent.addEventListener("click", handleEvent);
            dialogContent.addEventListener("change", handleEvent);
            dialogContent.addEventListener("input", handleEvent);
            dialogContent.addEventListener("blur", handleInputBlur, true); // capture phase
          }, 0);
        });
      },
    },

    // Components API
    components: {
      button: (text: string, options?: ButtonOptions) =>
        createButton(text, options),
      checkbox: (options?: CheckboxOptions) => createCheckbox(options),
      input: (options?: InputOptions) => createInput(options),
      dropdown: (options: DropdownOptions) => createDropdown(options),
      panel: (content: string, options?: PanelOptions) =>
        createPanel(content, options),
      formRow: (label: string, component: string) =>
        createFormRow(label, component),
    },

    // Color Picker API
    pickColor: (options: {
      initialColor: string;
      onColorChange: (color: string) => void;
      position?: { x: number; y: number };
      id?: string;
      referenceElement?: HTMLElement;
      onClose?: () => void;
      onColorChangeComplete?: (color: string) => void;
    }) => {
      const showColorPicker = (window as any).__dmn_showColorPicker;
      if (typeof showColorPicker === "function") {
        showColorPicker(options);
      } else {
        console.warn("[UI API] pickColor function not available");
      }
    },
  },
};

if (typeof window !== "undefined") {
  window.api = api;
  // dmn 별칭 추가 (window. 없이 바로 접근 가능)
  (window as any).dmn = api;
  (globalThis as any).dmn = api;
}

export {
  handlerRegistry,
  displayElementInstanceRegistry,
} from "./pluginDisplayElements";

export default api;

subscribe<SettingsDiff>("settings:changed", (diff) => {
  const next = diff.changed.language;
  if (typeof next === "string") {
    notifyLocaleChanged(next);
  }
});
