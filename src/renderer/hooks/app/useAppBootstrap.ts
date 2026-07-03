import { useEffect } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
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
import {
  applyCounterCacheSnapshot,
  setCachedKeyCounter,
} from '@stores/signals/keyCounterCache';
import { getUndoRedoInProgress } from '@api/pluginDisplayElements';
import { obsApi } from '@api/modules/obsApi';
import { notifyLocaleChanged } from '@api/modules/shared';
import { stableStringify } from '@utils/core/stableStringify';
import type { BootstrapPayload } from '@src/types/app';
import type { KeyMappings, KeyPositions, CustomTab } from '@src/types/key/keys';
import type { TabNoteOverrides } from '@src/types/settings/noteSettings';
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

// bootstrap payload → 설정 스토어 스냅샷 구성 (초기 적용/재동기화 공용)
function buildSettingsSnapshot(
  bootstrap: BootstrapPayload,
  tabNoteOverrides: TabNoteOverrides,
): SettingsStateSnapshot {
  return {
    hardwareAcceleration: bootstrap.settings.hardwareAcceleration,
    alwaysOnTop: bootstrap.settings.alwaysOnTop,
    overlayLocked: bootstrap.settings.overlayLocked,
    angleMode: bootstrap.settings.angleMode,
    noteEffect: bootstrap.settings.noteEffect,
    noteSettings: bootstrap.settings.noteSettings,
    tabNoteOverrides,
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
    gridSettings: bootstrap.settings.gridSettings ?? getDefaultGridSettings(),
    shortcuts: bootstrap.settings.shortcuts ?? getDefaultShortcuts(),
    obsModeEnabled: bootstrap.settings.obsModeEnabled ?? false,
  };
}

