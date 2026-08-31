import { useEffect, useRef, useState } from 'react';

import {
  panelWindowApi,
  type PanelDragGeometry,
} from '@api/modules/panelWindowApi';
import { PANEL_HEADER_HEIGHT } from '@components/main/Grid/PropertiesPanel/panelChrome';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';
import {
  detachPropertiesPanel,
  dockPropertiesPanel,
  usePanelHostStore,
} from '@stores/grid/usePanelHostStore';
import { getPanelChildWindow } from '@utils/panelWindow/panelChildWindow';
import { isWindows } from '@utils/core/platform';
import { isElementNode } from '@utils/dom/isElementNode';

import {
  startNativePanelDrag,
  type NativePanelDragHandle,
} from './panelNativeDragSession';

// 패널 헤더 배경 드래그로 분리/도킹 (OBS/Qt 도크 위젯 방식).
//
// 도킹 상태: 헤더를 잡고 조금만 움직이면 그 자리에서 곧바로 실제 창이 떠서 커서를 따라온다.
//   원래 자리(도크 존) 안에서 놓으면 자석처럼 다시 붙고(도킹), 밖에서 애 그대로 분리 창이 된다
// 분리 상태: 헤더를 잡고 끌면 창이 따라온다. 메인의 도크 존 위에서 놓으면 도킹
//
// 창은 자식 창을 미리 만들어 두므로(PropertiesPanelHost 워밍업) 첫 이동에서 바로 뜬다.
//
// 플랫폼 전략은 임계 통과 시 한 번 고른다:
// - macOS(legacy): mousemove의 screenX/Y(CSS px)가 곧 Tauri LogicalPosition이라 매 프레임
//   moveTo로 창을 민다. 창 밖으로 나가도 시작 문서가 mousemove를 계속 받는다(WebKit 캡처)
// - Windows(native): screenX는 Chromium DIP(디스플레이별 원점 보정)라 LogicalPosition이
//   아니다. 혼합 DPI에서 배율 토글 진동이 생겨 이동을 OS 모달 루프에 인계한다 -
//   panelNativeDragSession, 계약은 tasks/plan/panel-drag-coordinate-space.md

// 이만큼 움직여야 제스처 시작(창이 뜸) - 클릭과 구분
const DRAG_START_PX = 6;
// 도킹에서 막 떼어낸 창: 잡은 지점에서 이 거리 안에서 놓으면 자석처럼 제자리로 돌아간다.
// 원래 자리 스트립 전체를 기준으로 하면 세로로는 어디서 놓아도 돌아가 버려 너무 예민하다
const SNAP_BACK_PX = 30;
// 분리 창을 다시 가져와 붙일 때의 도크 존 여유 - 원래 자리 주변 이 거리 안에서 놓으면 도킹
const DOCK_ZONE_MARGIN_PX = 48;
// 컨텍스트를 못 받았을 때의 폭 - 도크 존 계산에 쓴다
const FALLBACK_PANEL_WIDTH = 240;

// 인터랙티브 요소 위에서는 드래그를 시작하지 않음
const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, a, [role="switch"], [role="listbox"], [contenteditable="true"]';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragSession {
  // 시작 시점의 배치 - 세션 중간에 바뀌어도 이 값 기준으로 정리한다
  origin: 'docked' | 'detached';
  startScreen: { x: number; y: number };
  // 최초 mousedown의 client 좌표 - Windows 네이티브 세션의 스냅백 기준점
  pressClient: { x: number; y: number };
  // Windows 네이티브 세션 - 있으면 이동·종료 권위가 OS와 백엔드에 있다
  native: NativePanelDragHandle | null;
  // 커서 - 패널 프레임 좌상단 (창을 이 오프셋만큼 커서 아래에 둔다)
  grabOffset: { x: number; y: number };
  // 화면 논리 좌표의 도크 존 - 여기 놓으면 도킹
  dockZoneScreen: Rect | null;
  started: boolean;
  // 창을 끌고 있는 중(분리 상태 드래그 또는 tear-off 이후)
  draggingWindow: boolean;
  // tear-off(창 띄우기) 진행 중 - 끝나면 마지막 위치로 창을 옮긴다
  tearingOff: boolean;
  // tear-off 도중에 버튼을 놓았다 - 창이 뜨면 드롭 처리를 마저 한다
  releasedWhileTearingOff: boolean;
  lastScreen: { x: number; y: number };
  moveFrame: number | null;
  ownerDocument: Document;
  ownerWindow: Window;
  nativeCursorReady: Promise<void>;
  cleanup: () => void;
}

