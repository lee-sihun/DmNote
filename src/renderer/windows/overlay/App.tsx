import React, { useEffect, useMemo, useRef } from 'react';
import {
  currentMonitor,
  getCurrentWindow,
  Window as TauriWindow,
} from '@tauri-apps/api/window';
import { LogicalPosition, PhysicalPosition } from '@tauri-apps/api/dpi';
import { Menu } from '@tauri-apps/api/menu';
import { useTranslation } from '@contexts/useTranslation';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import { MAX_EVENT_AGE_MS } from '@constants/inputTiming';
import { mergeNoteSettings } from '@src/types/settings/noteSettings';
import { useCustomCssInjection } from '@hooks/app/useCustomCssInjection';
import { useCustomJsInjection } from '@hooks/app/useCustomJsInjection';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import { useNoteSystem } from '@hooks/overlay/useNoteSystem';
import { useTrackReserveTransition } from '@hooks/overlay/useTrackReserveTransition';
import { useAppBootstrap } from '@hooks/app/useAppBootstrap';
import { obsApi } from '@api/modules/obsApi';
import { overlayApi } from '@api/modules/overlayApi';
import { settingsApi } from '@api/modules/settingsApi';
import { appApi, windowApi } from '@api/modules/appApi';
import { useBuiltinStatsSubscription } from '@hooks/overlay/useBuiltinStatsSubscription';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import {
  setKeyActive as setKeyActiveSignal,
  resetAllKeySignals,
} from '@stores/signals/keySignals';
import { useSettingsStore } from '@stores/useSettingsStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import {
  selectPluginLayoutElements,
  pluginLayoutElementsEqual,
} from '@utils/plugin/pluginLayoutElements';
import OverlayScene from '@components/shared/OverlayScene';
import { computeLayout } from '@hooks/shared/useLayoutComputation';
import {
  buildCanonicalIndexMap,
  isSlotAssigned,
  slotCanonical,
  slotDisplayName,
} from '@utils/keySlot';
import type { KeySlot } from '@src/types/key/keys';

type KeyDelayTimerHandle = ReturnType<typeof setTimeout>;
type KeyDelayTimerEntry = {
  timers: Map<KeyDelayTimerHandle, () => void>;
};

const cancelKeyDelayTimers = (
  entries: Map<string, KeyDelayTimerEntry>,
  pendingTimers: Map<KeyDelayTimerHandle, () => void>,
) => {
  pendingTimers.forEach((_apply, timer) => clearTimeout(timer));
  pendingTimers.clear();
  entries.forEach((entry) => entry.timers.clear());
  entries.clear();
};

// 슬라이스 부재 시에도 identity 안정 - computeLayout 메모 deps로 사용됨
// 이종 배열 5곳이 같은 인스턴스를 별칭하므로 freeze로 교차 오염 차단
const EMPTY_SLICE: never[] = Object.freeze([]) as never[];

const flushKeyDelayTimers = (
  entries: Map<string, KeyDelayTimerEntry>,
  pendingTimers: Map<KeyDelayTimerHandle, () => void>,
) => {
  const pending = [...pendingTimers.entries()];
  pendingTimers.clear();
  entries.forEach((entry) => entry.timers.clear());
  entries.clear();

  pending.forEach(([timer, apply]) => {
    clearTimeout(timer);
    apply();
  });
};

const validKeySet = (slots: readonly KeySlot[]) =>
  new Set(slots.filter(isSlotAssigned).map((slot) => slotCanonical(slot)));

const validKeySignature = (slots: readonly KeySlot[]) =>
  JSON.stringify([...validKeySet(slots)].sort());

