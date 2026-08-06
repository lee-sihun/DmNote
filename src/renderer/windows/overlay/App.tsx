import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  currentMonitor,
  getCurrentWindow,
  Window as TauriWindow,
} from '@tauri-apps/api/window';
import { LogicalPosition, PhysicalPosition } from '@tauri-apps/api/dpi';
import { Menu } from '@tauri-apps/api/menu';
import { useTranslation } from '@contexts/useTranslation';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import { mergeNoteSettings } from '@src/types/settings/noteSettings';
import { useCustomCssInjection } from '@hooks/app/useCustomCssInjection';
import { useCustomJsInjection } from '@hooks/app/useCustomJsInjection';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import { useNoteSystem } from '@hooks/overlay/useNoteSystem';
import { useAppBootstrap } from '@hooks/app/useAppBootstrap';
import { obsApi } from '@api/modules/obsApi';
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
import OverlayScene from '@components/shared/OverlayScene';
import { computeLayout } from '@hooks/shared/useLayoutComputation';
import {
  buildCanonicalIndexMap,
  isSlotAssigned,
  slotCanonical,
  slotDisplayName,
} from '@utils/keySlot';
import type { KeyPosition, KeySlot } from '@src/types/key/keys';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import type { OverlayResizePayload } from '@src/types/plugin/api';

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

// 입력 시각 보정용 age 상한(ms). 백엔드 stall/클럭 이상으로 비정상적으로 큰
// 값이 와도 노트가 화면 위로 튀지 않도록 제한
const MAX_EVENT_AGE_MS = 250;

// 백엔드 상한과 동기 (초과는 OVERLAY_DIMENSION_EXCEEDED로 원자 거부됨)
const MAX_OVERLAY_DIMENSION = 4096;
// 백엔드 최소 크기와 동기 (normalize_overlay_dimensions)
const MIN_OVERLAY_DIMENSION = 100;
// in-flight resize 응답 상한 - 초과 시 낙관 승격으로 큐 봉쇄 해제
const RESIZE_INFLIGHT_TIMEOUT_MS = 5000;

// 백엔드 정규화 규칙과 동일 (min 100, round, max 4096 포화)
// dispatch payload와 no-op 비교가 같은 값을 쓰도록 프론트에서 선적용
const normalizeOverlayDimension = (value: number): number =>
  Math.min(
    MAX_OVERLAY_DIMENSION,
    Math.round(Math.max(MIN_OVERLAY_DIMENSION, value)),
  );

// 마지막 발급 세션 보존 키 - 시계 역행 시 단조성 보장용
const OVERLAY_RESIZE_SESSION_STORAGE_KEY = 'dmn.overlayResizeSession';

// 렌더러 세션 ID (모듈 로드 시 1회) - 시각 순서 인코딩: 상위 Date.now(),
// 하위 12비트 난수(동시 로드 충돌 회피). 백엔드는 더 큰 세션만 채택하므로
// 나중에 로드된 렌더러(리로드·OBS 새로고침)가 항상 우선하고, 구 세션의
// 지연 요청은 오채택되지 않음. Date.now()*2^12 + 12비트는 2^53 안전 정수
// 범위 내 (2039년경까지 여유).
// 시스템 시계가 뒤로 조정되면 새 렌더러 세션이 이전보다 작아져 백엔드가
// 영구 stale 처리하므로, 마지막 발급값을 localStorage에 보존해
// max(시각 기반, 저장값 + 1)로 단조성을 보장하고 발급 후 저장을 갱신
const OVERLAY_RESIZE_SESSION = (() => {
  const words = new Uint32Array(1);
  crypto.getRandomValues(words);
  const timeBased = Date.now() * 0x1000 + (words[0] & 0xfff);
  try {
    const stored = Number(
      window.localStorage.getItem(OVERLAY_RESIZE_SESSION_STORAGE_KEY),
    );
    const session = Number.isSafeInteger(stored)
      ? Math.max(timeBased, stored + 1)
      : timeBased;
    window.localStorage.setItem(
      OVERLAY_RESIZE_SESSION_STORAGE_KEY,
      String(session),
    );
    return session;
  } catch {
    // localStorage 불가 환경(샌드박스 임베드 등)은 시각 기반 폴백
    return timeBased;
  }
})();