const isHeaderBackground = (target: EventTarget | null): boolean => {
  if (!isElementNode(target)) return false;
  const element = target as HTMLElement;
  const isHeaderSelf = element.classList.contains('dmn-panel-header');
  const isHeaderRowGap =
    !isHeaderSelf &&
    element.parentElement?.classList.contains('dmn-panel-header') === true &&
    element.childElementCount === 0 &&
    element.textContent === '';
  if (!isHeaderSelf && !isHeaderRowGap) return false;
  if (element.closest(INTERACTIVE_SELECTOR)) return false;
  return true;
};

const contains = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x &&
  x <= rect.x + rect.width &&
  y >= rect.y &&
  y <= rect.y + rect.height;

const inflate = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + by * 2,
  height: rect.height + by * 2,
});

// 메인 창 content 원점(화면 논리 좌표) - 백엔드가 inner_position으로 실측한다.
// 프레임리스+그림자 창의 인셋(Windows tao, 좌우 ≈8px)을 렌더러의 outerWidth-innerWidth로는
// 못 잡는다(WebView2에선 0). 실측 실패 시 outer 원점 근사 - 인셋만큼의 오차는
// 도크 존 여유(DOCK_ZONE_MARGIN_PX)가 흡수한다
const resolveMainContentOrigin = async () => {
  const context = await panelWindowApi.dragContext().catch(() => null);
  if (!context) return null;
  return (
    context.mainContentOrigin ??
    (context.mainFrame
      ? { x: context.mainFrame.x, y: context.mainFrame.y }
      : null)
  );
};

interface UsePanelHeaderDragParams {
  // 패널 서브트리가 사는 문서 (도킹: 메인, 분리: 자식 창)
  hostDocument: Document;
  hostWindow: Window;
  // 메인 창 안 도킹 자리(그리드 영역) - 도크 존 계산 기준
  dockAreaRef: React.RefObject<HTMLElement | null>;
}

interface UsePanelHeaderDragResult {
  // 창을 도크 존 위로 끌고 있음 - 메인이 도킹 자리를 비춘다
  dockHint: boolean;
}

