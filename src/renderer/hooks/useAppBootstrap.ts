import { useEffect } from "react";
import { useKeyStore } from "@stores/useKeyStore";
import { useStatItemStore } from "@stores/useStatItemStore";
import { useFontStore, syncFontCSS } from "@stores/useFontStore";
import {
  useSettingsStore,
  type SettingsStateSnapshot,
} from "@stores/useSettingsStore";
import { applyCounterSnapshot, setKeyCounter } from "@stores/keyCounterSignals";
import { getUndoRedoInProgress } from "@api/pluginDisplayElements";
import { DEFAULT_GRID_SETTINGS, type SettingsDiff } from "@src/types/settings";
import type { OverlayResizeAnchor } from "@src/types/settings";
import { DEFAULT_SHORTCUTS } from "@src/types/shortcuts";
import { initializeCursorSystem, refreshCursorSettings } from "@utils/cursorUtils";
import type { CustomJs, JsPlugin } from "@src/types/js";

function clonePlugins(source?: CustomJs | null): JsPlugin[] {
  if (!source) return [];
  const fromPlugins = Array.isArray(source.plugins) ? source.plugins : [];
  if (fromPlugins.length > 0) {
    return fromPlugins.map((plugin) => ({ ...plugin }));
  }

  const legacyPath = source.path ?? null;
  const legacyContent = source.content ?? "";
  if (!legacyPath && !legacyContent) {
    return [];
  }

  const fallbackName = legacyPath?.split(/\\|\//).pop() || "legacy.js";
  return [
    {
      id: `legacy-${Date.now().toString(36)}`,
      name: fallbackName,
      path: legacyPath,
      content: legacyContent,
      enabled: true,
    },
  ];
}

// 앱 초기 구동 시 메인 스냅샷을 가져오고,
// 이후 변경 이벤트를 구독해 Zustand 스토어를 최신 상태로 유지
export function useAppBootstrap() {
  useEffect(() => {
    let disposed = false;
    // Delay counter updates to keep them in sync with the key display delay
    const counterDelayTimers = new Map<
      string,
      Set<ReturnType<typeof setTimeout>>
    >();

    const composeCounterKey = (mode?: string, key?: string) =>
      `${mode || "__unknown_mode__"}::${key || "__unknown_key__"}`;

    const clearCounterDelayTimers = (composedKey?: string) => {
      if (composedKey) {
        const timers = counterDelayTimers.get(composedKey);
        if (timers) {
          timers.forEach((timer) => clearTimeout(timer));
          counterDelayTimers.delete(composedKey);
        }
        return;
      }

      counterDelayTimers.forEach((timers) => {
        timers.forEach((timer) => clearTimeout(timer));
      });
      counterDelayTimers.clear();
    };

    const getCounterDelayMs = () => {
      const { noteSettings } = useSettingsStore.getState();
      const delay = Number(noteSettings?.keyDisplayDelayMs ?? 0);
      return delay > 0 ? delay : 0;
    };

    const scheduleCounterUpdate = (
      mode: string,
      key: string,
      count: number
    ) => {
      const delayMs = getCounterDelayMs();
      const composedKey = composeCounterKey(mode, key);

      if (delayMs <= 0) {
        clearCounterDelayTimers(composedKey);
        setKeyCounter(mode, key, count);
        return;
      }

      const timer = setTimeout(() => {
        if (disposed) return;
        setKeyCounter(mode, key, count);
        const timers = counterDelayTimers.get(composedKey);
        if (timers) {
          timers.delete(timer);
          if (timers.size === 0) {
            counterDelayTimers.delete(composedKey);
          }
        }
      }, delayMs);

      const existing = counterDelayTimers.get(composedKey);
      if (existing) {
        existing.add(timer);
      } else {
        counterDelayTimers.set(composedKey, new Set([timer]));
      }
    };

    const { setAll, merge } = useSettingsStore.getState();

    const finalizeBootstrap = () =>
      useKeyStore.setState((state) =>
        state.isBootstrapped ? state : { ...state, isBootstrapped: true }
      );

    const applyDiff = (diff: SettingsDiff) => {
      if (diff.changed.noteSettings) {
        useSettingsStore.setState((state) => ({
          noteSettings: {
            ...state.noteSettings,
            ...diff.changed.noteSettings!,
          },
        }));
      }
      if (diff.changed.fontSettings) {
        useSettingsStore.setState({
          fontSettings: diff.changed.fontSettings,
        });
        useFontStore.setState({
          customFonts: diff.changed.fontSettings.customFonts.map((font) => ({
            ...font,
          })),
        });
        syncFontCSS();
      }
      if (diff.changed.customCSS) {
        useSettingsStore.setState({
          customCSSContent: diff.changed.customCSS.content,
          customCSSPath: diff.changed.customCSS.path ?? null,
        });
      }
      if (diff.changed.customJS) {
        useSettingsStore.setState({
          jsPlugins: clonePlugins(diff.changed.customJS),
        });
      }
      const {
        noteSettings,
        fontSettings: _fontSettings,
        customCSS,
        customJS,
        ...rest
      } = diff.changed;
      const sanitized = Object.fromEntries(
        Object.entries(rest).filter(
          ([, value]) => value !== undefined && value !== null
        )
      ) as Partial<SettingsStateSnapshot>;
      if (Object.keys(sanitized).length > 0) {
        merge(sanitized);
      }
    };

    (async () => {
      const bootstrap = await window.api.app.bootstrap();
      if (disposed) return;
      setAll({
        hardwareAcceleration: bootstrap.settings.hardwareAcceleration,
        alwaysOnTop: bootstrap.settings.alwaysOnTop,
        overlayLocked: bootstrap.settings.overlayLocked,
        angleMode: bootstrap.settings.angleMode,
        noteEffect: bootstrap.settings.noteEffect,
        noteSettings: bootstrap.settings.noteSettings,
        fontSettings: bootstrap.settings.fontSettings,
        useCustomCSS: bootstrap.settings.useCustomCSS,
        customCSSContent: bootstrap.settings.customCSS.content,
        customCSSPath: bootstrap.settings.customCSS.path,
        useCustomJS: bootstrap.settings.useCustomJS,
        jsPlugins: clonePlugins(bootstrap.settings.customJS),
        backgroundColor: bootstrap.settings.backgroundColor,
        language: bootstrap.settings.language,
        laboratoryEnabled: bootstrap.settings.laboratoryEnabled,
        developerModeEnabled:
          (bootstrap.settings as any).developerModeEnabled ?? false,
        trayEnabled: (bootstrap.settings as any).trayEnabled ?? false,
        overlayResizeAnchor: bootstrap.settings.overlayResizeAnchor,
        keyCounterEnabled: bootstrap.settings.keyCounterEnabled,
        gridSettings: bootstrap.settings.gridSettings ?? DEFAULT_GRID_SETTINGS,
        shortcuts: bootstrap.settings.shortcuts ?? DEFAULT_SHORTCUTS,
      });
      useFontStore.setState({
        customFonts: bootstrap.settings.fontSettings.customFonts.map(
          (font) => ({ ...font })
        ),
      });
      syncFontCSS();
      useKeyStore.setState((state) => ({
        ...state,
        keyMappings: bootstrap.keys,
        positions: bootstrap.positions,
        customTabs: bootstrap.customTabs,
        selectedKeyType: bootstrap.selectedKeyType,
      }));
      useStatItemStore.setState((state) => ({
        ...state,
        positions: bootstrap.statPositions ?? {},
      }));
      applyCounterSnapshot(bootstrap.keyCounters);

      // macOS 커서 시스템 초기화 (시스템 설정 반영)
      initializeCursorSystem().catch(() => {});

      finalizeBootstrap();
    })();

    const unsubscribers = [
      window.api.settings.onChanged((diff: SettingsDiff) => {
        if (disposed || !diff) return;
        applyDiff(diff);
      }),
      window.api.keys.onChanged((keys) => {
        const isOverlayWindow = (window as any).__dmn_window_type === "overlay";
        if (!isOverlayWindow && useKeyStore.getState().isLocalUpdateInProgress)
          return;
        useKeyStore.setState((state) => ({ ...state, keyMappings: keys }));
      }),
      window.api.keys.onPositionsChanged((positions) => {
        const isOverlayWindow = (window as any).__dmn_window_type === "overlay";
        if (!isOverlayWindow && useKeyStore.getState().isLocalUpdateInProgress)
          return;
        useKeyStore.setState((state) => ({ ...state, positions }));
      }),
      window.api.statItems.onPositionsChanged((positions) => {
        const isOverlayWindow = (window as any).__dmn_window_type === "overlay";
        if (
          !isOverlayWindow &&
          useStatItemStore.getState().isLocalUpdateInProgress
        )
          return;
        useStatItemStore.setState((state) => ({ ...state, positions }));
      }),
      window.api.keys.onModeChanged(({ mode }) => {
        useKeyStore.setState((state) => ({ ...state, selectedKeyType: mode }));
      }),
      window.api.keys.onCounterChanged(({ mode, key, count }) => {
        scheduleCounterUpdate(mode, key, count);
      }),
      window.api.keys.onCountersChanged((snapshot) => {
        clearCounterDelayTimers();
        if (getUndoRedoInProgress()) return;
        applyCounterSnapshot(snapshot);
      }),
      window.api.keys.customTabs.onChanged(
        ({ customTabs, selectedKeyType }) => {
          useKeyStore.setState((state) => ({
            ...state,
            customTabs,
            selectedKeyType,
          }));
        }
      ),
      window.api.overlay.onLock(({ locked }) => {
        useSettingsStore.setState({ overlayLocked: locked });
      }),
      window.api.overlay.onAnchor(({ anchor }) => {
        useSettingsStore.setState({
          overlayResizeAnchor: anchor as OverlayResizeAnchor,
        });
      }),
      window.api.css.onUse(({ enabled }) => {
        useSettingsStore.setState({ useCustomCSS: enabled });
      }),
      window.api.css.onContent((css) => {
        useSettingsStore.setState({
          customCSSContent: css.content,
          customCSSPath: css.path,
        });
      }),
      window.api.js.onUse(({ enabled }) => {
        useSettingsStore.setState({ useCustomJS: enabled });
      }),
      window.api.js.onState((script) => {
        useSettingsStore.setState({
          jsPlugins: clonePlugins(script),
        });
      }),
      useSettingsStore.subscribe((state, previousState) => {
        const nextDelay = Number(state.noteSettings?.keyDisplayDelayMs ?? 0);
        const prevDelay = previousState
          ? Number(previousState.noteSettings?.keyDisplayDelayMs ?? 0)
          : 0;
        if (nextDelay <= 0 && prevDelay > 0) {
          clearCounterDelayTimers();
        }
      }),
    ];

    const handleWindowFocus = () => {
      refreshCursorSettings().catch(() => {});
    };
    window.addEventListener("focus", handleWindowFocus);
    unsubscribers.push(() => window.removeEventListener("focus", handleWindowFocus));

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          console.error("Failed to unsubscribe", error);
        }
      });
      clearCounterDelayTimers();
    };
  }, []);
}
