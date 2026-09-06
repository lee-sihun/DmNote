import React, {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { I18nContext } from '@contexts/I18nContextDef';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { subscribeHistoryEditorFlushStart } from '@src/renderer/editor/runtime/historyEditorFlushLock';
import {
  releaseDragSession,
  tryAcquireDragSession,
} from '@hooks/Grid/dragSession';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';
import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';
import {
  getCursor,
  lockCustomCursor,
  unlockCustomCursor,
  type RotationCursorType,
} from '@utils/grid/cursorUtils';
import { resolveRotationDrag, rotatedRectCorners } from '@utils/core/rotation';
import { getActiveElement } from '@utils/dom/activeElement';
import { isHTMLElementNode } from '@utils/dom/isElementNode';
import { suppressNextClick } from '@utils/dom/suppressNextClick';
import type { Bounds } from './groupResizeUtils';
import RotateCornerHandles from './RotateCornerHandles';
import { SELECTION_BORDER_CENTER } from './selectionOutline';

export interface CanvasRotationSession {
  preview: (rotation: number) => boolean;
  commit: (rotation: number) => void;
  cancel: () => void;
}

interface CanvasRotateHandleProps {
  bounds: Bounds;
  rotation: number;
  zoom: number;
  panX: number;
  panY: number;
  sessionKey: string;
  kind?: 'native' | 'selection';
  start: (rotation: number) => CanvasRotationSession | null;
}

interface DragState {
  pointerId: number;
  session: CanvasRotationSession;
  base: number;
  startAngle: number;
  // 마지막으로 프리뷰한 각도. null이면 움직인 적이 없다
  last: number | null;
  sawPressedMove: boolean;
}

// 모서리 바깥 회전 드래그의 입력·커서·중단 수명
const CanvasRotateHandle = ({
  sessionKey,
  kind = 'native',
  start,
  bounds,
  rotation,
  zoom,
  panX,
  panY,
}: CanvasRotateHandleProps) => {
  // 분리 패널·테스트처럼 프로바이더 밖에서도 그려지므로 번역은 선택적으로 읽는다
  const translate = useContext(I18nContext)?.t;
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragRotation, setDragRotation] = useState<number | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const grabbedRef = useRef<{ el: Element; pointerId: number } | null>(null);
  const moveSchedulerRef = useRef<ReturnType<
    typeof createRafLatestScheduler<PointerEvent>
  > | null>(null);
  const cancelActiveDragRef = useRef<() => void>(() => {});

  // 드래그 중 팬·줌·상자 변경을 최신값으로 읽는다 - 핸들러는 커밋 뒤에만 돌므로 충분
  const latestRef = useRef({ bounds, rotation, zoom, panX, panY, start });
  useLayoutEffect(() => {
    latestRef.current = { bounds, rotation, zoom, panX, panY, start };
  });

  const centerClient = (): { x: number; y: number } => {
    const rect = rootRef.current?.getBoundingClientRect();
    const live = latestRef.current;
    return {
      x:
        (rect?.left ?? 0) +
        (live.bounds.x + live.bounds.width / 2) * live.zoom +
        live.panX,
      y:
        (rect?.top ?? 0) +
        (live.bounds.y + live.bounds.height / 2) * live.zoom +
        live.panY,
    };
  };

  const angleAt = (clientX: number, clientY: number): number => {
    const center = centerClient();
    return Math.atan2(clientY - center.y, clientX - center.x);
  };

  const releaseGrabbed = () => {
    const grabbed = grabbedRef.current;
    if (!grabbed) return;
    endDragCursor(grabbed.el.ownerDocument);
    unlockCustomCursor();
    try {
      grabbed.el.releasePointerCapture(grabbed.pointerId);
    } catch {
      // 이미 해제됐으면 무시
    }
    grabbedRef.current = null;
  };

  const finishDrag = () => {
    if (!dragRef.current) return;
    releaseDragSession();
    moveSchedulerRef.current?.cancel();
    moveSchedulerRef.current = null;
    detachRef.current?.();
    detachRef.current = null;
    releaseGrabbed();
    dragRef.current = null;
    setDragRotation(null);
    suppressNextClick();
  };

  // 프리뷰를 되돌리고 종료 - 외부 중단(undo·flush·선택 변경·창 블러)의 공통 경로
  const cancelActiveDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.last !== null) drag.session.cancel();
    finishDrag();
  };
  useLayoutEffect(() => {
    cancelActiveDragRef.current = cancelActiveDrag;
  });

  useEffect(() => () => cancelActiveDragRef.current(), []);
  useEffect(() => () => cancelActiveDragRef.current(), [sessionKey]);
  useEffect(
    () => subscribeHistoryEditorFlushStart(() => cancelActiveDragRef.current()),
    [],
  );

  // undo/redo가 저장값을 되돌린 뒤 늦은 pointerup이 낡은 각도를 다시 커밋하지 않게
  const historyTick = useCommittedApplyStore((state) => state.historyTick);
  const historyTickRef = useRef(historyTick);
  useEffect(() => {
    if (historyTickRef.current === historyTick) return;
    historyTickRef.current = historyTick;
    cancelActiveDragRef.current();
  }, [historyTick]);

  const applyMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const next = resolveRotationDrag({
      base: drag.base,
      startAngle: drag.startAngle,
      angle: angleAt(event.clientX, event.clientY),
      snap: event.shiftKey,
    });
    if (drag.last === next) return;
    if (!drag.session.preview(next)) return;
    drag.last = next;
    setDragRotation(next);
  };

  const settleActiveDrag = (pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    // 같은 프레임의 마지막 move가 rAF에 남아 있으면 커밋 전에 반영한다
    moveSchedulerRef.current?.flush();
    const value = drag.last;
    if (value === null) {
      finishDrag();
      return;
    }
    drag.session.commit(value);
    finishDrag();
  };

  const handleWindowUp = (event: PointerEvent) => {
    settleActiveDrag(event.pointerId);
  };
  const handleWindowMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (event.pointerId !== drag?.pointerId) return;
    if (event.buttons !== 0) drag.sawPressedMove = true;
    moveSchedulerRef.current?.push(event);
    // 일부 WebView 합성 입력은 up 없이 마지막 move의 buttons만 0으로 바뀐다
    if (event.buttons === 0 && drag.sawPressedMove) {
      settleActiveDrag(event.pointerId);
    }
  };
  const handleWindowCancel = (event: PointerEvent) => {
    if (event.pointerId !== dragRef.current?.pointerId) return;
    cancelActiveDrag();
  };
  const handleMouseUp = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const drag = dragRef.current;
    if (!drag) return;
    settleActiveDrag(drag.pointerId);
  };
  const handleLostPointerCapture = (event: Event) => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerId !== dragRef.current?.pointerId) return;
    settleActiveDrag(pointerEvent.pointerId);
  };
  const handleWindowBlur = () => cancelActiveDrag();
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancelActiveDrag();
  };

  const attachWindowListeners = () => {
    const captureTarget = grabbedRef.current?.el ?? null;
    const ownerDocument = captureTarget?.ownerDocument ?? document;
    const ownerWindow = ownerDocument.defaultView ?? window;
    ownerWindow.addEventListener('pointermove', handleWindowMove, true);
    ownerWindow.addEventListener('pointerup', handleWindowUp, true);
    ownerWindow.addEventListener('pointercancel', handleWindowCancel, true);
    ownerWindow.addEventListener('mouseup', handleMouseUp, true);
    ownerWindow.addEventListener('blur', handleWindowBlur);
    ownerWindow.addEventListener('keydown', handleKeyDown, true);
    captureTarget?.addEventListener(
      'lostpointercapture',
      handleLostPointerCapture,
    );
    detachRef.current = () => {
      ownerWindow.removeEventListener('pointermove', handleWindowMove, true);
      ownerWindow.removeEventListener('pointerup', handleWindowUp, true);
      ownerWindow.removeEventListener(
        'pointercancel',
        handleWindowCancel,
        true,
      );
      ownerWindow.removeEventListener('mouseup', handleMouseUp, true);
      ownerWindow.removeEventListener('blur', handleWindowBlur);
      ownerWindow.removeEventListener('keydown', handleKeyDown, true);
      captureTarget?.removeEventListener(
        'lostpointercapture',
        handleLostPointerCapture,
      );
    };
    return ownerWindow;
  };

  // 열린 패널 입력을 먼저 정산해 드래그 시작 각도가 입력값 위에 얹히게 한다
  const settleFocusedField = () => {
    const active = getActiveElement();
    if (
      isHTMLElementNode(active) &&
      active.matches('input, textarea, [contenteditable="true"]')
    ) {
      flushSync(() => active.blur());
    }
  };

  const beginDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    cursor: RotationCursorType,
  ) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (!tryAcquireDragSession()) return;
    settleFocusedField();
    const session = latestRef.current.start(latestRef.current.rotation);
    if (!session) {
      releaseDragSession();
      return;
    }
    const el = event.currentTarget;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // 미지원 환경은 커서 고정 없이 동작만 유지
    }
    beginDragCursor(getCursor(cursor), el.ownerDocument);
    lockCustomCursor(cursor, event.nativeEvent);
    grabbedRef.current = { el, pointerId: event.pointerId };
    dragRef.current = {
      pointerId: event.pointerId,
      session,
      base: latestRef.current.rotation,
      startAngle: angleAt(event.clientX, event.clientY),
      last: null,
      sawPressedMove: false,
    };
    const ownerWindow = attachWindowListeners();
    moveSchedulerRef.current = createRafLatestScheduler<PointerEvent>(
      applyMove,
      'frame',
      ownerWindow,
    );
  };

  const shownRotation = dragRotation ?? rotation;
  // 크기 조절 핸들과 같은 테두리 중심을 기준으로 바깥 영역 배치
  const corners = rotatedRectCorners(
    bounds.x * zoom + panX - SELECTION_BORDER_CENTER,
    bounds.y * zoom + panY - SELECTION_BORDER_CENTER,
    bounds.width * zoom + SELECTION_BORDER_CENTER * 2,
    bounds.height * zoom + SELECTION_BORDER_CENTER * 2,
    shownRotation,
  );
  const label = translate?.('propertiesPanel.rotation') || '회전';

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 pointer-events-none"
      // 격리된 그리드 배경 위에서 다른 요소의 선택을 먼저 받는다
      style={{ zIndex: -1 }}
      // 회전 조작을 팝업 바깥 클릭에서 제외
      data-dmn-canvas-editor-overlay="true"
      data-rotation-handles={kind}
    >
      <RotateCornerHandles
        corners={corners}
        label={label}
        onPointerDown={beginDrag}
      />
    </div>
  );
};

export default CanvasRotateHandle;