// 앱 초기 구동 시 메인 스냅샷을 가져오고,
// 이후 변경 이벤트를 구독해 Zustand 스토어를 최신 상태로 유지
export function useAppBootstrap() {
  useEffect(() => {
    let disposed = false;
    const isOverlayWindow = window.__dmn_window_type === 'overlay';
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

    // ── OBS WS 재연결/lag 복구 시 전체 상태 재동기화 ──
    // obs:resync는 ipcShim 로컬 합성 이벤트 — 네이티브 윈도우에서는 발화하지 않음
    let initialApplied = false;
    let resyncInFlight = false;
    let resyncQueued = false;

    // 모든 슬라이스를 "변경 시에만" 적용 — 동일 데이터 재적용으로 인한 참조
    // 변경이 overlay 키 이벤트 effect 재실행(키 하이라이트 리셋) 등 시각적
    // 부작용을 유발하는 것을 방지
    const applyResyncSnapshot = (bootstrap: BootstrapPayload) => {
      initDefaults(bootstrap.defaults);

      // 설정: tabNoteOverrides는 payload 내장값으로 원자 적용
      // (초기 경로의 "{} → getAll" 2단계를 반복하면 한 프레임 깜빡임 발생)
      const prevLanguage = useSettingsStore.getState().language;
      useSettingsStore
        .getState()
        .syncFromSnapshot(
          buildSettingsSnapshot(bootstrap, bootstrap.tabNoteOverrides ?? {}),
        );
      const nextLanguage = bootstrap.settings.language;
      if (nextLanguage && nextLanguage !== prevLanguage) {
        notifyLocaleChanged(nextLanguage);
      }

      // 폰트: 변경 시에만 setState + CSS 재주입
      const nextFonts = bootstrap.settings.fontSettings.customFonts;
      if (
        stableStringify(useFontStore.getState().customFonts) !==
        stableStringify(nextFonts)
      ) {
        useFontStore.setState({
          customFonts: nextFonts.map((font) => ({ ...font })),
        });
        syncFontCSS();
      }

      // 키 스토어: 변경 슬라이스만 모아 단일 setState
      // setSelectedKeyType 액션은 백엔드 setMode RPC를 역발사하므로 사용 금지
      const keyState = useKeyStore.getState();
      const keyChanges: {
        keyMappings?: KeyMappings;
        positions?: KeyPositions;
        customTabs?: CustomTab[];
        selectedKeyType?: string;
      } = {};
      if (
        stableStringify(keyState.keyMappings) !==
        stableStringify(bootstrap.keys)
      ) {
        keyChanges.keyMappings = bootstrap.keys;
      }
      if (
        stableStringify(keyState.positions) !==
        stableStringify(bootstrap.positions)
      ) {
        keyChanges.positions = bootstrap.positions;
      }
      if (
        stableStringify(keyState.customTabs) !==
        stableStringify(bootstrap.customTabs)
      ) {
        keyChanges.customTabs = bootstrap.customTabs;
      }
      if (keyState.selectedKeyType !== bootstrap.selectedKeyType) {
        keyChanges.selectedKeyType = bootstrap.selectedKeyType;
      }
      if (Object.keys(keyChanges).length > 0) {
        useKeyStore.setState((state) => ({ ...state, ...keyChanges }));
      }

      // stat/graph/knob positions: 변경 시에만 적용
      const nextStat = bootstrap.statPositions ?? {};
      if (
        stableStringify(useStatItemStore.getState().positions) !==
        stableStringify(nextStat)
      ) {
        useStatItemStore.setState((state) => ({
          ...state,
          positions: nextStat,
        }));
      }
      const nextGraph = bootstrap.graphPositions ?? {};
      if (
        stableStringify(useGraphItemStore.getState().positions) !==
        stableStringify(nextGraph)
      ) {
        useGraphItemStore.setState((state) => ({
          ...state,
          positions: nextGraph,
        }));
      }
      const nextKnob = bootstrap.knobPositions ?? {};
      if (
        stableStringify(useKnobItemStore.getState().positions) !==
        stableStringify(nextKnob)
      ) {
        useKnobItemStore.setState((state) => ({
          ...state,
          positions: nextKnob,
        }));
      }

      // 레이어 그룹: payload 내장값 사용 (추가 RPC 불필요)
      const nextGroups = bootstrap.layerGroups ?? {};
      if (
        stableStringify(useLayerGroupStore.getState().layerGroups) !==
        stableStringify(nextGroups)
      ) {
        useLayerGroupStore.getState().setLayerGroups(nextGroups);
      }

      // 카운터: 캐시는 무조건(순수 데이터), 시그널은 동일 값 무통지라 안전.
      // 딜레이 타이머로 대기 중인 키는 스킵 — 타이머가 스냅샷보다 최신
      // 이벤트 값을 들고 있어, 스냅샷으로 덮으면 과거 값이 깜빡임
      applyCounterCacheSnapshot(bootstrap.keyCounters);
      if (isOverlayWindow) {
        applyCounterSnapshot(bootstrap.keyCounters, (composed) =>
          counterDelayTimers.has(composed),
        );
      }

      finalizeBootstrap();
    };

    // 연속 발화 코얼레서: 초기 적용 전/진행 중 요청은 큐잉 후 1회 재실행
    const runResync = async () => {
      if (disposed) return;
      if (!initialApplied || resyncInFlight) {
        resyncQueued = true;
        return;
      }
      resyncInFlight = true;
      do {
        resyncQueued = false;
        try {
          const bootstrap = await window.api.app.bootstrap();
          if (disposed) return;
          applyResyncSnapshot(bootstrap);
        } catch (error) {
          console.error('OBS 재동기화 실패', error);
        }
      } while (resyncQueued && !disposed);
      resyncInFlight = false;
    };

    (async () => {
      try {
        const bootstrap = await window.api.app.bootstrap();
        if (disposed) return;
        initDefaults(bootstrap.defaults);
        setAll(buildSettingsSnapshot(bootstrap, {}));
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
        useKnobItemStore.setState((state) => ({
          ...state,
          positions: bootstrap.knobPositions ?? {},
        }));
        applyCounterCacheSnapshot(bootstrap.keyCounters);
        if (isOverlayWindow) {
          applyCounterSnapshot(bootstrap.keyCounters);
        }

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
      } catch (error) {
        console.error('초기 부트스트랩 실패', error);
      } finally {
        // 초기 성공/실패와 무관하게 재동기화 게이트를 연다 — 초기 실패
        // 시에도 다음 obs:resync가 전체 상태를 복구할 수 있어야 함
        initialApplied = true;
        if (resyncQueued) {
          void runResync();
        }
      }
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
      window.api.knobItems.onPositionsChanged((positions) => {
        const isOverlayWindow = window.__dmn_window_type === 'overlay';
        if (
          !isOverlayWindow &&
          useKnobItemStore.getState().isLocalUpdateInProgress
        )
          return;
        useKnobItemStore.setState((state) => ({ ...state, positions }));
      }),
      window.api.layerGroups.onChanged((groups) => {
        useLayerGroupStore.getState().setLayerGroups(groups);
      }),
      window.api.keys.onModeChanged(({ mode }) => {
        useKeyStore.setState((state) => ({ ...state, selectedKeyType: mode }));
      }),
      window.api.keys.onCountersChanged((snapshot) => {
        clearCounterDelayTimers();
        applyCounterCacheSnapshot(snapshot);
        if (getUndoRedoInProgress()) return;
        if (isOverlayWindow) {
          applyCounterSnapshot(snapshot);
        }
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
        useKnobItemStore.setState((state) => ({
          ...state,
          positions: snapshot.knobPositions ?? {},
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
      // OBS WS 재연결/lag 복구 시 전체 상태 재동기화 (네이티브에서는 미발화)
      obsApi.onResync(() => {
        void runResync();
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

    if (isOverlayWindow) {
      unsubscribers.push(
        window.api.keys.onCounterChanged(({ mode, key, count }) => {
          scheduleCounterUpdate(mode, key, count);
        }),
      );
    } else {
      unsubscribers.push(
        window.api.keys.onCounterChanged(({ mode, key, count }) => {
          setCachedKeyCounter(mode, key, count);
        }),
      );
    }

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