// 폴백 배열 identity 안정화 (메모 체인 무효화 방지)
const EMPTY_POSITIONS: KeyPosition[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMPTY_ITEMS: any[] = [];

interface OverlayResizeParams {
  width: number;
  height: number;
  anchor: string;
  contentTopOffset: number;
  contentMargins: { top: number; bottom: number; left: number; right: number };
  minX: number;
  minY: number;
}

// 지오메트리 트랜잭션 단위 (계약 §4 AppliedGeometrySnapshot)
interface OverlayGeometrySnapshot {
  layout: ReturnType<typeof computeLayout>;
  currentKeys: string[];
  currentKeyLabels: string[];
  currentPositions: KeyPosition[];
  selectedKeyType: string;
  noteSettings: NoteSettings;
  trackHeight: number;
  // 활성 노트 정리 판정용 트랙별 유효 방향 (trackKey → direction)
  trackDirections: Map<string, string>;
  resizeParams: OverlayResizeParams | null;
}

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;

// 비유한 지오메트리 방어 - native 호출 전 전 필드 검사
const resizeParamsAreFinite = (params: OverlayResizeParams): boolean =>
  Number.isFinite(params.width) &&
  Number.isFinite(params.height) &&
  Number.isFinite(params.contentTopOffset) &&
  Number.isFinite(params.contentMargins.top) &&
  Number.isFinite(params.contentMargins.bottom) &&
  Number.isFinite(params.contentMargins.left) &&
  Number.isFinite(params.contentMargins.right) &&
  Number.isFinite(params.minX) &&
  Number.isFinite(params.minY);

const resizeParamsEqual = (
  a: OverlayResizeParams,
  b: OverlayResizeParams,
): boolean =>
  nearlyEqual(a.width, b.width) &&
  nearlyEqual(a.height, b.height) &&
  a.anchor === b.anchor &&
  nearlyEqual(a.contentMargins.top, b.contentMargins.top) &&
  nearlyEqual(a.contentMargins.bottom, b.contentMargins.bottom) &&
  nearlyEqual(a.contentMargins.left, b.contentMargins.left) &&
  nearlyEqual(a.contentMargins.right, b.contentMargins.right) &&
  // contentMin 기준점은 백엔드 프로토콜 상태 - 앵커와 무관하게 원점 변경 시
  // 항상 발행해 동기화 (stale 기준점은 fixed-position 전환 시 창 이동 유발)
  nearlyEqual(a.minX, b.minX) &&
  nearlyEqual(a.minY, b.minY);

// 계약 §4 오류 wire: { errorCode, details, retryable }
const isOverlayDimensionExceeded = (
  error: unknown,
): error is {
  errorCode: 'OVERLAY_DIMENSION_EXCEEDED';
  details: Record<string, number>;
} =>
  typeof error === 'object' &&
  error !== null &&
  (error as { errorCode?: unknown }).errorCode === 'OVERLAY_DIMENSION_EXCEEDED';

// 부분 적용 확정 wire: 크기는 적용됐고 위치 롤백까지 실패한 상태 (계약 §4 R5)
const isOverlayResizePartial = (
  error: unknown,
): error is {
  errorCode: 'OVERLAY_RESIZE_PARTIAL';
  details: {
    requestGen?: number;
    appliedBounds: { x: number; y: number; width: number; height: number };
  };
} =>
  typeof error === 'object' &&
  error !== null &&
  (error as { errorCode?: unknown }).errorCode === 'OVERLAY_RESIZE_PARTIAL' &&
  typeof (error as { details?: { appliedBounds?: unknown } }).details
    ?.appliedBounds === 'object';

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
  const pluginElements = usePluginDisplayElementStore(
    (state) => state.elements,
  );

  const backgroundColor = useSettingsStore((state) => state.backgroundColor);
  const alwaysOnTop = useSettingsStore((state) => state.alwaysOnTop);
  const trayEnabled = useSettingsStore((state) => state.trayEnabled);
  const setAlwaysOnTop = useSettingsStore((state) => state.setAlwaysOnTop);
  const globalNoteSettings = useSettingsStore((state) => state.noteSettings);
  const tabNoteOverrides = useSettingsStore((state) => state.tabNoteOverrides);
  const noteSettings = useMemo(
    () =>
      mergeNoteSettings(
        globalNoteSettings,
        tabNoteOverrides?.[selectedKeyType],
      ),
    [globalNoteSettings, tabNoteOverrides, selectedKeyType],
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
      await window.api.overlay.setVisible(false);
    } catch (error) {
      console.error('Failed to close overlay window', error);
    }
  };

  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      await window.api.settings.update({ alwaysOnTop: next });
    } catch (error) {
      console.error('Failed to toggle always-on-top', error);
      setAlwaysOnTop(!next);
    }
  };

  const openSettingsWindow = async () => {
    try {
      await window.api.window.showMain();
    } catch (error) {
      console.error('Failed to open settings window', error);
    }
  };

  const quitApplication = async () => {
    try {
      await window.api.app.quit();
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

      const newX = snapLeft
        ? monitorPos.x
        : monitorPos.x + monitorSize.width - size.width;
      const newY = snapTop
        ? monitorPos.y
        : monitorPos.y + monitorSize.height - size.height;

      await win.setPosition(new PhysicalPosition(newX, newY));
    } catch (error) {
      console.error('Failed to snap overlay to edge', error);
    }
  };

  const openOverlayContextMenuAtImpl = useRef<
    (x: number, y: number) => Promise<void>
  >(async () => {});
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
    await openOverlayContextMenuAtImpl.current(x, y);
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
    clearAllNotes,
    noteBuffer,
    updateTrackLayouts,
  } = useNoteSystem({
    noteEffect,
    noteSettings,
  });

  const trackHeight =
    noteSettings?.trackHeight ?? DEFAULT_NOTE_SETTINGS.trackHeight;

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

  // 키 활성 상태는 signals로 관리하여 App 리렌더를 방지
  const [_layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    const onResize = () => setLayoutVersion((value) => value + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setLayoutVersion((value) => value + 1);
  }, [trackHeight]);

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

  const currentSlots = useMemo(
    () => keyMappings[selectedKeyType] ?? [],
    [keyMappings, selectedKeyType],
  );
  // 시그널·트랙 키는 canonical, 표시는 합성 라벨 (계약 §3, §11)
  const currentKeys = useMemo(
    () => currentSlots.map((slot) => slotCanonical(slot)),
    [currentSlots],
  );
  const currentKeyLabels = useMemo(
    () => currentSlots.map((slot) => slotDisplayName(slot)),
    [currentSlots],
  );
  const currentValidKeySignature = validKeySignature(currentSlots);

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

  const currentPositions = positions[selectedKeyType] ?? EMPTY_POSITIONS;
  const currentStatPositions = statPositions[selectedKeyType] ?? EMPTY_ITEMS;
  const currentGraphPositions = graphPositions[selectedKeyType] ?? EMPTY_ITEMS;
  const currentKnobPositions = knobPositions[selectedKeyType] ?? EMPTY_ITEMS;

  const layout = useMemo(
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

  // candidate 지오메트리 스냅샷 (계약 §4: resize 성공 후에만 applied로 승격)
  const candidate = useMemo<OverlayGeometrySnapshot>(() => {
    const { bounds, margins, webglTracks } = layout;
    let resizeParams: OverlayResizeParams | null = null;
    if (bounds) {
      const keyAreaWidth = bounds.maxX - bounds.minX;
      const keyAreaHeight = bounds.maxY - bounds.minY;
      resizeParams = {
        width: keyAreaWidth + overlayPadding * 2 + margins.left + margins.right,
        height:
          keyAreaHeight + overlayPadding * 2 + margins.top + margins.bottom,
        anchor: overlayAnchor,
        contentTopOffset: margins.top + overlayPadding,
        contentMargins: {
          top: margins.top + overlayPadding,
          bottom: margins.bottom + overlayPadding,
          left: margins.left + overlayPadding,
          right: margins.right + overlayPadding,
        },
        minX: bounds.minX,
        minY: bounds.minY,
      };
    }
    const trackDirections = new Map<string, string>();
    for (const track of webglTracks) {
      if (track) trackDirections.set(track.trackKey, track.direction);
    }
    return {
      layout,
      currentKeys,
      currentKeyLabels,
      currentPositions,
      selectedKeyType,
      noteSettings,
      trackHeight,
      trackDirections,
      resizeParams,
    };
  }, [
    layout,
    overlayAnchor,
    overlayPadding,
    currentKeys,
    currentKeyLabels,
    currentPositions,
    selectedKeyType,
    noteSettings,
    trackHeight,
  ]);

  const [applied, setApplied] = useState<OverlayGeometrySnapshot | null>(null);
  // 최신 candidate의 정규화 params - 화해 루프의 목표 (창이 수렴해야 할 의도)
  const desiredParamsRef = useRef<OverlayResizeParams | null>(null);
  // 마지막으로 발행한 정규화 params - no-op 판정의 유일 기준 (master의
  // lastResizeParams 의미론). 실패·타임아웃 시 무효화 - 멱등 프로토콜이라
  // 동일 params 재발행이 안전
  const lastSentParamsRef = useRef<OverlayResizeParams | null>(null);
  // single-flight IPC 직렬화 - 진행 중 gen (렌더와는 무관)
  const inFlightGenRef = useRef<number | null>(null);
  const queuedParamsRef = useRef<OverlayResizeParams | null>(null);
  // single-flight라 타이머도 최대 1개 - 언마운트 시 정리
  const inFlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 디스패치 gen - payload requestGen으로 전송돼 확인 이벤트에 에코됨
  const requestGenRef = useRef(0);
  // 수신한 확인 이벤트의 최고 gen - 순서 어긋난 낡은 이벤트 무시
  const maxEventGenRef = useRef(0);
  // 마지막 확인 이벤트의 실측 크기 - in-flight 중 도착분은 settle에서 화해
  const lastEventDimsRef = useRef<{ width: number; height: number } | null>(
    null,
  );
  // 이벤트 화해 보정의 연속 발행 카운터 - 목표 달성·새 의도 발행에서 리셋
  const eventReconcileCountRef = useRef(0);
  // resized 이벤트 구독(마운트 수명)이 최신 effect의 로직을 쓰기 위한 간접 참조
  const handleResizedRef = useRef<(payload: OverlayResizePayload) => void>(
    () => {},
  );

  useEffect(
    () => () => {
      if (inFlightTimerRef.current !== null) {
        clearTimeout(inFlightTimerRef.current);
        inFlightTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const clearInFlightTimer = () => {
      if (inFlightTimerRef.current !== null) {
        clearTimeout(inFlightTimerRef.current);
        inFlightTimerRef.current = null;
      }
    };

    // 단일 화해: 마지막 확인 이벤트의 실측 크기가 목표(최신 candidate)와 다르면
    // 목표를 재발행 (연속 최대 1회, 무한 루프 방지). 위치는 contentMin 멱등으로
    // 백엔드가 담당하므로 크기만 비교. 부분 적용·롤백·응답 유실 전부 여기로 수렴
    const maybeReconcile = () => {
      const target = desiredParamsRef.current;
      const seen = lastEventDimsRef.current;
      if (!target || !seen) return;
      if (inFlightGenRef.current !== null) return;
      if (
        nearlyEqual(seen.width, target.width) &&
        nearlyEqual(seen.height, target.height)
      ) {
        // 목표 달성 확인 - 보정 카운터 리셋
        eventReconcileCountRef.current = 0;
        return;
      }
      if (eventReconcileCountRef.current >= 1) return;
      dispatch(target, true);
    };

    const settle = () => {
      inFlightGenRef.current = null;
      const next = queuedParamsRef.current;
      queuedParamsRef.current = null;
      const lastSent = lastSentParamsRef.current;
      if (next && !(lastSent && resizeParamsEqual(lastSent, next))) {
        dispatch(next, false);
        return;
      }
      // in-flight 동안 도착한 확인 이벤트의 불일치를 뒤늦게 화해
      maybeReconcile();
    };

    // isReconcile: 이벤트 화해 보정 발행 여부 (연속 1회 제한 카운터 관리)
    const dispatch = (
      dispatchParams: OverlayResizeParams,
      isReconcile: boolean,
    ) => {
      eventReconcileCountRef.current = isReconcile
        ? eventReconcileCountRef.current + 1
        : 0;
      const gen = ++requestGenRef.current;
      // master 의미론: 발행 시점에 기록
      lastSentParamsRef.current = dispatchParams;
      inFlightGenRef.current = gen;
      // 응답 없는 IPC가 큐를 영구 봉쇄하지 않도록 타임아웃 시 in-flight 해제
      inFlightTimerRef.current = setTimeout(() => {
        if (inFlightGenRef.current !== gen) return;
        inFlightTimerRef.current = null;
        console.warn('Overlay resize timed out; releasing in-flight slot');
        // 결과 모호 - 멱등이라 동일 params 재발행이 안전하므로 무효화
        lastSentParamsRef.current = null;
        settle();
      }, RESIZE_INFLIGHT_TIMEOUT_MS);
      window.api.overlay
        .resize({
          width: dispatchParams.width,
          height: dispatchParams.height,
          anchor: dispatchParams.anchor,
          contentTopOffset: dispatchParams.contentTopOffset,
          contentMargins: dispatchParams.contentMargins,
          requestGen: gen,
          requestSession: OVERLAY_RESIZE_SESSION,
          // fixed-position 위치는 백엔드가 저장 기준점과 비교해 멱등 계산
          // (같은 요청 재수신 = delta 0). 다른 앵커에는 무해
          contentMin: { x: dispatchParams.minX, y: dispatchParams.minY },
        })
        .then(() => {
          if (inFlightGenRef.current === gen) {
            clearInFlightTimer();
            settle();
          }
        })
        .catch((error) => {
          if (isOverlayResizePartial(error)) {
            // 부분 적용 - 실측 이벤트가 화해 루프로 수렴시킴
            console.warn('Overlay resize partially applied', error.details);
          } else if (isOverlayDimensionExceeded(error)) {
            // 백엔드 원자 거부는 안전망 - 렌더러 포화로 정상 경로에선 도달하지 않음
            console.warn(
              'Overlay resize rejected: dimension exceeded',
              error.details,
            );
          } else {
            // 창 미존재(OBS 페이지·오버레이 숨김 등)·전송 실패
            console.error('Failed to resize overlay window', error);
          }
          // 마지막 발행 요청의 실패는 확정이든 모호든 무효화 - 멱등이라
          // 다음 candidate(동일 params 포함)가 무조건 재발행 (R7-3)
          if (requestGenRef.current === gen) {
            lastSentParamsRef.current = null;
          }
          if (inFlightGenRef.current === gen) {
            clearInFlightTimer();
            settle();
          }
        });
    };

    const requestResize = (params: OverlayResizeParams | null) => {
      // 콘텐츠 없음: 창 조작 불필요
      if (!params) {
        desiredParamsRef.current = null;
        return;
      }
      // 비유한 지오메트리는 native 호출 생략 (렌더는 이미 승격됨)
      if (!resizeParamsAreFinite(params)) {
        console.warn(
          'Overlay resize skipped: non-finite geometry; rendering without window resize',
          params,
        );
        desiredParamsRef.current = null;
        return;
      }
      // 상한 초과는 거부 대신 포화(saturate), min·round는 백엔드 정규화와 동일
      const width = normalizeOverlayDimension(params.width);
      const height = normalizeOverlayDimension(params.height);
      if (
        params.width > MAX_OVERLAY_DIMENSION ||
        params.height > MAX_OVERLAY_DIMENSION
      ) {
        console.warn(
          `Overlay dimension exceeds limit (${params.width}x${params.height} > ${MAX_OVERLAY_DIMENSION}); saturating window size`,
        );
      }
      const dispatchParams: OverlayResizeParams = { ...params, width, height };
      desiredParamsRef.current = dispatchParams;
      // in-flight 중에는 최신 대기 슬롯에만 저장 (settle에서 재평가)
      if (inFlightGenRef.current !== null) {
        queuedParamsRef.current = dispatchParams;
        return;
      }
      // no-op: 마지막 발행 값과 같으면 생략 - 다르면 무조건 발행
      const lastSent = lastSentParamsRef.current;
      if (lastSent && resizeParamsEqual(lastSent, dispatchParams)) return;
      dispatch(dispatchParams, false);
    };

    // 확인 이벤트 수신: 모든 native 접촉 exit(성공·롤백·partial)에서 발행되는
    // 실측이 유일한 진실 - 기록 후 화해 평가 (in-flight 중이면 settle에서)
    handleResizedRef.current = (payload) => {
      const gen = payload.requestGen;
      if (typeof gen === 'number') {
        // 순서 어긋난 낡은 확인 무시
        if (gen < maxEventGenRef.current) return;
        maxEventGenRef.current = gen;
      }
      lastEventDimsRef.current = {
        width: payload.width,
        height: payload.height,
      };
      maybeReconcile();
    };

    // 렌더는 항상 즉시 승격 - 창은 비동기로 목표에 수렴 (master 의미론)
    setApplied(candidate);
    requestResize(candidate.resizeParams);
  }, [candidate]);

  // 백엔드 실적용 브로드캐스트 구독 (마운트 수명) - 처리는 최신 effect의
  // 화해 루프로 위임
  useEffect(() => {
    const unsubscribe = window.api.overlay.onResized((payload) => {
      handleResizedRef.current(payload);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (applied) updateTrackLayouts(applied.layout.webglTracks);
  }, [applied, updateTrackLayouts]);

  // 유효 방향 전환 시 활성 노트 정리 (계약 §7, 첫 마운트 제외)
  // 스냅샷 좌표가 새 좌표계와 어긋나는 아티팩트 방지 - 양쪽에 존재하는 트랙의
  // 방향이 실제로 바뀐 경우에만 정리 (키 추가·삭제·탭 전환은 자연 퇴장 유지)
  const lastTrackDirectionsRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!applied) return;
    const current = applied.trackDirections;
    const previous = lastTrackDirectionsRef.current;
    if (previous) {
      for (const [trackKey, direction] of current) {
        const previousDirection = previous.get(trackKey);
        if (
          previousDirection !== undefined &&
          previousDirection !== direction
        ) {
          clearAllNotes();
          break;
        }
      }
    }
    lastTrackDirectionsRef.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  // 모든 지오메트리 소비자는 같은 applied generation만 소비 (계약 §4)
  if (!applied) return null;

  return (
    <OverlayScene
      currentKeys={applied.currentKeys}
      currentKeyLabels={applied.currentKeyLabels}
      displayPositions={applied.layout.displayPositions}
      currentPositions={applied.currentPositions}
      displayStatPositions={applied.layout.displayStatPositions}
      displayGraphPositions={applied.layout.displayGraphPositions}
      displayKnobPositions={applied.layout.displayKnobPositions}
      selectedKeyType={applied.selectedKeyType}
      noteEffect={noteEffect}
      noteSettings={applied.noteSettings}
      webglTracks={applied.layout.webglTracks}
      notesRef={notesRef}
      subscribe={subscribe}
      noteBuffer={noteBuffer}
      backgroundColor={backgroundColor}
      keyCounterEnabled={keyCounterEnabled}
      positionOffset={applied.layout.positionOffset}
      onMouseDownCapture={handleOverlayMouseDownCapture}
      showPluginElements={true}
    />
  );
}
