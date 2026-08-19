import { useEffect, useRef, useState } from 'react';

import { panelWindowApi } from '@api/modules/panelWindowApi';
import { PANEL_HEADER_HEIGHT } from '@components/main/Grid/PropertiesPanel/panelChrome';
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';
import {
  detachPropertiesPanel,
  dockPropertiesPanel,
  usePanelHostStore,
} from '@stores/grid/usePanelHostStore';
import { isElementNode } from '@utils/dom/isElementNode';

// 패널 헤더 배경 드래그로 분리/도킹.
//
// 도킹 상태: 헤더를 잡고 끌면 고스트(패널 실루엣)가 커서를 따라다니고, 인라인 패널은 흐려진다.
//   - 도크 존(원래 자리) 안에서 놓으면 취소, 밖에서 놓으면 그 자리에 창을 띄운다(분리)
//   - 커서가 메인 창 밖으로 나가면 그 즉시 실제 창을 커서 밑에 띄우고(tear-off) 창을 끌고 간다
// 분리 상태: 헤더를 잡고 끌면 창 자체가 따라온다(JS 주도 이동). 메인의 도크 존 위에서 놓으면 도킹
//
// 좌표: mousemove의 screenX/Y(CSS px, 화면 논리 좌표)가 곧 Tauri LogicalPosition이다.
// 창 밖으로 나가도 드래그를 시작한 문서가 mousemove를 계속 받는다(WebKit 마우스 캡처)

// 이만큼 움직여야 제스처 시작 - 클릭과 구분
const DRAG_START_PX = 6;
// 도크 존 여유 - 원래 자리 주변 이 거리 안에서 놓으면 도킹으로 본다
const DOCK_ZONE_MARGIN_PX = 48;
// 컨텍스트를 못 받았을 때의 폭 - 고스트·도크 존 계산에 쓴다
const FALLBACK_PANEL_WIDTH = 240;

// 인터랙티브 요소 위에서는 드래그를 시작하지 않음
const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, a, [role="switch"], [role="listbox"], [contenteditable="true"]';

