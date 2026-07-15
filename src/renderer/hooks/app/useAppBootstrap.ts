import { useEffect, useRef } from 'react';
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
import { notifyLocaleChanged, subscribe } from '@api/modules/shared';
import {
  acknowledgeLifecycleAfterEditorFlush,
  cancelLifecycleEditorFlush,
} from '@api/modules/appApi';
import { stableStringify } from '@utils/core/stableStringify';
import { useTranslation } from '@contexts/useTranslation';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import type { BootstrapPayload } from '@src/types/app';
import type { CustomTab } from '@src/types/key/keys';
import type { EditorCoordinatorState } from '@src/renderer/editor/runtime/editorCoordinator';
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
  const { t } = useTranslation();
  const translationRef = useRef(t);

  useEffect(() => {
    translationRef.current = t;
  }, [t]);

  useEffect(() => {
    let disposed = false;
    const isOverlayWindow = window.__dmn_window_type === 'overlay';
    let conflictDialogOpen = false;
    let lastShownPermanentEditorError: unknown = null;
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
      void window.api.ui.dialog
        .alert(
          getEditorCopy(
            'editorSave.permanentFailure',
            '저장할 수 없는 편집 내용이라 마지막으로 저장된 상태로 되돌렸습니다. 방금 변경한 값을 확인해 주세요.',
            'This edit could not be saved, so the editor was restored to the last saved state. Please check the value you just changed.',
          ),
          {
            confirmText: getEditorCopy('common.ok', '확인', 'OK'),
          },
        )
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

    // EditorDocument 밖의 슬라이스를 "변경 시에만" 적용 — 동일 데이터 재적용으로 인한 참조
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
          await editorCoordinator.sync();
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
        useLayerGroupStore
          .getState()
          .setLayerGroups(bootstrap.layerGroups ?? {});
        applyCounterCacheSnapshot(bootstrap.keyCounters);
        if (isOverlayWindow) {
          applyCounterSnapshot(bootstrap.keyCounters);
        }

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
        }

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
      editorCoordinator.subscribe(handleEditorCoordinatorState),
      subscribe<{ handshakeId: string; action: 'quit' | 'restart' }>(
        'app:close-requested',
        ({ handshakeId, action }) => {
          if (disposed) return;
          void acknowledgeLifecycleAfterEditorFlush(handshakeId).catch(
            (error) => {
              console.error(`편집 상태 저장 후 ${action} 실패`, error);
              void (async () => {
                await cancelLifecycleEditorFlush(handshakeId).catch(
                  () => undefined,
                );
                const overlay = await window.api.overlay
                  .get()
                  .catch(() => null);
                await window.api.window.showMain();
                if (overlay?.visible) {
                  await window.api.overlay.setVisible(true);
                }
              })().catch((showError) => {
                console.error('종료 취소 후 창 복원 실패', showError);
              });
            },
          );
        },
      ),
      window.api.settings.onChanged((diff: SettingsDiff) => {
        if (disposed || !diff) return;
        applyDiff(diff);
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
          customTabs: snapshot.customTabs,
          selectedKeyType: snapshot.selectedKeyType,
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

    handleEditorCoordinatorState(editorCoordinator.getState());

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
