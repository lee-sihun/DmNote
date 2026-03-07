import { useEffect } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useFontStore, syncFontCSS } from '@stores/useFontStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import {
  useSettingsStore,
  type SettingsStateSnapshot,
} from '@stores/useSettingsStore';
import {
  applyCounterSnapshot,
  setKeyCounter,
} from '@stores/signals/keyCounterSignals';
import { getUndoRedoInProgress } from '@api/pluginDisplayElements';
import type {
  SettingsDiff,
  OverlayResizeAnchor,
} from '@src/types/settings/settings';
import {
  initDefaults,
  getDefaultGridSettings,
  getDefaultShortcuts,
} from '@src/renderer/defaults';
import {
  initializeCursorSystem,
  refreshCursorSettings,
} from '@utils/grid/cursorUtils';
import type { CustomJs, JsPlugin } from '@src/types/plugin/js';
import { DEFAULT_OBS_PORT } from '@src/types/obs';

function clonePlugins(source?: CustomJs | null): JsPlugin[] {
  if (!source) return [];
  const fromPlugins = Array.isArray(source.plugins) ? source.plugins : [];
  if (fromPlugins.length > 0) {
    return fromPlugins.map((plugin) => ({ ...plugin }));
  }

  const legacyPath = source.path ?? null;
  const legacyContent = source.content ?? '';
  if (!legacyPath && !legacyContent) {
    return [];
  }

  const fallbackName = legacyPath?.split(/\\|\//).pop() || 'legacy.js';
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
    // 키 표시 딜레이와 동기화를 위한 카운터 업데이트 지연
    const counterDelayTimers = new Map<
      string,
      Set<ReturnType<typeof setTimeout>>
    >();

    const composeCounterKey = (mode?: string, key?: string) =>
      `${mode || '__unknown_mode__'}::${key || '__unknown_key__'}`;

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
      count: number,
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
        state.isBootstrapped ? state : { ...state, isBootstrapped: true },
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
        noteSettings: _noteSettings,
        fontSettings: _fontSettings,
        customCSS: _customCSS,
        customJS: _customJS,
        ...rest
      } = diff.changed;
      const sanitized = Object.fromEntries(
        Object.entries(rest).filter(
          ([, value]) => value !== undefined && value !== null,
        ),
      ) as Partial<SettingsStateSnapshot>;
      if (Object.keys(sanitized).length > 0) {
        merge(sanitized);
      }
    };

    (async () => {
      const bootstrap = await window.api.app.bootstrap();
      if (disposed) return;
      initDefaults(bootstrap.defaults);
      setAll({
        hardwareAcceleration: bootstrap.settings.hardwareAcceleration,
        alwaysOnTop: bootstrap.settings.alwaysOnTop,
        overlayLocked: bootstrap.settings.overlayLocked,
        angleMode: bootstrap.settings.angleMode,
        noteEffect: bootstrap.settings.noteEffect,
        noteSettings: bootstrap.settings.noteSettings,
        tabNoteOverrides: {},
        fontSettings: bootstrap.settings.fontSettings,
        useCustomCSS: bootstrap.settings.useCustomCSS,
        customCSSContent: bootstrap.settings.customCSS.content,
        customCSSPath: bootstrap.settings.customCSS.path,
        useCustomJS: bootstrap.settings.useCustomJS,
        jsPlugins: clonePlugins(bootstrap.settings.customJS),
        backgroundColor: bootstrap.settings.backgroundColor,
        language: bootstrap.settings.language,
        laboratoryEnabled: bootstrap.settings.laboratoryEnabled,
        developerModeEnabled: bootstrap.settings.developerModeEnabled ?? false,
        trayEnabled: bootstrap.settings.trayEnabled ?? false,
        autoUpdateEnabled: bootstrap.settings.autoUpdateEnabled ?? true,
        overlayResizeAnchor: bootstrap.settings.overlayResizeAnchor,
        keyCounterEnabled: bootstrap.settings.keyCounterEnabled,
        gridSettings:
          bootstrap.settings.gridSettings ?? getDefaultGridSettings(),
        shortcuts: bootstrap.settings.shortcuts ?? getDefaultShortcuts(),
        obsModeEnabled: bootstrap.settings.obsModeEnabled ?? false,
        obsPort: bootstrap.settings.obsPort ?? DEFAULT_OBS_PORT,
      });
      useFontStore.setState({
        customFonts: bootstrap.settings.fontSettings.customFonts.map(
          (font) => ({ ...font }),
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
      useGraphItemStore.setState((state) => ({
        ...state,
        positions: bootstrap.graphPositions ?? {},
      }));
      applyCounterSnapshot(bootstrap.keyCounters);

      // 레이어 그룹 로드
      window.api.layerGroups
        .get()
        .then((groups) => {
          useLayerGroupStore.getState().setLayerGroups(groups);
        })
        .catch(() => {});

      // 탭별 노트 트랙 설정 오버라이드 로드
      window.api.noteTab
        .getAll()
        .then((tabNoteOverrides) => {
          if (!disposed) {
            useSettingsStore.setState({ tabNoteOverrides });
          }
        })
        .catch(() => {});

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
        const isOverlayWindow = window.__dmn_window_type === 'overlay';
        if (!isOverlayWindow && useKeyStore.getState().isLocalUpdateInProgress)
          return;
        useKeyStore.setState((state) => ({ ...state, keyMappings: keys }));
      }),
      window.api.keys.onPositionsChanged((positions) => {
        const isOverlayWindow = window.__dmn_window_type === 'overlay';
        if (!isOverlayWindow && useKeyStore.getState().isLocalUpdateInProgress)
          return;
        useKeyStore.setState((state) => ({ ...state, positions }));
      }),
      window.api.statItems.onPositionsChanged((positions) => {
        const isOverlayWindow = window.__dmn_window_type === 'overlay';
        if (
          !isOverlayWindow &&
          useStatItemStore.getState().isLocalUpdateInProgress
        )
          return;
        useStatItemStore.setState((state) => ({ ...state, positions }));
      }),
      window.api.graphItems.onPositionsChanged((positions) => {
        const isOverlayWindow = window.__dmn_window_type === 'overlay';
        if (
          !isOverlayWindow &&
          useGraphItemStore.getState().isLocalUpdateInProgress
        )
          return;
        useGraphItemStore.setState((state) => ({ ...state, positions }));
      }),
      window.api.layerGroups.onChanged((groups) => {
        useLayerGroupStore.getState().setLayerGroups(groups);
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
        },
      ),
      window.api.noteTab.onChanged(({ tabId, settings }) => {
        if (disposed) return;
        useSettingsStore.setState((state) => ({
          tabNoteOverrides: {
            ...state.tabNoteOverrides,
            ...(settings
              ? { [tabId]: settings }
              : Object.fromEntries(
                  Object.entries(state.tabNoteOverrides).filter(
                    ([key]) => key !== tabId,
                  ),
                )),
          },
        }));
      }),
      window.api.noteTab.onChangedAll((tabNoteOverrides) => {
        if (disposed) return;
        useSettingsStore.setState({ tabNoteOverrides });
      }),
      window.api.presets.onSnapshot((snapshot) => {
        if (disposed) return;
        useKeyStore.setState((state) => ({
          ...state,
          keyMappings: snapshot.keys,
          positions: snapshot.positions,
          customTabs: snapshot.customTabs,
          selectedKeyType: snapshot.selectedKeyType,
        }));
        useStatItemStore.setState((state) => ({
          ...state,
          positions: snapshot.statPositions,
        }));
        useGraphItemStore.setState((state) => ({
          ...state,
          positions: snapshot.graphPositions,
        }));
        useSettingsStore.setState({
          tabNoteOverrides: snapshot.tabNoteOverrides,
        });
      }),
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
    window.addEventListener('focus', handleWindowFocus);
    unsubscribers.push(() =>
      window.removeEventListener('focus', handleWindowFocus),
    );

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          console.error('구독 해제 실패', error);
        }
      });
      clearCounterDelayTimers();
    };
  }, []);
}