export default function App() {
  const isBootstrapped = useKeyStore((state) => state.isBootstrapped);
  useCustomCssInjection();
  useCustomJsInjection(isBootstrapped);
  useAppBootstrap();
  useBuiltinStatsSubscription();
  useBlockBrowserShortcuts();
  const { t } = useTranslation();
  const developerModeEnabled = useSettingsStore(
    (state) => state.developerModeEnabled,
  );

  // 개발자 모드 비활성 시 DevTools 단축키 차단
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isDevtoolsCombo =
        ((e.ctrlKey || e.metaKey) &&
          e.shiftKey &&
          e.key.toLowerCase() === 'i') ||
        e.key === 'F12';
      if (!developerModeEnabled && isDevtoolsCombo) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [developerModeEnabled]);

  // 윈도우 타입
  useEffect(() => {
    try {
      window.__dmn_window_type = 'overlay';
    } catch {
      // 무시
    }
    return () => {
      try {
        window.__dmn_window_type = undefined;
      } catch {
        // 무시
      }
    };
  }, []);

  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const positions = useKeyStore((state) => state.positions);
  const statPositions = useStatItemStore((state) => state.positions);
  const graphPositions = useGraphItemStore((state) => state.positions);
  const knobPositions = useKnobItemStore((state) => state.positions);
  // 레이아웃 필드만 투영 구독 - 플러그인 state/html 변경이 App 리렌더로 승격되지 않게
  const pluginElements = useStoreWithEqualityFn(
    usePluginDisplayElementStore,
    selectPluginLayoutElements,
    pluginLayoutElementsEqual,
  );

  const backgroundColor = useSettingsStore((state) => state.backgroundColor);
  const alwaysOnTop = useSettingsStore((state) => state.alwaysOnTop);
  const trayEnabled = useSettingsStore((state) => state.trayEnabled);
  const setAlwaysOnTop = useSettingsStore((state) => state.setAlwaysOnTop);
  const globalNoteSettings = useSettingsStore((state) => state.noteSettings);
  const tabNoteOverrides = useSettingsStore((state) => state.tabNoteOverrides);
  // 현재 탭 override로 deps 한정 - 다른 탭 override 변경이 재병합·재계산으로 번지지 않게
  const currentTabNoteOverride = tabNoteOverrides?.[selectedKeyType];
  const noteSettings = useMemo(
    () => mergeNoteSettings(globalNoteSettings, currentTabNoteOverride),
    [globalNoteSettings, currentTabNoteOverride],
  );
  const noteEffect = useSettingsStore((state) => state.noteEffect);
  const overlayPadding = useSettingsStore(
    (state) => state.gridSettings.overlayPadding ?? 30,
  );
  const overlayAnchor = useSettingsStore((state) => state.overlayResizeAnchor);
  const keyCounterEnabled = useSettingsStore(
    (state) => state.keyCounterEnabled,
  );
  const customTabs = useKeyStore((state) => state.customTabs);
  const setSelectedKeyType = useKeyStore((state) => state.setSelectedKeyType);
  const resolveCanOpenMainSettings = async () => {
    if (!trayEnabled) {
      return false;
    }

    try {
      const mainWindow = await TauriWindow.getByLabel('main');
      if (!mainWindow) {
        return false;
      }
      const isMainVisible = await mainWindow.isVisible();
      return !isMainVisible;
    } catch (error) {
      console.error('Failed to resolve main window visibility', error);
      return false;
    }
  };

  // 탭 목록 (기본 탭 + 커스텀 탭)
  const BUILTIN_TABS = ['4key', '5key', '6key', '8key'].map((id) => {
    const num = id.replace('key', '');
    return { id, name: t(`mode.button${num}`) };
  });

  const handleOverlayMouseDownCapture = (
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    // 좌클릭은 창 전체 드래그 유지
    if (e.button !== 0) return;

    getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.error('Failed to start overlay dragging', error);
      });
  };

  const closeOverlayWindow = async () => {
    try {
      await overlayApi.setVisible(false);
    } catch (error) {
      console.error('Failed to close overlay window', error);
    }
  };

  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      await settingsApi.update({ alwaysOnTop: next });
    } catch (error) {
      console.error('Failed to toggle always-on-top', error);
      setAlwaysOnTop(!next);
    }
  };

  const openSettingsWindow = async () => {
    try {
      await windowApi.showMain();
    } catch (error) {
      console.error('Failed to open settings window', error);
    }
  };

  const quitApplication = async () => {
    try {
      await appApi.quit();
    } catch (error) {
      console.error('Failed to quit application', error);
    }
  };

  const snapToNearestEdge = async () => {
    try {
      const win = getCurrentWindow();
      const [monitor, pos, size] = await Promise.all([
        currentMonitor(),
        win.outerPosition(),
        win.outerSize(),
      ]);
      if (!monitor) return;

      // 화면 끝 기준 - 오버레이는 항상 위 표시라 독·작업 표시줄 위에 그려진다
      const monitorPos = monitor.position;
      const monitorSize = monitor.size;

      // 창의 중심 좌표
      const centerX = pos.x + size.width / 2;
      const centerY = pos.y + size.height / 2;

      // 모니터의 중심 좌표
      const monitorCenterX = monitorPos.x + monitorSize.width / 2;
      const monitorCenterY = monitorPos.y + monitorSize.height / 2;

      // 가장 가까운 모서리 결정
      const snapLeft = centerX < monitorCenterX;
      const snapTop = centerY < monitorCenterY;

      // 창이 화면보다 크면 우·하단 정렬 값이 시작점보다 앞서므로 좌·상단으로 고정
      const newX = snapLeft
        ? monitorPos.x
        : Math.max(monitorPos.x, monitorPos.x + monitorSize.width - size.width);
      const newY = snapTop
        ? monitorPos.y
        : Math.max(
            monitorPos.y,
            monitorPos.y + monitorSize.height - size.height,
          );

      await win.setPosition(new PhysicalPosition(newX, newY));
    } catch (error) {
      console.error('Failed to snap overlay to edge', error);
    }
  };

  const openOverlayContextMenuAtImpl = useRef<
    (x: number, y: number) => Promise<void>
  >(async () => {});
  const contextMenuOpenRef = useRef(false);
  openOverlayContextMenuAtImpl.current = async (x: number, y: number) => {
    const canOpenMainSettings = await resolveCanOpenMainSettings();
    const allTabs = [
      ...BUILTIN_TABS,
      ...customTabs.map((tab) => ({ id: tab.id, name: tab.name })),
    ];

    let menu: Menu | null = null;
    try {
      menu = await Menu.new({
        items: [
          {
            id: 'toggleAlwaysOnTop',
            text: t('settings.alwaysOnTop'),
            checked: alwaysOnTop,
            action: () => {
              void toggleAlwaysOnTop();
            },
          },
          { item: 'Separator' },
          {
            id: 'selectTab',
            text: t('contextMenu.selectTab'),
            items: allTabs.map((tab) => ({
              id: `selectTab-${tab.id}`,
              text: tab.name,
              checked: tab.id === selectedKeyType,
              action: () => {
                setSelectedKeyType(tab.id);
              },
            })),
          },
          {
            id: 'closeOverlay',
            text: t('tooltip.overlayClose'),
            action: () => {
              void closeOverlayWindow();
            },
          },
          {
            id: 'snapToEdge',
            text: t('contextMenu.snapToEdge'),
            action: () => {
              void snapToNearestEdge();
            },
          },
          { item: 'Separator' },
          {
            id: 'openSettingsWindow',
            text: t('tooltip.settings'),
            enabled: canOpenMainSettings,
            action: () => {
              void openSettingsWindow();
            },
          },
          { item: 'Separator' },
          {
            id: 'quitApplication',
            text: t('contextMenu.quitApp'),
            action: () => {
              void quitApplication();
            },
          },
        ],
      });

      await menu.popup(
        new LogicalPosition(Math.round(x), Math.round(y)),
        getCurrentWindow(),
      );
    } catch (error) {
      console.error('Failed to open native overlay context menu', error);
    } finally {
      if (menu) {
        await menu.close().catch(() => {});
      }
    }
  };
  const openOverlayContextMenuAt = async (x: number, y: number) => {
    if (contextMenuOpenRef.current) return;
    contextMenuOpenRef.current = true;
    try {
      await openOverlayContextMenuAtImpl.current(x, y);
    } finally {
      contextMenuOpenRef.current = false;
    }
  };

  useEffect(() => {
    const handleWindowContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void openOverlayContextMenuAt(event.clientX, event.clientY);
    };

    window.addEventListener('contextmenu', handleWindowContextMenu, true);
    return () => {
      window.removeEventListener('contextmenu', handleWindowContextMenu, true);
    };
  }, []);

  const {
    notesRef,
    subscribe,
    handleKeyDown,
    handleKeyUp,
    finalizeAllActive,
    reconcileActiveNotes,
    noteBuffer,
    updateTrackLayouts,
  } = useNoteSystem({
    noteEffect,
    noteSettings,
  });

  // 노트 이펙트 꺼짐 시 트랙 예약 공간 제거 - 창 높이와 키 오프셋이 함께 줄어든다
  const targetTrackReserve = noteEffect
    ? noteSettings?.trackHeight ?? DEFAULT_NOTE_SETTINGS.trackHeight
    : 0;
  // 토글 전환은 창 페이드로 감싸 리사이즈 순간의 덜컥거림을 가린다
  // 하이드레이션 전 초기값 반영은 전환 없이 즉시 채택
  const { trackHeight, contentFade } = useTrackReserveTransition(
    targetTrackReserve,
    isBootstrapped,
  );

  // 키 딜레이 설정
  const keyDisplayDelayMs = Number(noteSettings?.keyDisplayDelayMs ?? 0);

  // 키 딜레이 타이머 관리 (down/up 별도 관리)
  const keyDelayTimersRef = useRef<Map<string, KeyDelayTimerEntry>>(new Map());
  const pendingKeyDelayTimersRef = useRef<Map<KeyDelayTimerHandle, () => void>>(
    new Map(),
  );

  // 키 딜레이 값을 ref로 관리하여 클로저 문제 방지
  const keyDisplayDelayMsRef = useRef(keyDisplayDelayMs);
  useEffect(() => {
    if (keyDisplayDelayMsRef.current !== keyDisplayDelayMs) {
      flushKeyDelayTimers(
        keyDelayTimersRef.current,
        pendingKeyDelayTimersRef.current,
      );
    }
    keyDisplayDelayMsRef.current = keyDisplayDelayMs;
  }, [keyDisplayDelayMs]);

  // 탭 전환 시 진행 중인 모든 노트 강제 완료
  useEffect(() => {
    finalizeAllActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeyType]);

  // 구독 콜백이 읽는 최신 컨텍스트 - 구독 자체는 마운트 1회로 고정
  // positions·keyMappings가 deps에 있으면 undo의 canonical 복원마다 재구독되고,
  // cleanup의 resetAllKeySignals가 눌림 표시 중간에 끼어들어 이중 깜빡임 발생
  const keyEventContextRef = useRef({
    noteEffect,
    keyMappings,
    positions,
    selectedKeyType,
    handleKeyDown,
    handleKeyUp,
    finalizeAllActive,
    reconcileActiveNotes,
  });
  useEffect(() => {
    keyEventContextRef.current = {
      noteEffect,
      keyMappings,
      positions,
      selectedKeyType,
      handleKeyDown,
      handleKeyUp,
      finalizeAllActive,
      reconcileActiveNotes,
    };
  });

  // 리셋 이후 이벤트가 도착한 키 추적 - 스냅샷 재수화보다 최신 이벤트가 우선
  const seenSinceResetRef = useRef<Set<string>>(new Set());
  // 대조(reconcile) fetch 이후 도착한 실이벤트 추적 - null이면 수집 안 함
  const reconcileSeenRef = useRef<Set<string> | null>(null);
  // 중첩 대조의 낡은 응답 차단 - keys:reset·탭 전환·새 대조가 세대를 올림
  const reconcileGenerationRef = useRef(0);
  // 탭 전환 재수화가 구독 확립을 기다릴 수 있게 구독 준비 promise 보관
  const keyEventsReadyRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    // 키 딜레이 적용된 신호 업데이트
    const updateKeySignalWithDelay = (key: string, isDown: boolean) => {
      const delayMs = keyDisplayDelayMsRef.current;

      let timerEntry = keyDelayTimersRef.current.get(key);
      if (!timerEntry) {
        timerEntry = { timers: new Map() };
        keyDelayTimersRef.current.set(key, timerEntry);
      }

      if (delayMs <= 0) {
        timerEntry.timers.forEach((_apply, timer) => {
          clearTimeout(timer);
          pendingKeyDelayTimersRef.current.delete(timer);
        });
        timerEntry.timers.clear();
        keyDelayTimersRef.current.delete(key);
        setKeyActiveSignal(key, isDown);
        return;
      }

      const apply = () => setKeyActiveSignal(key, isDown);
      const timer = setTimeout(() => {
        const pendingApply = pendingKeyDelayTimersRef.current.get(timer);
        if (!pendingApply) return;

        pendingKeyDelayTimersRef.current.delete(timer);
        const currentEntry = keyDelayTimersRef.current.get(key);
        currentEntry?.timers.delete(timer);
        if (currentEntry?.timers.size === 0) {
          keyDelayTimersRef.current.delete(key);
        }
        pendingApply();
      }, delayMs);
      timerEntry.timers.set(timer, apply);
      pendingKeyDelayTimersRef.current.set(timer, apply);
    };

    // HID 축 이벤트 버스 초기화 (input:axis 구독 → axisSignals 누적)
    import('@utils/core/axisEventBus').then(({ axisEventBus }) => {
      axisEventBus.initialize();
    });

    let hydrationCancelled = false;

    // 키 이벤트 구독을 먼저 확립한 뒤 눌림 스냅샷 요청
    const unsubscribe = import('@utils/core/keyEventBus').then(
      async ({ keyEventBus }) => {
        if (hydrationCancelled) return undefined;
        const unsubscribeKeyEvents = keyEventBus.subscribe(
          ({ key, state, mode, eventAgeMs, holdDurationMs }) => {
            seenSinceResetRef.current.add(key);
            reconcileSeenRef.current?.add(`${mode}::${key}`);
            const isDown = state === 'DOWN';
            // 키 UI 업데이트 (딜레이 적용)
            updateKeySignalWithDelay(key, isDown);
            const {
              noteEffect,
              keyMappings,
              positions,
              selectedKeyType,
              handleKeyDown,
              handleKeyUp,
            } = keyEventContextRef.current;
            // 노트 이펙트는 즉시 처리 (딜레이 없음)
            if (noteEffect) {
              // 실제 입력 시각을 복원해 노트 시작 위치를 보정 (프레임 양자화 방지).
              // displayTime은 0~MAX_EVENT_AGE_MS 클램프 - 백엔드 stall/클럭 이상 시
              // 노트가 화면 위로 튀는 것을 방지. physTime은 비클램프 - 단/롱 판정의
              // hold 폴백 계산 전용이라 클램프 절단 왜곡을 받지 않음
              const rawAge = Math.max(eventAgeMs ?? 0, 0);
              const displayAge = Math.min(rawAge, MAX_EVENT_AGE_MS);
              const now = performance.now();
              const timing = {
                displayTime: now - displayAge,
                physTime: now - rawAge,
                holdDurationMs,
              };

              if (isDown) {
                // 개별 키의 noteEffectEnabled는 DOWN에만 적용
                // canonical → 대표 슬롯 인덱스 (Multi 우선, 계약 §11)
                const currentSlots = keyMappings[selectedKeyType] ?? [];
                const currentPositions = positions[selectedKeyType] ?? [];
                const keyIndex =
                  buildCanonicalIndexMap(currentSlots).get(key) ?? -1;
                const keyPosition = currentPositions[keyIndex];
                if (keyPosition?.noteEffectEnabled !== false) {
                  handleKeyDown(key, timing);
                }
              } else {
                // UP은 항상 전달 - DOWN 이후 설정이 꺼진 키의 활성 노트 고착 방지
                handleKeyUp(key, timing);
              }
            }
          },
        );

        try {
          await keyEventBus.initialize();
        } catch (error) {
          unsubscribeKeyEvents();
          throw error;
        }

        if (hydrationCancelled) return unsubscribeKeyEvents;

        // 지연 생성된 오버레이 hydration — 구독 이후 이벤트가 온 키는
        // 최신 이벤트가 스냅샷보다 우선하며 KPS·노트 통계에는 반영하지 않음
        const hydrationSeen = seenSinceResetRef.current;
        void window.api.app
          .bootstrap()
          .then(({ activeKeys }) => {
            if (hydrationCancelled || !activeKeys?.length) return;
            // 탭 전환 리셋이 끼었으면 이 스냅샷은 낡음 - 전환 effect의 재수화가 담당
            if (seenSinceResetRef.current !== hydrationSeen) return;
            const { keyMappings, selectedKeyType } = keyEventContextRef.current;
            const validKeys = validKeySet(keyMappings[selectedKeyType] ?? []);
            for (const key of activeKeys) {
              if (validKeys.has(key) && !hydrationSeen.has(key)) {
                setKeyActiveSignal(key, true);
              }
            }
          })
          .catch((error) => {
            if (!hydrationCancelled) {
              console.error('Failed to hydrate active key state', error);
            }
          });

        return unsubscribeKeyEvents;
      },
    );
    keyEventsReadyRef.current = unsubscribe;
    void unsubscribe.catch((error) => {
      console.error('Failed to initialize key state listener', error);
    });

    // UP 유실 복구 - fresh 스냅샷과 활성 노트·눌림 신호를 대조 (실패 복구 경로)
    const reconcileWithBootstrap = async (): Promise<void> => {
      const generation = reconcileGenerationRef.current + 1;
      reconcileGenerationRef.current = generation;
      const sinceFetch = new Set<string>();
      reconcileSeenRef.current = sinceFetch;
      try {
        const payload = await window.api.app.bootstrap();
        if (hydrationCancelled) return;
        // 더 새로운 대조나 keys:reset·탭 전환이 끼었으면 이 응답은 낡음
        if (generation !== reconcileGenerationRef.current) return;
        const { selectedKeyType, keyMappings, reconcileActiveNotes } =
          keyEventContextRef.current;
        // 모드 삼중 일치에서만 대조 - 비원자 스냅샷·낙관적 모드 전환 방어
        if (
          !payload.currentMode ||
          payload.currentMode !== payload.selectedKeyType ||
          payload.currentMode !== selectedKeyType
        ) {
          return;
        }
        const held = new Set(payload.activeKeys ?? []);
        // fetch 이후 실이벤트가 도착한 키는 그 이벤트가 최신 - 대조에서 제외
        for (const entry of sinceFetch) {
          const sep = entry.indexOf('::');
          if (sep < 0) continue;
          if (entry.slice(0, sep) === payload.currentMode) {
            held.add(entry.slice(sep + 2));
          }
        }
        reconcileActiveNotes(held);
        // 고착된 눌림 하이라이트도 같은 기준으로 정정
        const validKeys = validKeySet(keyMappings[selectedKeyType] ?? []);
        for (const key of validKeys) {
          if (!sinceFetch.has(`${payload.currentMode}::${key}`)) {
            setKeyActiveSignal(key, held.has(key));
          }
        }
      } catch (error) {
        if (!hydrationCancelled) {
          console.error('Failed to reconcile active notes', error);
        }
      } finally {
        if (reconcileSeenRef.current === sinceFetch) {
          reconcileSeenRef.current = null;
        }
      }
    };

    // OBS Lagged/재연결 스냅샷은 유실된 keys:state를 개별 복구하지 못하므로 대조로 정리
    const unsubscribeResync = obsApi.onResync(() => {
      void reconcileWithBootstrap();
    });

    // 키보드 훅 (재)시작 - 이전 눌림 상태가 통째로 무효화되므로 전체 리셋 후 재수화
    const unsubscribeKeysReset = window.api.keys.onKeysReset(() => {
      // 진행 중인 대조의 낡은 스냅샷이 리셋 이후 상태를 덮지 못하게 무효화
      reconcileGenerationRef.current += 1;
      const { finalizeAllActive } = keyEventContextRef.current;
      finalizeAllActive();
      cancelKeyDelayTimers(
        keyDelayTimersRef.current,
        pendingKeyDelayTimersRef.current,
      );
      const seen = new Set<string>();
      seenSinceResetRef.current = seen;
      resetAllKeySignals();
      void window.api.app
        .bootstrap()
        .then(({ activeKeys }) => {
          if (hydrationCancelled || !activeKeys?.length) return;
          if (seenSinceResetRef.current !== seen) return;
          const { keyMappings, selectedKeyType } = keyEventContextRef.current;
          const validKeys = validKeySet(keyMappings[selectedKeyType] ?? []);
          for (const key of activeKeys) {
            if (validKeys.has(key) && !seen.has(key)) {
              setKeyActiveSignal(key, true);
            }
          }
        })
        .catch((error) => {
          if (!hydrationCancelled) {
            console.error('Failed to rehydrate after keys reset', error);
          }
        });
    });

    const keyDelayTimers = keyDelayTimersRef.current;
    const pendingKeyDelayTimers = pendingKeyDelayTimersRef.current;

    return () => {
      hydrationCancelled = true;
      unsubscribeResync();
      unsubscribeKeysReset();
      void unsubscribe
        .then((unsub) => {
          try {
            unsub?.();
          } catch (error) {
            console.error('Failed to remove key state listener', error);
          }
        })
        .catch(() => undefined);
      // 키 딜레이 타이머 정리
      cancelKeyDelayTimers(keyDelayTimers, pendingKeyDelayTimers);
      // 창 단위 정리 - 마운트 1회 구독이므로 여기는 실제 언마운트에서만 실행됨
      resetAllKeySignals();
    };
    // 콜백이 읽는 값은 keyEventContextRef로 공급 - 구독은 창 수명과 동일
  }, []);

  const currentSlots = keyMappings[selectedKeyType] ?? EMPTY_SLICE;
  // 시그널·트랙 키는 canonical, 표시는 합성 라벨 (계약 §3, §11)
  const { currentKeys, currentKeyLabels, currentValidKeySignature } = useMemo(
    () => ({
      currentKeys: currentSlots.map((slot) => slotCanonical(slot)),
      currentKeyLabels: currentSlots.map((slot) => slotDisplayName(slot)),
      currentValidKeySignature: validKeySignature(currentSlots),
    }),
    [currentSlots],
  );

  // 탭·현재 키 집합 전환 시 예약 타이머와 눌림 신호를 권위 상태로 정합
  // positions와 다른 탭의 매핑 변경은 signature가 같아 이 effect를 건드리지 않음
  const keySignalResetArmedRef = useRef(false);
  useEffect(() => {
    if (!keySignalResetArmedRef.current) {
      // 초기 마운트 수화는 구독 effect가 담당
      keySignalResetArmedRef.current = true;
      return;
    }
    // 탭 전환은 진행 중 대조의 스냅샷을 낡게 만든다
    reconcileGenerationRef.current += 1;
    let cancelled = false;
    cancelKeyDelayTimers(
      keyDelayTimersRef.current,
      pendingKeyDelayTimersRef.current,
    );
    const seen = new Set<string>();
    const validKeys = new Set<string>(JSON.parse(currentValidKeySignature));
    seenSinceResetRef.current = seen;
    resetAllKeySignals();
    void Promise.resolve(keyEventsReadyRef.current)
      .then(() => window.api.app.bootstrap())
      .then(({ activeKeys }) => {
        if (cancelled || !activeKeys?.length) return;
        // 이후 전환의 리셋이 끼었으면 그쪽 재수화가 담당
        if (seenSinceResetRef.current !== seen) return;
        for (const key of activeKeys) {
          if (validKeys.has(key) && !seen.has(key)) {
            setKeyActiveSignal(key, true);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to rehydrate active key state', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKeyType, currentValidKeySignature]);

  const currentPositions = positions[selectedKeyType] ?? EMPTY_SLICE;
  const currentStatPositions = statPositions[selectedKeyType] ?? EMPTY_SLICE;
  const currentGraphPositions = graphPositions[selectedKeyType] ?? EMPTY_SLICE;
  const currentKnobPositions = knobPositions[selectedKeyType] ?? EMPTY_SLICE;

  // 레이아웃 입력이 실제로 바뀔 때만 재계산 - webglTracks identity가 안정되어
  // updateTrackLayouts effect·WebGL uniform effect가 무관한 리렌더에 재실행되지 않음
  const {
    bounds,
    displayPositions,
    displayStatPositions,
    displayGraphPositions,
    displayKnobPositions,
    positionOffset,
    topOffset,
    webglTracks,
  } = useMemo(
    () =>
      computeLayout({
        currentKeys,
        currentPositions,
        currentStatPositions,
        currentGraphPositions,
        currentKnobPositions,
        trackHeight,
        noteSettings,
        selectedKeyType,
        pluginElements,
        overlayPadding,
      }),
    [
      currentKeys,
      currentPositions,
      currentStatPositions,
      currentGraphPositions,
      currentKnobPositions,
      trackHeight,
      noteSettings,
      selectedKeyType,
      pluginElements,
      overlayPadding,
    ],
  );

  // 창 크기와 배경 박스가 같은 공식을 공유 (창 == 콘텐츠 박스 불변식)
  // 높이는 computeLayout의 topOffset을 그대로 재사용 - 공식이 한 곳에만 있다
  const contentSize = useMemo(
    () =>
      bounds
        ? {
            width: bounds.maxX - bounds.minX + overlayPadding * 2,
            height: bounds.maxY - bounds.minY + overlayPadding + topOffset,
          }
        : undefined,
    [bounds, overlayPadding, topOffset],
  );

  // updateTrackLayouts는 useNoteSystem이 마운트 1회 고정 참조를 보장하므로
  // deps 포함이 재실행을 유발하지 않으며, 훅이 updater를 교체하는 미래 변경에도 안전
  useEffect(() => {
    updateTrackLayouts(webglTracks);
  }, [webglTracks, updateTrackLayouts]);

  // 이전 resize 값을 추적하여 실제로 변경되었을 때만 resize 호출
  const lastResizeParams = useRef<{
    width: number;
    height: number;
    anchor: string;
    contentTopOffset: number;
    minX: number;
    minY: number;
  } | null>(null);

  useEffect(() => {
    if (!bounds || !contentSize) return;
    // OBS 오버레이에는 네이티브 창이 없다 - allowlist 밖이라 호출이 항상 거부되고,
    // 기준선을 지우는 실패 처리와 맞물려 레이아웃이 바뀔 때마다 헛호출이 반복된다
    if (window.__dmn_runtime === 'obs') return;

    const totalWidth = contentSize.width;
    const totalHeight = contentSize.height;
    // computeLayout이 계산한 값을 그대로 - 같은 공식을 여기서 또 쓰지 않는다
    const contentTopOffset = topOffset;
    const currentMinX = bounds.minX;
    const currentMinY = bounds.minY;

    // 이전 값과 비교하여 실제로 변경되었을 때만 resize 호출
    const lastParams = lastResizeParams.current;
    const fixedPositionAnchor = overlayAnchor === 'fixed-position';
    const fixedPositionDeltaX =
      fixedPositionAnchor && lastParams?.anchor === 'fixed-position'
        ? currentMinX - lastParams.minX
        : 0;
    const fixedPositionDeltaY =
      fixedPositionAnchor && lastParams?.anchor === 'fixed-position'
        ? currentMinY - lastParams.minY
        : 0;
    if (
      lastParams &&
      Math.abs(lastParams.width - totalWidth) < 0.5 &&
      Math.abs(lastParams.height - totalHeight) < 0.5 &&
      lastParams.anchor === overlayAnchor &&
      Math.abs(lastParams.contentTopOffset - contentTopOffset) < 0.5 &&
      (!fixedPositionAnchor ||
        (Math.abs(lastParams.minX - currentMinX) < 0.5 &&
          Math.abs(lastParams.minY - currentMinY) < 0.5))
    ) {
      return; // 변경사항 없음, resize 건너뛰기
    }

    lastResizeParams.current = {
      width: totalWidth,
      height: totalHeight,
      anchor: overlayAnchor,
      contentTopOffset,
      minX: currentMinX,
      minY: currentMinY,
    };

    overlayApi
      .resize({
        width: totalWidth,
        height: totalHeight,
        anchor: overlayAnchor,
        contentTopOffset,
        fixedPositionDeltaX: fixedPositionAnchor
          ? fixedPositionDeltaX
          : undefined,
        fixedPositionDeltaY: fixedPositionAnchor
          ? fixedPositionDeltaY
          : undefined,
      })
      .catch((error) => {
        console.error('Failed to resize overlay window', error);
        // 실패한 요청이 기준선으로 남으면 같은 크기 재시도가 영구히 차단된다
        lastResizeParams.current = null;
      });
  }, [bounds, contentSize, topOffset, overlayAnchor, overlayPadding]);

  return (
    <OverlayScene
      currentKeys={currentKeys}
      currentKeyLabels={currentKeyLabels}
      displayPositions={displayPositions}
      currentPositions={currentPositions}
      displayStatPositions={displayStatPositions}
      displayGraphPositions={displayGraphPositions}
      displayKnobPositions={displayKnobPositions}
      selectedKeyType={selectedKeyType}
      noteEffect={noteEffect}
      contentSize={contentSize}
      contentFade={contentFade}
      noteSettings={noteSettings}
      webglTracks={webglTracks}
      notesRef={notesRef}
      subscribe={subscribe}
      noteBuffer={noteBuffer}
      backgroundColor={backgroundColor}
      keyCounterEnabled={keyCounterEnabled}
      positionOffset={positionOffset}
      onMouseDownCapture={handleOverlayMouseDownCapture}
      showPluginElements={true}
    />
  );
}
