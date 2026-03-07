import React, { Suspense, lazy, useEffect, useState, useRef } from 'react';
import {
  currentMonitor,
  getCurrentWindow,
  Window as TauriWindow,
} from '@tauri-apps/api/window';
import { LogicalPosition, PhysicalPosition } from '@tauri-apps/api/dpi';
import { Menu } from '@tauri-apps/api/menu';
import { isMac } from '@utils/core/platform';
import { Key } from '@components/shared/Key';
import { useTranslation } from '@contexts/useTranslation';
import {
  DEFAULT_NOTE_BORDER_RADIUS,
  DEFAULT_NOTE_SETTINGS,
} from '@constants/overlayDefaults';
import { mergeNoteSettings } from '@src/types/settings/noteSettings';
import { useCustomCssInjection } from '@hooks/app/useCustomCssInjection';
import { useCustomJsInjection } from '@hooks/app/useCustomJsInjection';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import { useNoteSystem } from '@hooks/overlay/useNoteSystem';
import { useAppBootstrap } from '@hooks/app/useAppBootstrap';
import { useBuiltinStatsSubscription } from '@hooks/overlay/useBuiltinStatsSubscription';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import {
  setKeyActive as setKeyActiveSignal,
  resetAllKeySignals,
} from '@stores/signals/keySignals';
import { useSettingsStore } from '@stores/useSettingsStore';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import {
  createDefaultCounterSettings,
  type KeyPosition,
} from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import KeyCounterLayer from '@components/overlay/counters/KeyCounterLayer';
import { PluginElementsRenderer } from '@components/shared/PluginElementsRenderer';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import StatItem from '@components/overlay/counters/StatItem';
import StatCounterLayer from '@components/overlay/counters/StatCounterLayer';
import OverlayGraphItemBase from '@components/overlay/counters/OverlayGraphItem';

const FALLBACK_POSITION: KeyPosition = {
  dx: 0,
  dy: 0,
  width: 60,
  height: 60,
  hidden: false,
  activeImage: '',
  inactiveImage: '',
  activeTransparent: false,
  idleTransparent: false,
  count: 0,
  noteColor: '#FFFFFF',
  noteOpacity: 80,
  noteEffectEnabled: true,
  noteGlowEnabled: false,
  noteGlowSize: 20,
  noteGlowOpacity: 70,
  noteGlowColor: '#FFFFFF',
  noteAutoYCorrection: true,
  className: '',
  counter: createDefaultCounterSettings(),
};

const PADDING = 30;

interface OverlayKeyProps {
  keyName: string;
  globalKey: string;
  position: KeyPosition;
  mode?: string;
  counterEnabled?: boolean;
}

interface OverlayStatItemProps {
  statType: string;
  label?: string;
  position: Record<string, unknown>;
  counterEnabled?: boolean;
}

interface OverlayStatCounterLayerProps {
  positions: Record<string, unknown>[];
}

interface OverlayGraphItemProps {
  index?: number;
  position: Record<string, unknown>;
}

const OverlayKey = Key as React.ComponentType<OverlayKeyProps>;
const OverlayStatItem =
  StatItem as unknown as React.ComponentType<OverlayStatItemProps>;
const OverlayStatCounterLayer =
  StatCounterLayer as unknown as React.ComponentType<OverlayStatCounterLayerProps>;
const OverlayGraphItem =
  OverlayGraphItemBase as React.ComponentType<OverlayGraphItemProps>;

// Tracks 레이지 로딩
const Tracks = lazy(async () => {
  const mod = await import('@components/overlay/WebGLTracksOGL.jsx');
  return {
    default: mod.WebGLTracksOGL as unknown as React.ComponentType<
      Record<string, unknown>
    >,
  };
});

type KeyDelayTimerEntry = { timers: Set<ReturnType<typeof setTimeout>> };