export const usePanelHeaderDrag = ({
  hostDocument,
  hostWindow,
  dockAreaRef,
}: UsePanelHeaderDragParams): UsePanelHeaderDragResult => {
  const [dockHint, setDockHint] = useState(false);
  const sessionRef = useRef<DragSession | null>(null);
  const endSessionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const doc = hostDocument;
    const win = hostWindow;

    const endSession = () => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      if (session.moveFrame !== null) {
        session.ownerWindow.cancelAnimationFrame(session.moveFrame);
      }
      session.native?.dispose();
      session.cleanup();
      setDockHint(false);
      document.body.classList.remove('dmn-dragging');
      session.ownerDocument.body.classList.remove('dmn-dragging');
      void session.nativeCursorReady
        .then(() => panelWindowApi.setDragCursor(false))
        .catch(() => {});
    };

    // 도크 존: 그리드 영역의 오른쪽 PANEL_WIDTH 스트립(±여유), 화면 논리 좌표
    const computeDockZone = (mainContentOrigin: {
      x: number;
      y: number;
    }): Rect | null => {
      const area = dockAreaRef.current;
      if (!area) return null;
      const rect = area.getBoundingClientRect();
      return inflate(
        {
          x: mainContentOrigin.x + rect.right - FALLBACK_PANEL_WIDTH,
          y: mainContentOrigin.y + rect.top,
          width: FALLBACK_PANEL_WIDTH,
          height: rect.height,
        },
        DOCK_ZONE_MARGIN_PX,
      );
    };

    // Windows 백엔드용 도크 존 - 메인 content 기준 CSS px (네이티브 원점은 백엔드가 더한다)
    const computeDockAreaCss = (): PanelDragGeometry['dockAreaCss'] => {
      const area = dockAreaRef.current;
      if (!area) return null;
      const rect = area.getBoundingClientRect();
      return inflate(
        {
          x: rect.right - FALLBACK_PANEL_WIDTH,
          y: rect.top,
          width: FALLBACK_PANEL_WIDTH,
          height: rect.height,
        },
        DOCK_ZONE_MARGIN_PX,
      );
    };

    // Windows: 이동 권한을 OS에 인계 - 이후 mousemove는 무시, 종료는 drag-ended 이벤트
    const beginNativeDrag = (session: DragSession) => {
      const geometry: PanelDragGeometry = {
        gestureId: crypto.randomUUID(),
        origin: session.origin,
        grabOffsetCss: session.grabOffset,
        pressClientCss: session.pressClient,
        dockAreaCss: computeDockAreaCss(),
        // 이 모듈은 메인 창 컨텍스트에서 돈다 - window는 항상 메인 창이다
        mainDevicePixelRatio: window.devicePixelRatio,
        // seed는 패널 표면이 그린다 - 자식 창의 실측 DPR. 아직 없으면 null
        // (메인 DPR 값을 보내면 패널 창 배율로 나뉘어 엉뚱한 잔차가 정상값으로
        // 통과한다). 첫 tear-off는 창이 detach 전환 안에서 생기므로 docked 경로는
        // panelNativeDragSession이 present 직전에 다시 실측해 덮어쓴다
        panelDevicePixelRatio:
          getPanelChildWindow()?.window.devicePixelRatio ?? null,
      };
      session.native = startNativePanelDrag(geometry, {
        dockAreaAlive: () => dockAreaRef.current !== null,
        snapBackPx: SNAP_BACK_PX,
        onDockHint: setDockHint,
        onFinished: () => {
          if (sessionRef.current === session) endSession();
        },
      });
    };

    const windowPositionFor = (session: DragSession) => ({
      x: session.lastScreen.x - session.grabOffset.x,
      y: session.lastScreen.y - session.grabOffset.y,
    });

    const scheduleWindowMove = (session: DragSession) => {
      if (session.moveFrame !== null) return;
      session.moveFrame = session.ownerWindow.requestAnimationFrame(() => {
        session.moveFrame = null;
        if (sessionRef.current !== session || !session.draggingWindow) return;
        const { x, y } = windowPositionFor(session);
        void panelWindowApi.moveTo(x, y).catch(() => {});
      });
    };

    const isInDockZone = (session: DragSession) =>
      !!session.dockZoneScreen &&
      contains(
        session.dockZoneScreen,
        session.lastScreen.x,
        session.lastScreen.y,
      );

    // 놓으면 도킹되는가 - 막 떼어낸 창은 잡은 지점 근처에서만, 분리 창은 도크 존 위에서
    const wouldDock = (session: DragSession) => {
      if (session.origin === 'docked') {
        return (
          Math.hypot(
            session.lastScreen.x - session.startScreen.x,
            session.lastScreen.y - session.startScreen.y,
          ) <= SNAP_BACK_PX
        );
      }
      // 설정 화면처럼 실제 그리드가 사라진 동안에는 이전에 계산한 영역도 무효
      if (!dockAreaRef.current) return false;
      return isInDockZone(session);
    };

    // 놓았다 - 도크 존 안이면 자석처럼 다시 붙고, 밖이면 그 자리에 둔다
    const finishDrop = (session: DragSession) => {
      const snapBack = wouldDock(session);
      endSession();
      if (snapBack) void dockPropertiesPanel();
    };

    // 첫 이동에서 곧바로 실제 창을 커서 밑에 띄운다 (OBS 방식)
    const tearOff = (session: DragSession) => {
      if (session.tearingOff || session.draggingWindow) return;
      session.tearingOff = true;
      void detachPropertiesPanel({
        position: windowPositionFor(session),
        keepMainFocus: true,
      }).then((outcome) => {
        if (sessionRef.current !== session) {
          if (outcome === 'done') {
            void panelWindowApi.setDragCursor(false).catch(() => {});
          }
          return;
        }
        session.tearingOff = false;
        if (outcome !== 'done') {
          endSession();
          return;
        }
        session.draggingWindow = true;
        // 창이 뜨는 사이 움직인 만큼 따라잡는다
        const { x, y } = windowPositionFor(session);
        void panelWindowApi.moveTo(x, y).catch(() => {});
        if (session.releasedWhileTearingOff) {
          finishDrop(session);
          return;
        }
        setDockHint(wouldDock(session));
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      session.lastScreen = { x: event.screenX, y: event.screenY };

      if (session.native) return;

      if (!session.started) {
        const dx = event.screenX - session.startScreen.x;
        const dy = event.screenY - session.startScreen.y;
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        session.started = true;
        document.body.classList.add('dmn-dragging');
        session.ownerDocument.body.classList.add('dmn-dragging');
        // 플랫폼 전략은 여기서 한 번 갈린다 - Windows는 OS 인계, macOS는 기존 경로
        if (isWindows()) {
          beginNativeDrag(session);
          return;
        }
        if (session.origin === 'detached') {
          session.draggingWindow = true;
        } else {
          tearOff(session);
          return;
        }
      }

      if (session.draggingWindow) {
        scheduleWindowMove(session);
        setDockHint(wouldDock(session));
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      session.lastScreen = { x: event.screenX, y: event.screenY };
      if (session.native) {
        // 종료 권위는 drag-ended 이벤트 - 인계 전 해제만 기록해 둔다
        session.native.noteDomMouseUp({ x: event.clientX, y: event.clientY });
        return;
      }
      if (!session.started) {
        endSession();
        return;
      }
      if (session.tearingOff) {
        // 창이 뜨기 전에 놓았다 - 뜨면 드롭 처리를 마저 한다
        session.releasedWhileTearingOff = true;
        session.cleanup();
        return;
      }
      finishDrop(session);
    };

    // Esc: 도킹에서 끌어낸 창은 제자리로 돌려놓는다.
    // 네이티브 세션은 OS 모달 루프가 Esc를 소유한다 - outcome=escaped로 돌아온다
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const session = sessionRef.current;
      if (!session || session.native || session.tearingOff) return;
      const snapBack = session.origin === 'docked' && session.draggingWindow;
      endSession();
      if (snapBack) void dockPropertiesPanel();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || sessionRef.current) return;
      if (isHistoryEditorFlushLocked()) return;
      if (usePanelHostStore.getState().transition !== 'idle') return;
      if (!isHeaderBackground(event.target)) return;
      const header = (event.target as HTMLElement).closest<HTMLElement>(
        '.dmn-panel-header',
      );
      const frame = header?.closest<HTMLElement>('[data-dmn-panel-frame]');
      if (!header || !frame) return;
      const frameRect = frame.getBoundingClientRect();
      // 헤더 아래(본문)에서 시작한 건 드래그가 아니다
      if (event.clientY - frameRect.top > PANEL_HEADER_HEIGHT) return;
      event.preventDefault();
      const nativeCursorReady = panelWindowApi
        .setDragCursor(true)
        .catch(() => {});

      const session: DragSession = {
        origin: usePanelHostStore.getState().placement,
        startScreen: { x: event.screenX, y: event.screenY },
        pressClient: { x: event.clientX, y: event.clientY },
        native: null,
        grabOffset: {
          x: event.clientX - frameRect.left,
          y: event.clientY - frameRect.top,
        },
        dockZoneScreen: null,
        started: false,
        draggingWindow: false,
        tearingOff: false,
        releasedWhileTearingOff: false,
        lastScreen: { x: event.screenX, y: event.screenY },
        moveFrame: null,
        ownerDocument: doc,
        ownerWindow: win,
        nativeCursorReady,
        cleanup: () => {
          doc.removeEventListener('mousemove', handleMouseMove);
          doc.removeEventListener('mouseup', handleMouseUp);
          doc.removeEventListener('keydown', handleKeyDown, true);
        },
      };
      sessionRef.current = session;
      doc.addEventListener('mousemove', handleMouseMove);
      doc.addEventListener('mouseup', handleMouseUp);
      doc.addEventListener('keydown', handleKeyDown, true);

      // 도크 존은 메인 창 위치를 물어봐야 한다 - 왕복 동안 시작해도 무방.
      // Windows 네이티브 경로는 도크 판정이 백엔드라 이 왕복이 필요 없다
      if (!isWindows()) {
        void resolveMainContentOrigin().then((origin) => {
          if (sessionRef.current !== session || !origin) return;
          session.dockZoneScreen = computeDockZone(origin);
        });
      }
    };

    doc.addEventListener('mousedown', handleMouseDown);
    endSessionRef.current = endSession;
    return () => {
      // tear-off로 호스트 문서가 바뀌어 다시 구독할 때 진행 중인 세션을 끊으면 안 된다 -
      // 세션 리스너는 시작한 문서에 묶여 있어 그대로 살아 있다. 종료는 언마운트에서만
      doc.removeEventListener('mousedown', handleMouseDown);
    };
  }, [hostDocument, hostWindow, dockAreaRef]);

  useEffect(
    () => () => {
      endSessionRef.current?.();
    },
    [],
  );

  return { dockHint };
};
