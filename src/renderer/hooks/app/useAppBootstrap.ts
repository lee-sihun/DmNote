import { useEffect, useRef } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
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
import { overlayApi } from '@api/modules/overlayApi';
import { notifyLocaleChanged, subscribe } from '@api/modules/shared';
import {
  acknowledgeLifecycleAfterEditorFlush,
  cancelLifecycleEditorFlush,
  windowApi,
} from '@api/modules/appApi';
import { stableStringify } from '@utils/core/stableStringify';
import { useTranslation } from '@contexts/useTranslation';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { panelWindowApi } from '@api/modules/panelWindowApi';
import {
  detachPropertiesPanel,
  notePanelWindowHidden,
} from '@stores/grid/usePanelHostStore';
import { initPluginInstancesUndoSync } from '@plugins/runtime/displayElement/instancesUndoSync';
import { initPluginGroupRefsMirror } from '@plugins/runtime/pluginGroupRefsMirror';
import { historyApi } from '@api/modules/historyApi';
import {
  useHistoryStatusStore,
  syncHistoryStatus,
} from '@stores/data/useHistoryStatusStore';
import { flushFocusedEditor } from '@src/renderer/editor/runtime/lifecycleEditorFlush';
import {
  acquireHistoryEditorFlushLock,
  releaseHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from '@src/renderer/editor/runtime/historyEditorFlushLock';
import type { CanonicalBootstrapPayload } from '@src/types/app';
import type { CustomTab, KeyCounters } from '@src/types/key/keys';
import type { EditorCoordinatorState } from '@src/renderer/editor/runtime/editorCoordinator';
import {
  mergeNoteSettings,
  type TabNoteOverrides,
} from '@src/types/settings/noteSettings';
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
import { isEditorCapacityFailure } from '@src/types/editor';
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
  bootstrap: CanonicalBootstrapPayload,
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
  const { t } = useTranslation();
  const translationRef = useRef(t);

  useEffect(() => {
    translationRef.current = t;
  }, [t]);

  useEffect(() => {
    let disposed = false;
    let editorCoordinatorRetryTimer: ReturnType<typeof setTimeout> | null =
      null;
    const isOverlayWindow = window.__dmn_window_type === 'overlay';

    // authoritative 모드 변경 시 창 로컬 선택 무효화 - 이전 모드의 index가
    // 새 모드 요소로 재해석되지 않게
    const resetSelectionForModeChange = () => {
      const selection = useGridSelectionStore.getState();
      if (
        selection.selectedElements.length > 0 ||
        selection.selectedGroupIds.length > 0
      ) {
        selection.clearSelection();
      }
    };

    // 모드가 실제로 갈릴 때만 선택을 리셋한다.
    //
    // 백엔드는 customTabs와 프리셋 스냅샷을 keys:mode-changed보다 먼저 보낸다.
    // 여기서 리셋하지 않으면 그 사이 store가 "새 모드 + 옛 index"가 되고,
    // 그 창에서 확정된 편집이 새 모드의 엉뚱한 요소에 실린다
    const adoptSelectedKeyType = (
      customTabs: CustomTab[],
      selectedKeyType: string,
    ) => {
      const modeChanged =
        useKeyStore.getState().selectedKeyType !== selectedKeyType;
      useKeyStore.setState((state) => ({
        ...state,
        customTabs,
        selectedKeyType,
      }));
      if (modeChanged && !isOverlayWindow && window.__dmn_runtime !== 'obs') {
        resetSelectionForModeChange();
      }
    };

    let conflictDialogOpen = false;
    let lastShownPermanentEditorError: unknown = null;
    // 키 표시 딜레이와 동기화를 위한 카운터 업데이트 지연
    type CounterDelayTimerHandle = ReturnType<typeof setTimeout>;
    interface DelayedCounterUpdate {
      apply: () => void;
      mode: string;
      key: string;
      count: number;
      sessionId: string;
      revision: number;
    }
    const counterDelayTimers = new Map<
      string,
      Map<CounterDelayTimerHandle, DelayedCounterUpdate>
    >();
    const pendingCounterDelayTimers = new Map<
      CounterDelayTimerHandle,
      DelayedCounterUpdate
    >();

    const composeCounterKey = (mode?: string, key?: string) =>
      `${mode || '__unknown_mode__'}::${key || '__unknown_key__'}`;

    const getLatestPendingCounterUpdate = (composedKey: string) => {
      const timers = counterDelayTimers.get(composedKey);
      if (!timers) return null;

      let latest: DelayedCounterUpdate | null = null;
      timers.forEach((update) => {
        if (latest === null || update.revision > latest.revision) {
          latest = update;
        }
      });
      return latest;
    };

    const clearCounterDelayTimers = (composedKey?: string) => {
      if (composedKey) {
        const timers = counterDelayTimers.get(composedKey);
        if (timers) {
          timers.forEach((_update, timer) => {
            clearTimeout(timer);
            pendingCounterDelayTimers.delete(timer);
          });
          counterDelayTimers.delete(composedKey);
        }
        return;
      }

      pendingCounterDelayTimers.forEach((_update, timer) =>
        clearTimeout(timer),
      );
      pendingCounterDelayTimers.clear();
      counterDelayTimers.forEach((timers) => timers.clear());
      counterDelayTimers.clear();
    };

    const discardCounterDelayTimers = (
      shouldDiscard: (update: DelayedCounterUpdate) => boolean,
    ) => {
      counterDelayTimers.forEach((timers, composedKey) => {
        timers.forEach((update, timer) => {
          if (!shouldDiscard(update)) return;
          clearTimeout(timer);
          timers.delete(timer);
          pendingCounterDelayTimers.delete(timer);
        });
        if (timers.size === 0) {
          counterDelayTimers.delete(composedKey);
        }
      });
    };

    const flushCounterDelayTimers = () => {
      const pending = [...pendingCounterDelayTimers.entries()];
      pendingCounterDelayTimers.clear();
      counterDelayTimers.forEach((timers) => timers.clear());
      counterDelayTimers.clear();

      pending.forEach(([timer, update]) => {
        clearTimeout(timer);
        update.apply();
      });
    };

    const scheduleEditorCoordinatorRecovery = () => {
      if (disposed || editorCoordinatorRetryTimer !== null) return;

      editorCoordinatorRetryTimer = setTimeout(() => {
        editorCoordinatorRetryTimer = null;
        if (disposed) return;

        void editorCoordinator
          .start()
          .then(() => editorCoordinator.sync())
          .catch(() => scheduleEditorCoordinatorRecovery());
      }, 1_000);
    };

    const resolveCounterDelayMs = (
      noteSettings: SettingsStateSnapshot['noteSettings'],
      tabNoteOverrides: SettingsStateSnapshot['tabNoteOverrides'],
      selectedKeyType: string,
    ) => {
      const effectiveSettings = mergeNoteSettings(
        noteSettings,
        tabNoteOverrides?.[selectedKeyType],
      );
      const delay = Number(effectiveSettings.keyDisplayDelayMs ?? 0);
      return delay > 0 ? delay : 0;
    };

    const getCounterDelayMs = () => {
      const { noteSettings, tabNoteOverrides } = useSettingsStore.getState();
      const { selectedKeyType } = useKeyStore.getState();
      return resolveCounterDelayMs(
        noteSettings,
        tabNoteOverrides,
        selectedKeyType,
      );
    };

    const scheduleCounterUpdate = (
      mode: string,
      key: string,
      count: number,
      sessionId: string,
      revision: number,
    ) => {
      const delayMs = getCounterDelayMs();
      const composedKey = composeCounterKey(mode, key);

      if (delayMs <= 0) {
        clearCounterDelayTimers(composedKey);
        setKeyCounter(mode, key, count);
        return;
      }

      const apply = () => {
        if (disposed) return;
        setKeyCounter(mode, key, count);
      };
      const update: DelayedCounterUpdate = {
        apply,
        mode,
        key,
        count,
        sessionId,
        revision,
      };
      const timer = setTimeout(() => {
        const pendingUpdate = pendingCounterDelayTimers.get(timer);
        if (!pendingUpdate) return;

        pendingCounterDelayTimers.delete(timer);
        const timers = counterDelayTimers.get(composedKey);
        timers?.delete(timer);
        if (timers?.size === 0) {
          counterDelayTimers.delete(composedKey);
        }
        pendingUpdate.apply();
      }, delayMs);

      const existing = counterDelayTimers.get(composedKey);
      if (existing) {
        existing.set(timer, update);
      } else {
        counterDelayTimers.set(composedKey, new Map([[timer, update]]));
      }
      pendingCounterDelayTimers.set(timer, update);
    };

    const { setAll, merge } = useSettingsStore.getState();

    const getEditorCopy = (key: string, korean: string, english: string) => {
      const translated = translationRef.current(key);
      if (translated && translated !== key) return translated;
      return useSettingsStore.getState().language === 'ko' ? korean : english;
    };

    const handleEditorConflict = (state: EditorCoordinatorState) => {
      if (disposed || !state.conflict || conflictDialogOpen) return;
      conflictDialogOpen = true;

      const resolve = async () => {
        try {
          if (isOverlayWindow) {
            await editorCoordinator.resolveConflict('acceptCanonical');
            return;
          }

          let keepLocal = true;
          try {
            const confirm = window.api.ui?.dialog?.confirm;
            if (typeof confirm === 'function') {
              keepLocal = await confirm(
                getEditorCopy(
                  'editorConflict.message',
                  "현재 편집 내용과 외부 변경이 겹쳤습니다. '내 편집 유지'는 지금 편집한 내용을 다시 적용하고, '외부 변경 수용'은 저장되지 않은 내 편집을 취소합니다.",
                  "Your edit overlaps an external change. 'Keep My Edit' reapplies your edit, while 'Accept External Change' discards the unsaved local edit.",
                ),
                {
                  confirmText: getEditorCopy(
                    'editorConflict.keepLocal',
                    '내 편집 유지',
                    'Keep My Edit',
                  ),
                  cancelText: getEditorCopy(
                    'editorConflict.acceptExternal',
                    '외부 변경 수용',
                    'Accept External Change',
                  ),
                },
              );
            }
          } catch (dialogError) {
            console.warn(
              '편집 충돌 대화상자를 열지 못해 내 편집을 유지합니다',
              dialogError,
            );
          }
          await editorCoordinator.resolveConflict(
            keepLocal ? 'keepLocal' : 'acceptCanonical',
          );
        } catch (error) {
          console.error('편집 충돌 해결 실패', error);
        } finally {
          conflictDialogOpen = false;
          const latest = editorCoordinator.getState();
          if (!disposed && latest.conflict) {
            queueMicrotask(() => handleEditorConflict(latest));
          }
        }
      };

      void resolve();
    };

    const handleEditorFailure = (state: EditorCoordinatorState) => {
      if (
        disposed ||
        isOverlayWindow ||
        state.failureKind !== 'permanent' ||
        !state.error ||
        state.error === lastShownPermanentEditorError
      ) {
        return;
      }

      lastShownPermanentEditorError = state.error;
      console.error(
        '저장할 수 없는 편집 내용을 마지막 저장 상태로 되돌렸습니다',
        state.error,
      );
      const message = isEditorCapacityFailure(state.error)
        ? getEditorCopy(
            'editorSave.capacityFailure',
            '저장 한도를 넘어 변경을 되돌렸습니다.\n일부 요소를 줄이고 다시 시도해 주세요.',
            'This edit exceeded the save limit and was undone.\nRemove some elements and try again.',
          )
        : getEditorCopy(
            'editorSave.permanentFailure',
            '저장하지 못해 변경 내용을 되돌렸습니다.\n방금 바꾼 값을 확인해 주세요.',
            "Couldn't save this edit, so it was undone.\nCheck the value you just changed.",
          );
      void window.api.ui.dialog
        .alert(message, {
          confirmText: getEditorCopy('common.ok', '확인', 'OK'),
        })
        .catch((error) => {
          console.error('편집 저장 실패 안내를 표시하지 못했습니다', error);
        });
    };

    const handleEditorCoordinatorState = (state: EditorCoordinatorState) => {
      handleEditorConflict(state);
      handleEditorFailure(state);
    };

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
    let latestCounterSessionId: string | null = null;
    let latestCounterRevision = 0;
    interface CounterResyncContext {
      latestUpdates: Map<
        string,
        {
          mode: string;
          key: string;
          count: number;
          sessionId: string;
          revision: number;
        }
      >;
      latestSnapshot: { sessionId: string; revision: number } | null;
    }
    let counterResyncContext: CounterResyncContext | null = null;

    const adoptCounterSession = (sessionId: string) => {
      if (latestCounterSessionId === sessionId) return;

      latestCounterSessionId = sessionId;
      latestCounterRevision = 0;
      clearCounterDelayTimers();
      if (counterResyncContext) {
        counterResyncContext.latestUpdates.clear();
        counterResyncContext.latestSnapshot = null;
      }
    };

    const reconcileResyncCounters = (
      counters: KeyCounters,
      sessionId: string,
      revision: number,
      context: CounterResyncContext,
    ) => {
      const reconciled = Object.fromEntries(
        Object.entries(counters).map(([mode, entries]) => [
          mode,
          { ...entries },
        ]),
      ) as KeyCounters;

      context.latestUpdates.forEach(
        ({
          mode,
          key,
          count,
          sessionId: eventSessionId,
          revision: eventRevision,
        }) => {
          if (eventSessionId !== sessionId || eventRevision <= revision) return;
          const modeCounters = (reconciled[mode] ??= {});
          modeCounters[key] = count;
        },
      );
      return reconciled;
    };

    const applyResyncCounters = (
      counters: KeyCounters,
      sessionId: string,
      revision: number,
      context: CounterResyncContext,
    ) => {
      adoptCounterSession(sessionId);
      // bootstrap 캡처 뒤 도착한 전체 스냅샷(reset/undo 등)이 이미 더 최신이면
      // 카운터 슬라이스만 되돌리지 않음
      if (
        context.latestSnapshot?.sessionId === sessionId &&
        context.latestSnapshot.revision > revision
      ) {
        return;
      }

      const reconciled = reconcileResyncCounters(
        counters,
        sessionId,
        revision,
        context,
      );
      discardCounterDelayTimers(
        (pending) =>
          pending.sessionId !== sessionId || pending.revision <= revision,
      );

      applyCounterCacheSnapshot(reconciled);
      if (isOverlayWindow) {
        applyCounterSnapshot(reconciled, (composed) => {
          const pending = getLatestPendingCounterUpdate(composed);
          if (pending?.sessionId === sessionId && pending.revision > revision) {
            return true;
          }
          const update = context.latestUpdates.get(composed);
          return Boolean(
            update?.sessionId === sessionId && update.revision > revision,
          );
        });
      }
      latestCounterRevision = Math.max(latestCounterRevision, revision);
    };

    // EditorDocument 밖의 슬라이스를 "변경 시에만" 적용 — 동일 데이터 재적용으로 인한 참조
    // 변경이 overlay 키 이벤트 effect 재실행(키 하이라이트 리셋) 등 시각적
    // 부작용을 유발하는 것을 방지
    const applyResyncSnapshot = (
      bootstrap: CanonicalBootstrapPayload,
      counterContext: CounterResyncContext,
    ) => {
      initDefaults(bootstrap.defaults);

      // 설정/모드 적용은 구독자를 통해 대기 카운터를 flush할 수 있으므로,
      // 카운터의 인과 순서를 먼저 확정한 뒤 나머지 스냅샷을 적용
      applyResyncCounters(
        bootstrap.keyCounters,
        bootstrap.keyCountersSessionId,
        bootstrap.keyCountersRevision,
        counterContext,
      );

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

      // 탭 메타데이터는 EditorDocument 밖이므로 bootstrap으로 재동기화
      // setSelectedKeyType 액션은 백엔드 setMode RPC를 역발사하므로 사용 금지
      const keyState = useKeyStore.getState();
      const keyChanges: {
        customTabs?: CustomTab[];
        selectedKeyType?: string;
      } = {};
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
        const counterContext: CounterResyncContext = {
          latestUpdates: new Map(),
          latestSnapshot: null,
        };
        counterResyncContext = counterContext;
        try {
          const bootstrap = await window.api.app.bootstrap();
          if (disposed) return;
          applyResyncSnapshot(bootstrap, counterContext);
          if (counterResyncContext === counterContext) {
            counterResyncContext = null;
          }
          await editorCoordinator.sync();
        } catch (error) {
          console.error('OBS 재동기화 실패', error);
        } finally {
          if (counterResyncContext === counterContext) {
            counterResyncContext = null;
          }
        }
      } while (resyncQueued && !disposed);
      resyncInFlight = false;
    };

    const initialCounterContext: CounterResyncContext = {
      latestUpdates: new Map(),
      latestSnapshot: null,
    };
    counterResyncContext = initialCounterContext;
    (async () => {
      try {
        const bootstrap = await window.api.app.bootstrap();
        if (disposed) return;
        initDefaults(bootstrap.defaults);
        applyResyncCounters(
          bootstrap.keyCounters,
          bootstrap.keyCountersSessionId,
          bootstrap.keyCountersRevision,
          initialCounterContext,
        );
        if (counterResyncContext === initialCounterContext) {
          counterResyncContext = null;
        }
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
          canonicalPositions: bootstrap.positions,
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
        useLayerGroupStore
          .getState()
          .setLayerGroups(bootstrap.layerGroups ?? {});

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

        // 정식 이벤트를 먼저 구독한 뒤 최신 revision을 다시 읽어
        // bootstrap 도중 발생한 편집도 빠짐없이 반영
        try {
          await editorCoordinator.start();
          // 플러그인이 bootstrap보다 먼저 coordinator를 시작했어도
          // 늦게 도착한 bootstrap 스냅샷이 최신 편집 화면을 덮지 않게 재적용
          await editorCoordinator.sync({ reapply: true });
        } catch (error) {
          console.error('편집 상태 초기화 실패', error);
          scheduleEditorCoordinatorRecovery();
        }

        // 백엔드 undo authority 상태 초기 조회
        if (window.__dmn_runtime !== 'obs') {
          void syncHistoryStatus();
        }

        finalizeBootstrap();

        // 분리 상태로 종료했다면 복원 - 창은 메인만 열 수 있어(opener 자식) 백엔드는
        // 요청만 남긴다. 부트스트랩 뒤에 열어야 패널이 채워진 상태로 뜬다
        if (window.__dmn_window_type === 'main') {
          try {
            if (await panelWindowApi.takeRestoreRequest()) {
              void detachPropertiesPanel();
            }
          } catch (error) {
            console.error('분리 패널 복원 요청 확인 실패', error);
          }
        }
      } catch (error) {
        console.error('초기 부트스트랩 실패', error);
      } finally {
        if (counterResyncContext === initialCounterContext) {
          counterResyncContext = null;
        }
        // 초기 성공/실패와 무관하게 재동기화 게이트를 연다 — 초기 실패
        // 시에도 다음 obs:resync가 전체 상태를 복구할 수 있어야 함
        initialApplied = true;
        if (resyncQueued) {
          void runResync();
        }
      }
    })();

    // 플러그인 인스턴스 undo/redo의 canonical 재결합 (C4)
    const stopPluginInstancesUndoSync =
      window.__dmn_runtime !== 'obs' && window.__dmn_window_type === 'main'
        ? initPluginInstancesUndoSync()
        : null;
    // 미로드 플러그인 저장 인스턴스의 그룹 참조 미러 - normalize 모집단 정합
    const stopPluginGroupRefsMirror =
      window.__dmn_runtime !== 'obs' && window.__dmn_window_type === 'main'
        ? initPluginGroupRefsMirror()
        : null;

    const unsubscribers = [
      editorCoordinator.subscribe(handleEditorCoordinatorState),
      // undo/redo 가능 여부 projection (revision 역전은 스토어가 무시)
      historyApi.onStatus((status) => {
        useHistoryStatusStore.getState().applyStatus(status);
      }),
      // 백엔드가 패널 창을 감추거나(close-ack 타임아웃·종료) 파괴하면 호스트를 메인으로
      panelWindowApi.onVisibility(({ visible }) => {
        if (window.__dmn_window_type !== 'main') return;
        if (!visible) notePanelWindowHidden();
      }),
      subscribe<{
        handshakeId: string;
        action: 'quit' | 'restart' | 'history';
      }>('app:close-requested', ({ handshakeId, action }) => {
        if (disposed) return;
        if (action === 'history') {
          acquireHistoryEditorFlushLock(handshakeId);
        }
        void (async () => {
          const committed = await flushFocusedEditor();
          if (!committed) {
            throw new Error('pending focused editor failed to commit');
          }
          await acknowledgeLifecycleAfterEditorFlush(handshakeId);
        })().catch((error) => {
          console.error(`편집 상태 저장 후 ${action} 실패`, error);
          void (async () => {
            await cancelLifecycleEditorFlush(handshakeId).catch(
              () => undefined,
            );
            if (action === 'history') return;
            const overlay = await window.api.overlay.get().catch(() => null);
            await windowApi.showMain();
            if (overlay?.visible) {
              await overlayApi.setVisible(true);
            }
          })().catch((showError) => {
            console.error('종료 취소 후 창 복원 실패', showError);
          });
        });
      }),
      subscribe<{ handshakeId: string }>(
        'app:history-flush-released',
        ({ handshakeId }) => {
          releaseHistoryEditorFlushLock(handshakeId);
        },
      ),
      window.api.settings.onChanged((diff: SettingsDiff) => {
        if (disposed || !diff) return;
        applyDiff(diff);
      }),
      window.api.keys.onModeChanged(({ mode }) => {
        useKeyStore.setState((state) => ({ ...state, selectedKeyType: mode }));
        // 이전 모드 선택 index가 새 모드 요소로 재해석되는 것 방지
        if (!isOverlayWindow && window.__dmn_runtime !== 'obs') {
          resetSelectionForModeChange();
        }
      }),
      subscribe<{
        sessionId: string;
        revision: number;
        counters: KeyCounters;
      }>('keys:counters-state', (event) => {
        adoptCounterSession(event.sessionId);
        if (event.revision <= latestCounterRevision) return;
        latestCounterRevision = event.revision;

        const context = counterResyncContext;
        if (context) {
          if (
            context.latestSnapshot?.sessionId !== event.sessionId ||
            event.revision > context.latestSnapshot.revision
          ) {
            context.latestSnapshot = {
              sessionId: event.sessionId,
              revision: event.revision,
            };
          }
          context.latestUpdates.forEach((update, composed) => {
            if (
              update.sessionId !== event.sessionId ||
              update.revision <= event.revision
            ) {
              context.latestUpdates.delete(composed);
            }
          });
        }
        clearCounterDelayTimers();
        applyCounterCacheSnapshot(event.counters);
        if (getUndoRedoInProgress()) return;
        if (isOverlayWindow) {
          applyCounterSnapshot(event.counters);
        }
      }),
      window.api.keys.onCounterChanged((event) => {
        adoptCounterSession(event.sessionId);
        if (event.revision <= latestCounterRevision) return;
        latestCounterRevision = event.revision;

        setCachedKeyCounter(event.mode, event.key, event.count);
        const composed = composeCounterKey(event.mode, event.key);
        const previous = counterResyncContext?.latestUpdates.get(composed);
        if (!previous || event.revision > previous.revision) {
          counterResyncContext?.latestUpdates.set(composed, event);
        }
        if (isOverlayWindow) {
          scheduleCounterUpdate(
            event.mode,
            event.key,
            event.count,
            event.sessionId,
            event.revision,
          );
        }
      }),
      window.api.keys.customTabs.onChanged(
        ({ customTabs, selectedKeyType }) => {
          adoptSelectedKeyType(customTabs, selectedKeyType);
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
        adoptSelectedKeyType(snapshot.customTabs, snapshot.selectedKeyType);
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
        const { selectedKeyType } = useKeyStore.getState();
        const nextDelay = resolveCounterDelayMs(
          state.noteSettings,
          state.tabNoteOverrides,
          selectedKeyType,
        );
        const prevDelay = resolveCounterDelayMs(
          previousState.noteSettings,
          previousState.tabNoteOverrides,
          selectedKeyType,
        );
        if (nextDelay !== prevDelay) {
          flushCounterDelayTimers();
        }
      }),
      useKeyStore.subscribe((state, previousState) => {
        if (state.selectedKeyType !== previousState.selectedKeyType) {
          flushCounterDelayTimers();
        }
      }),
    ];

    handleEditorCoordinatorState(editorCoordinator.getState());

    const handleWindowFocus = () => {
      refreshCursorSettings().catch(() => {});
    };
    window.addEventListener('focus', handleWindowFocus);
    unsubscribers.push(() =>
      window.removeEventListener('focus', handleWindowFocus),
    );

    return () => {
      disposed = true;
      if (editorCoordinatorRetryTimer !== null) {
        clearTimeout(editorCoordinatorRetryTimer);
        editorCoordinatorRetryTimer = null;
      }
      resetHistoryEditorFlushLock();
      stopPluginInstancesUndoSync?.();
      stopPluginGroupRefsMirror?.();
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