export default function App() {
  useCustomCssInjection();
  useCustomJsInjection();
  useAppBootstrap();
  useBuiltinStatsSubscription();
  useBlockBrowserShortcuts();
  const { t } = useTranslation();
  const macOS = isMac();
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

  // 메인에서 bridge를 통한 positions 동기화 수신
  useEffect(() => {
    const unsubscribe = window.api.bridge.on<{
      positions: Record<string, KeyPosition[]>;
    }>('positions:sync', (data) => {
      if (data?.positions) {
        useKeyStore.setState((state) => ({
          ...state,
          positions: data.positions,
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  // 메인에서 bridge를 통한 statPositions 동기화 수신
  useEffect(() => {
    const unsubscribe = window.api.bridge.on<{
      positions: Record<string, StatItemPosition[]>;
    }>('statPositions:sync', (data) => {
      if (data?.positions) {
        useStatItemStore.setState((state) => ({
          ...state,
          positions: data.positions,
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  // 메인에서 bridge를 통한 graphPositions 동기화 수신
  useEffect(() => {
    const unsubscribe = window.api.bridge.on<{
      positions: Record<string, GraphItemPosition[]>;
    }>('graphPositions:sync', (data) => {
      if (data?.positions) {
        useGraphItemStore.setState((state) => ({
          ...state,
          positions: data.positions,
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const positions = useKeyStore((state) => state.positions);
  const statPositions = useStatItemStore((state) => state.positions);
  const graphPositions = useGraphItemStore((state) => state.positions);
  const pluginElements = usePluginDisplayElementStore(
    (state) => state.elements,
  );

  const backgroundColor = useSettingsStore((state) => state.backgroundColor);
  const alwaysOnTop = useSettingsStore((state) => state.alwaysOnTop);
  const trayEnabled = useSettingsStore((state) => state.trayEnabled);
  const setAlwaysOnTop = useSettingsStore((state) => state.setAlwaysOnTop);
  const globalNoteSettings = useSettingsStore((state) => state.noteSettings);
  const tabNoteOverrides = useSettingsStore((state) => state.tabNoteOverrides);
  const noteSettings = mergeNoteSettings(
    globalNoteSettings,
    tabNoteOverrides?.[selectedKeyType],
  );
  const noteEffect = useSettingsStore((state) => state.noteEffect);
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

  // 키 딜레이 값을 ref로 관리하여 클로저 문제 방지
  const keyDisplayDelayMsRef = useRef(keyDisplayDelayMs);
  useEffect(() => {
    keyDisplayDelayMsRef.current = keyDisplayDelayMs;
  }, [keyDisplayDelayMs]);

  // 키 딜레이 타이머 관리 (down/up 별도 관리)
  const keyDelayTimersRef = useRef<Map<string, KeyDelayTimerEntry>>(new Map());

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

  useEffect(() => {
    // 키 딜레이 적용된 신호 업데이트
    const updateKeySignalWithDelay = (key: string, isDown: boolean) => {
      const delayMs = keyDisplayDelayMsRef.current;

      let timerEntry = keyDelayTimersRef.current.get(key);
      if (!timerEntry) {
        timerEntry = { timers: new Set() };
        keyDelayTimersRef.current.set(key, timerEntry);
      }

      if (delayMs <= 0) {
        timerEntry.timers.forEach((timer) => clearTimeout(timer));
        timerEntry.timers.clear();
        setKeyActiveSignal(key, isDown);
        return;
      }

      const timer = setTimeout(() => {
        setKeyActiveSignal(key, isDown);
        timerEntry?.timers.delete(timer);
      }, delayMs);
      timerEntry.timers.add(timer);
    };

    // 키 이벤트 버스 초기화 (백엔드에서 한 번만 구독)
    import('@utils/core/keyEventBus').then(({ keyEventBus }) => {
      keyEventBus.initialize();
    });

    // 버스를 통해 키 이벤트 수신
    const unsubscribe = import('@utils/core/keyEventBus').then(
      ({ keyEventBus }) => {
        return keyEventBus.subscribe(({ key, state }) => {
          const isDown = state === 'DOWN';
          // 키 UI 업데이트 (딜레이 적용)
          updateKeySignalWithDelay(key, isDown);
          // 노트 이펙트는 즉시 처리 (딜레이 없음)
          if (noteEffect) {
            // 개별 키의 noteEffectEnabled 확인
            const currentKeys = keyMappings[selectedKeyType] ?? [];
            const currentPositions = positions[selectedKeyType] ?? [];
            const keyIndex = currentKeys.indexOf(key);
            const keyPosition = currentPositions[keyIndex];
            const keyNoteEffectEnabled =
              keyPosition?.noteEffectEnabled !== false;

            if (keyNoteEffectEnabled) {
              requestAnimationFrame(() => {
                if (isDown) handleKeyDown(key);
                else handleKeyUp(key);
              });
            }
          }
        });
      },
    );

    const keyDelayTimers = keyDelayTimersRef.current;

    return () => {
      unsubscribe.then((unsub) => {
        try {
          unsub?.();
        } catch (error) {
          console.error('Failed to remove key state listener', error);
        }
      });
      // 키 딜레이 타이머 정리
      keyDelayTimers.forEach((timerEntry) => {
        timerEntry.timers.forEach((timer) => clearTimeout(timer));
        timerEntry.timers.clear();
      });
      keyDelayTimers.clear();
      // 안전하게 모든 키 신호 초기화(선택적)
      resetAllKeySignals();
    };
  }, [
    handleKeyDown,
    handleKeyUp,
    noteEffect,
    keyMappings,
    positions,
    selectedKeyType,
  ]);

  const currentKeys = keyMappings[selectedKeyType] ?? [];

  const currentPositions = positions[selectedKeyType] ?? [];

  const currentStatPositions = statPositions[selectedKeyType] ?? [];

  const currentGraphPositions = graphPositions[selectedKeyType] ?? [];

  const bounds = (() => {
    if (
      !currentPositions.length &&
      !currentStatPositions.length &&
      !currentGraphPositions.length &&
      !pluginElements.length
    )
      return null;

    const xs: number[] = [];
    const ys: number[] = [];
    const widths: number[] = [];
    const heights: number[] = [];

    // 키 위치
    currentPositions.forEach((pos) => {
      if (pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + pos.width);
      heights.push(pos.dy + pos.height);
    });

    // 통계 요소 위치
    currentStatPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 60));
      heights.push(pos.dy + (pos.height ?? 60));
    });

    // 그래프 요소 위치
    currentGraphPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 200));
      heights.push(pos.dy + (pos.height ?? 100));
    });

    // 플러그인 요소 위치 (앵커 기반 계산 포함)
    pluginElements
      .filter((el) => !el.hidden && (!el.tabId || el.tabId === selectedKeyType))
      .forEach((element) => {
        let x = element.position.x;
        let y = element.position.y;

        // 앵커 기반 위치 계산
        if (element.anchor?.keyCode && selectedKeyType) {
          const keyIndex = currentKeys.findIndex(
            (key) => key === element.anchor?.keyCode,
          );
          if (keyIndex >= 0 && currentPositions[keyIndex]) {
            const keyPosition = currentPositions[keyIndex];
            const offsetX = element.anchor.offset?.x ?? 0;
            const offsetY = element.anchor.offset?.y ?? 0;
            x = keyPosition.dx + offsetX;
            y = keyPosition.dy + offsetY;
          }
        }

        // 실제 측정된 크기 또는 추정 크기 사용
        const width =
          element.measuredSize?.width ?? element.estimatedSize?.width ?? 200;
        const height =
          element.measuredSize?.height ?? element.estimatedSize?.height ?? 150;

        xs.push(x);
        ys.push(y);
        widths.push(x + width);
        heights.push(y + height);
      });

    if (xs.length === 0) return null;

    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...widths),
      maxY: Math.max(...heights),
    };
  })();

  const displayPositions = (() => {
    if (!bounds || !currentPositions.length) {
      return currentPositions;
    }

    const topOffset = trackHeight + PADDING;
    const offsetX = PADDING - bounds.minX;
    const offsetY = topOffset - bounds.minY;

    return currentPositions.map((position) => ({
      ...position,
      dx: position.dx + offsetX,
      dy: position.dy + offsetY,
    }));
  })();

  const displayStatPositions = (() => {
    if (!bounds || !currentStatPositions.length) {
      return currentStatPositions;
    }

    const topOffset = trackHeight + PADDING;
    const offsetX = PADDING - bounds.minX;
    const offsetY = topOffset - bounds.minY;

    return currentStatPositions.map((position) => ({
      ...position,
      dx: position.dx + offsetX,
      dy: position.dy + offsetY,
    }));
  })();

  const displayGraphPositions = (() => {
    if (!bounds || !currentGraphPositions.length) {
      return currentGraphPositions;
    }

    const topOffset = trackHeight + PADDING;
    const offsetX = PADDING - bounds.minX;
    const offsetY = topOffset - bounds.minY;

    return currentGraphPositions.map((position) => ({
      ...position,
      dx: position.dx + offsetX,
      dy: position.dy + offsetY,
    }));
  })();

  // 오버레이의 위치 오프셋 계산
  const positionOffset = (() => {
    if (!bounds) return { x: 0, y: 0 };
    const topOffset = trackHeight + PADDING;
    return {
      x: PADDING - bounds.minX,
      y: topOffset - bounds.minY,
    };
  })();

  // 키+통계+그래프+플러그인 모두 포함한 최상단 Y (bounds 기반)
  const topMostY = bounds ? trackHeight + PADDING : 0;

  const webglTracks = currentKeys
    .map((key, index) => {
      const originalPosition = currentPositions[index] ?? FALLBACK_POSITION;
      if (originalPosition.hidden) return null;
      const position = displayPositions[index] ?? originalPosition;
      // noteAutoYCorrection이 false면 원래 위치 사용, 아니면 topMostY로 보정
      const useAutoCorrection = position.noteAutoYCorrection !== false;
      const trackStartY = useAutoCorrection ? topMostY : position.dy;
      const keyWidth = position.width;
      const desiredNoteWidth =
        typeof position.noteWidth === 'number' &&
        Number.isFinite(position.noteWidth)
          ? Math.max(1, Math.round(position.noteWidth))
          : keyWidth;
      const noteOffsetX = (keyWidth - desiredNoteWidth) / 2;

      return {
        trackKey: key,
        trackIndex: position.zIndex ?? index,
        position: {
          ...position,
          dx: position.dx + noteOffsetX,
          dy: trackStartY,
        },
        width: desiredNoteWidth,
        height: trackHeight,
        noteColor: position.noteColor,
        noteOpacity: position.noteOpacity,
        noteOpacityTop: position.noteOpacityTop ?? position.noteOpacity,
        noteOpacityBottom: position.noteOpacityBottom ?? position.noteOpacity,
        noteGlowEnabled: position.noteGlowEnabled ?? false,
        noteGlowSize: position.noteGlowSize ?? 20,
        noteGlowOpacity: position.noteGlowOpacity ?? 70,
        noteGlowOpacityTop:
          position.noteGlowOpacityTop ?? position.noteGlowOpacity ?? 70,
        noteGlowOpacityBottom:
          position.noteGlowOpacityBottom ?? position.noteGlowOpacity ?? 70,
        noteGlowColor: position.noteGlowColor ?? position.noteColor,
        flowSpeed: noteSettings?.speed ?? DEFAULT_NOTE_SETTINGS.speed,
        borderRadius: position.noteBorderRadius ?? DEFAULT_NOTE_BORDER_RADIUS,
      };
    })
    .filter(Boolean);

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
    if (!bounds) return;

    const keyAreaWidth = bounds.maxX - bounds.minX;
    const keyAreaHeight = bounds.maxY - bounds.minY;
    const extraTop = trackHeight;
    const totalWidth = keyAreaWidth + PADDING * 2;
    const totalHeight = keyAreaHeight + PADDING * 2 + extraTop;
    const contentTopOffset = extraTop + PADDING;
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

    window.api.overlay
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
      });
  }, [bounds, trackHeight, overlayAnchor]);

  return (
    <div
      className="relative w-full h-screen m-0 overflow-hidden"
      style={{
        backgroundColor:
          backgroundColor === 'transparent' ? 'transparent' : backgroundColor,
        ...(macOS
          ? {
              // macOS(WebKit)에서 투명 전환 시 'contents' will-change + 강한 contain 조합이
              // 레이어 재구성을 유발해 반영이 늦어지는 케이스가 있어 완화.
              willChange: 'background-color',
            }
          : {
              willChange: 'contents',
              contain: 'layout style paint',
            }),
      }}
      onMouseDownCapture={handleOverlayMouseDownCapture}
    >
      {noteEffect && (
        <Suspense fallback={null}>
          <Tracks
            tracks={webglTracks}
            notesRef={notesRef}
            subscribe={subscribe}
            noteSettings={noteSettings}
            noteBuffer={noteBuffer}
          />
        </Suspense>
      )}

      {currentKeys.map((key, index) => {
        const { displayName } = getKeyInfoByGlobalKey(key);
        const basePosition =
          displayPositions[index] ??
          currentPositions[index] ??
          FALLBACK_POSITION;

        // zIndex가 null/undefined인 경우 index를 fallback으로 사용 (메인 그리드와 동일하게)
        const position = {
          ...basePosition,
          zIndex: basePosition.zIndex ?? index,
        };

        return (
          <OverlayKey
            key={`${selectedKeyType}-${index}`}
            keyName={displayName}
            globalKey={key}
            position={position}
            mode={selectedKeyType}
            counterEnabled={keyCounterEnabled}
          />
        );
      })}
      {displayStatPositions.map((pos, index) => {
        if (!pos || pos.hidden) return null;

        const defaultLabel =
          pos.statType === 'kpsAvg'
            ? 'AVG'
            : pos.statType === 'kpsMax'
            ? 'MAX'
            : pos.statType === 'total'
            ? 'Total'
            : 'KPS';
        const label = (pos.displayText || '').trim() || defaultLabel;
        const position = { ...pos, zIndex: pos.zIndex ?? index };

        return (
          <OverlayStatItem
            key={`stat-${selectedKeyType}-${index}`}
            statType={pos.statType}
            label={label}
            position={position}
            counterEnabled={true}
          />
        );
      })}
      {displayGraphPositions.map((pos, index) => {
        if (!pos || pos.hidden) return null;
        const graphPosition = { ...pos, zIndex: pos.zIndex ?? index };
        return (
          <OverlayGraphItem
            key={`graph-${selectedKeyType}-${index}`}
            index={index}
            position={graphPosition}
          />
        );
      })}
      {keyCounterEnabled ? (
        <KeyCounterLayer
          keys={currentKeys}
          positions={
            displayPositions.length ? displayPositions : currentPositions
          }
          mode={selectedKeyType}
        />
      ) : null}
      <OverlayStatCounterLayer positions={displayStatPositions} />
      <PluginElementsRenderer
        windowType="overlay"
        positionOffset={positionOffset}
      />
    </div>
  );
}