export interface PanelDragGhost {
  // 메인 창 client 좌표
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragSession {
  // 시작 시점의 배치 - 세션 중간에 바뀌어도(다른 경로의 전환) 이 값 기준으로 정리한다
  origin: 'docked' | 'detached';
  startScreen: { x: number; y: number };
  // 커서 - 패널 프레임 좌상단 (프레임 좌표계와 무관하게 유지되는 잡은 위치)
  grabOffset: { x: number; y: number };
  // 고스트 크기 = 실제로 뜰 창 크기 (인라인 높이가 아니라 백엔드가 산출한 창 높이)
  ghostSize: { width: number; height: number };
  // 화면 논리 좌표의 도크 존 - 여기 놓으면 도킹/취소
  dockZoneScreen: Rect | null;
  // 메인 창 content 원점(화면 논리 좌표) - 고스트 client 좌표 변환용
  mainContentOrigin: { x: number; y: number };
  started: boolean;
  // 창을 끌고 있는 중(분리 상태 드래그 또는 tear-off 이후)
  draggingWindow: boolean;
  // tear-off 진행 중 - 끝나면 마지막 위치로 창을 옮긴다
  tearingOff: boolean;
  // tear-off 도중에 버튼을 놓았다 - 창이 뜨면 마지막 위치에 두고 세션을 끝낸다
  releasedWhileTearingOff: boolean;
  lastScreen: { x: number; y: number };
  moveFrame: number | null;
  ownerDocument: Document;
  ownerWindow: Window;
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

// 세션 컨텍스트: 메인 창 content 원점(화면 논리 좌표)과 패널 창 크기.
// content 원점은 outer 프레임 원점에 크롬 두께를 더한다 -
// macOS 오버레이 타이틀바는 두께 0, Windows 표준 프레임은 테두리/타이틀바만큼
const resolveDragContext = async () => {
  const context = await panelWindowApi.dragContext().catch(() => null);
  if (!context) return null;
  const frame = context.mainFrame;
  const chromeX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const chromeY = Math.max(0, window.outerHeight - window.innerHeight);
  return {
    mainContentOrigin: frame
      ? { x: frame.x + chromeX, y: frame.y + chromeY }
      : null,
    panelSize: { width: context.panelWidth, height: context.panelHeight },
  };
};

interface UsePanelHeaderDragParams {
  // 패널 서브트리가 사는 문서 (도킹: 메인, 분리: 자식 창)
  hostDocument: Document;
  hostWindow: Window;
  // 메인 창 안 도킹 자리(그리드 영역) - 도크 존 계산 기준
  dockAreaRef: React.RefObject<HTMLElement | null>;
}

interface UsePanelHeaderDragResult {
  ghost: PanelDragGhost | null;
  // 분리 창을 도크 존 위로 끌고 있음 - 메인이 도킹 자리를 비춘다
  dockHint: boolean;
}

export const usePanelHeaderDrag = ({
  hostDocument,
  hostWindow,
  dockAreaRef,
}: UsePanelHeaderDragParams): UsePanelHeaderDragResult => {
  const [ghost, setGhost] = useState<PanelDragGhost | null>(null);
  const [dockHint, setDockHint] = useState(false);
  const sessionRef = useRef<DragSession | null>(null);

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
      session.cleanup();
      setGhost(null);
      setDockHint(false);
      document.body.classList.remove('dmn-dragging');
      session.ownerDocument.body.classList.remove('dmn-dragging');
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

    const scheduleWindowMove = (session: DragSession) => {
      if (session.moveFrame !== null) return;
      session.moveFrame = session.ownerWindow.requestAnimationFrame(() => {
        session.moveFrame = null;
        if (sessionRef.current !== session || !session.draggingWindow) return;
        const { x, y } = session.lastScreen;
        void panelWindowApi
          .moveTo(x - session.grabOffset.x, y - session.grabOffset.y)
          .catch(() => {});
      });
    };

    const updateDockHint = (session: DragSession) => {
      const zone = session.dockZoneScreen;
      const over =
        !!zone && contains(zone, session.lastScreen.x, session.lastScreen.y);
      setDockHint(over);
      return over;
    };

    // 커서가 메인 창 밖으로 나갔다 - 실제 창을 커서 밑에 띄우고 이어서 끌고 간다
    const tearOff = (session: DragSession) => {
      if (session.tearingOff || session.draggingWindow) return;
      session.tearingOff = true;
      const position = {
        x: session.lastScreen.x - session.grabOffset.x,
        y: session.lastScreen.y - session.grabOffset.y,
      };
      void detachPropertiesPanel({ position, keepMainFocus: true }).then(
        (outcome) => {
          if (sessionRef.current !== session) return;
          session.tearingOff = false;
          if (outcome !== 'done') {
            endSession();
            return;
          }
          setGhost(null);
          session.draggingWindow = true;
          if (session.releasedWhileTearingOff) {
            // 놓은 자리로 맞추고 끝낸다
            const { x, y } = session.lastScreen;
            void panelWindowApi
              .moveTo(x - session.grabOffset.x, y - session.grabOffset.y)
              .catch(() => {});
            endSession();
            return;
          }
          // 놓는 사이 움직인 만큼 따라잡는다
          scheduleWindowMove(session);
          updateDockHint(session);
        },
      );
    };

    const handleMouseMove = (event: MouseEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      session.lastScreen = { x: event.screenX, y: event.screenY };

      if (!session.started) {
        const dx = event.screenX - session.startScreen.x;
        const dy = event.screenY - session.startScreen.y;
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        session.started = true;
        document.body.classList.add('dmn-dragging');
        session.ownerDocument.body.classList.add('dmn-dragging');
        if (session.origin === 'detached') {
          session.draggingWindow = true;
        }
      }

      if (session.draggingWindow) {
        scheduleWindowMove(session);
        updateDockHint(session);
        return;
      }
      if (session.tearingOff) return;

      // 도킹 상태에서 끄는 중 - 고스트가 따라온다
      const inMainWindow =
        event.clientX >= 0 &&
        event.clientY >= 0 &&
        event.clientX <= window.innerWidth &&
        event.clientY <= window.innerHeight;
      if (!inMainWindow) {
        tearOff(session);
        return;
      }
      setGhost({
        x: event.clientX - session.grabOffset.x,
        y: event.clientY - session.grabOffset.y,
        width: session.ghostSize.width,
        height: session.ghostSize.height,
      });
    };

    const handleMouseUp = () => {
      const session = sessionRef.current;
      if (!session) return;
      if (!session.started) {
        endSession();
        return;
      }
      if (session.tearingOff) {
        // tear-off가 끝나기 전에 놓았다 - 창이 뜨면 그 자리에 두고 끝낸다
        session.releasedWhileTearingOff = true;
        session.cleanup();
        return;
      }
      const inDockZone =
        !!session.dockZoneScreen &&
        contains(
          session.dockZoneScreen,
          session.lastScreen.x,
          session.lastScreen.y,
        );
      const wasDraggingWindow = session.draggingWindow;
      const drop = {
        x: session.lastScreen.x - session.grabOffset.x,
        y: session.lastScreen.y - session.grabOffset.y,
      };
      endSession();

      if (wasDraggingWindow) {
        if (inDockZone) void dockPropertiesPanel();
        return;
      }
      if (inDockZone) return;
      void detachPropertiesPanel({ position: drop });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const session = sessionRef.current;
      if (!session || session.draggingWindow) return;
      endSession();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || sessionRef.current) return;
      if (isHistoryEditorFlushLocked()) return;
      if (!isHeaderBackground(event.target)) return;
      const header = (event.target as HTMLElement).closest<HTMLElement>(
        '.dmn-panel-header',
      );
      const frame = header?.closest<HTMLElement>('[data-dmn-panel-frame]');
      if (!header || !frame) return;
      // 헤더 아래(본문)에서 시작한 건 드래그가 아니다
      if (
        event.clientY - frame.getBoundingClientRect().top >
        PANEL_HEADER_HEIGHT
      ) {
        return;
      }
      event.preventDefault();

      const frameRect = frame.getBoundingClientRect();
      const placement = usePanelHostStore.getState().placement;
      const session: DragSession = {
        origin: placement,
        startScreen: { x: event.screenX, y: event.screenY },
        grabOffset: {
          x: event.clientX - frameRect.left,
          y: event.clientY - frameRect.top,
        },
        // 컨텍스트가 오기 전엔 인라인 프레임 크기 - 첫 프레임 몇 개만 다르다
        ghostSize: { width: FALLBACK_PANEL_WIDTH, height: frameRect.height },
        dockZoneScreen: null,
        mainContentOrigin: { x: 0, y: 0 },
        started: false,
        draggingWindow: false,
        tearingOff: false,
        releasedWhileTearingOff: false,
        lastScreen: { x: event.screenX, y: event.screenY },
        moveFrame: null,
        ownerDocument: doc,
        ownerWindow: win,
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

      // 도크 존·창 크기는 백엔드에 물어봐야 한다 - 왕복 동안 시작해도 무방
      void resolveDragContext().then((context) => {
        if (sessionRef.current !== session || !context) return;
        session.ghostSize = context.panelSize;
        if (context.mainContentOrigin) {
          session.mainContentOrigin = context.mainContentOrigin;
          session.dockZoneScreen = computeDockZone(context.mainContentOrigin);
        }
      });
    };

    doc.addEventListener('mousedown', handleMouseDown);
    return () => {
      doc.removeEventListener('mousedown', handleMouseDown);
      endSession();
    };
  }, [hostDocument, hostWindow, dockAreaRef]);

  return { ghost, dockHint };
};
