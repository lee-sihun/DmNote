import React, { useEffect, useRef, useState } from 'react';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import {
  useGradientEditStore,
  type GradientEditSession,
} from '@stores/grid/useGradientEditStore';
import {
  GRADIENT_STOPS_MAX,
  toCanonicalGradient,
  type GradientSpec,
} from '@src/types/color';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';
import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';
import {
  applyGradientAxisMagnet,
  buildGradientAxisGeometry,
  clampGradientAxisPosition,
  gradientAxisClientOrigin,
  gradientAxisPointerAngle,
  normalizeGradientAxisAngle,
  projectClientToGradientAxis,
  type GradientAxisBounds,
  type GradientAxisEnd,
  type GradientAxisGeometry,
} from './gradientAxisGeometry';

const MAGNET_THRESHOLD_DEG = 6;
const DRAG_THRESHOLD_PX = 3;

type DragState =
  | {
      type: 'rotate';
      pointerId: number;
      end: GradientAxisEnd;
      ownerGeneration: number;
      startSpec: GradientSpec;
      moved: boolean;
      /** 이동 없이 떼면 그 자리에 스톱 추가 - 축 히트 스트립 한정 */
      addOnClick: boolean;
      /** 잡은 지점 보정 - 시작 각도와 프레스 포인터 각도의 차. 앵커 히트
          영역 어디를 잡아도 첫 이동에서 축이 튀지 않는다 */
      angleOffset: number;
      downX: number;
      downY: number;
    }
  | {
      type: 'stop';
      pointerId: number;
      index: number;
      moved: boolean;
      ownerGeneration: number;
      startSpec: GradientSpec;
      lastPos: number;
      /** 잡은 지점 보정 - 스톱 pos와 프레스 포인터 투영의 차. 스왓치가 축에서
          띄워져 있어도(세로 축에서는 축 방향과 겹침) 첫 이동에 점프가 없다 */
      posOffset: number;
      downX: number;
      downY: number;
    };

interface UseGradientAxisDragSessionOptions {
  session: GradientEditSession | null;
  bounds: GradientAxisBounds | null;
  zoom: number;
  panX: number;
  panY: number;
  continuousInputStrategy: ContinuousInputStrategy;
}

interface GradientAxisDragSession {
  rootRef: React.RefObject<HTMLDivElement | null>;
  angle: number;
  geometry: GradientAxisGeometry | null;
  dragStop: { index: number; pos: number } | null;
  isRotating: boolean;
  beginStripPointer: (event: React.PointerEvent<HTMLDivElement>) => void;
  beginAnchorRotate: (
    end: GradientAxisEnd,
  ) => (event: React.PointerEvent<HTMLDivElement>) => void;
  beginStopDrag: (
    index: number,
  ) => (event: React.PointerEvent<HTMLDivElement>) => void;
  handleRotateKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  handleStopContextMenu: (index: number) => (event: React.MouseEvent) => void;
}

const stopAll = (event: React.SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

export const useGradientAxisDragSession = ({
  session,
  bounds,
  zoom,
  panX,
  panY,
  continuousInputStrategy,
}: UseGradientAxisDragSessionOptions): GradientAxisDragSession => {
  const dragRef = useRef<DragState | null>(null);
  const [dragAngle, setDragAngle] = useState<number | null>(null);
  const [dragStop, setDragStop] = useState<{
    index: number;
    pos: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const sessionRef = useRef(session);
  // eslint-disable-next-line react-hooks/refs
  sessionRef.current = session;
  const geoRef = useRef<GradientAxisGeometry | null>(null);
  // 드래그 세션 해제자 - begin에서 등록, 종료 경로 어디서든 1회 실행
  const detachRef = useRef<(() => void) | null>(null);
  // 잡은 요소 - 캡처로 드래그 중 커서를 고정하고 해제 시 복원
  const grabbedRef = useRef<{ el: HTMLElement; pointerId: number } | null>(
    null,
  );
  const moveSchedulerRef = useRef<ReturnType<
    typeof createRafLatestScheduler<PointerEvent>
  > | null>(null);
  const cancelActiveDragRef = useRef<() => void>(() => {});

  // 드래그 중 오버레이가 언마운트되면 현재 소유 세션의 preview도 복원
  useEffect(() => () => cancelActiveDragRef.current(), []);

  // 피커 종료·대상 교체로 세션이 사라진 뒤에도 남은 window 리스너 즉시 정리
  useEffect(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (
      session &&
      drag.ownerGeneration === useGradientEditStore.getState().generation
    ) {
      return;
    }
    detachRef.current?.();
    setDragAngle(null);
    setDragStop(null);
  }, [session]);

  // undo/redo 반영 시 진행 중 드래그를 복원 preview 없이 종료 - 저장값이
  // 되돌아간 뒤 pointerup이 마지막 포인터 좌표를 다시 커밋하지 않게
  const historyTick = useCommittedApplyStore((state) => state.historyTick);
  const historyTickRef = useRef(historyTick);
  useEffect(() => {
    if (historyTickRef.current === historyTick) return;
    historyTickRef.current = historyTick;
    if (!dragRef.current) return;
    detachRef.current?.();
    setDragAngle(null);
    setDragStop(null);
  }, [historyTick]);

  const angle = dragAngle ?? session?.spec.angle ?? 0;
  const geometry = bounds
    ? buildGradientAxisGeometry(bounds, angle, zoom, panX, panY)
    : null;
  // eslint-disable-next-line react-hooks/refs
  if (geometry) geoRef.current = geometry;

  // 화면(client) 기준 중심 - 드래그 중 휠 팬·줌으로 좌표가 움직여도
  // 매 이벤트에서 최신 지오메트리로 재계산
  const clientOrigin = () =>
    gradientAxisClientOrigin(
      geoRef.current,
      rootRef.current?.getBoundingClientRect() ?? null,
    );

  // 포인터가 가리키는 축 각도 (보정·자석 이전의 원값)
  const pointerAngleFromClient = (
    clientX: number,
    clientY: number,
    end: GradientAxisEnd,
  ): number => gradientAxisPointerAngle(clientX, clientY, end, clientOrigin());

  const angleFromClient = (
    clientX: number,
    clientY: number,
    drag: Extract<DragState, { type: 'rotate' }>,
    magnetDisabled: boolean,
  ): number =>
    applyGradientAxisMagnet(
      pointerAngleFromClient(clientX, clientY, drag.end) + drag.angleOffset,
      geoRef.current?.magnetAngles ?? [],
      magnetDisabled,
      MAGNET_THRESHOLD_DEG,
    );

  // 포인터의 축 투영 원값 - 잡은 지점 보정 후 호출부가 클램프
  const projectionFromClient = (clientX: number, clientY: number): number =>
    projectClientToGradientAxis(
      clientX,
      clientY,
      geoRef.current,
      clientOrigin(),
    );

  // 포인터를 축에 사영해 pos(0~1) 계산 - 클릭 지점 직접 사용 경로(스톱 추가)
  const posFromClient = (clientX: number, clientY: number): number =>
    clampGradientAxisPosition(projectionFromClient(clientX, clientY));

  const currentSpec = () => sessionRef.current?.spec ?? session?.spec ?? null;

  const stopsWithMovedIndex = (index: number, pos: number) =>
    currentSpec()?.stops.map((stop, stopIndex) =>
      stopIndex === index ? { ...stop, pos } : stop,
    ) ?? [];

  const commitStopDrag = (index: number, pos: number) => {
    const live = sessionRef.current;
    const spec = currentSpec();
    if (!live || !spec) return;
    const stops = stopsWithMovedIndex(index, pos);
    const next = toCanonicalGradient({ ...spec, stops });
    // canonical과 동일한 안정 정렬을 원본 인덱스 태그로 재현해 선택 재매핑
    const sortedIndexes = stops
      .map((stop, stopIndex) => ({
        i: stopIndex,
        pos: Math.min(1, Math.max(0, stop.pos)),
      }))
      .sort((a, b) => a.pos - b.pos);
    const newIndex = sortedIndexes.findIndex((stop) => stop.i === index);
    if (newIndex >= 0) live.selectStop(newIndex);
    live.apply(next, true);
  };

  // 축 클릭 스톱 추가 - 색은 선택 스톱 기준 (피커 스톱 바와 동일 규칙)
  const addStopAt = (pos: number) => {
    const live = sessionRef.current;
    const spec = currentSpec();
    if (!live || !spec) return;
    if (spec.stops.length >= GRADIENT_STOPS_MAX) return;
    const color =
      spec.stops[live.selectedIndex]?.color ??
      spec.stops[0]?.color ??
      '#ffffff';
    const next = toCanonicalGradient({
      ...spec,
      stops: [...spec.stops, { color, pos }],
    });
    const newIndex = next.stops.findIndex(
      (stop) => stop.pos === pos && stop.color === color,
    );
    live.selectStop(newIndex >= 0 ? newIndex : next.stops.length - 1);
    live.apply(next, true);
  };

  // 드래그 소유 세션 검증 - 세션이 사라지거나 한 번이라도 교체되면 중단.
  // 세대 비교라 포인터 이벤트 사이의 A→B→새 A 왕복도 잡는다
  const ownedDrag = (event: PointerEvent): DragState | null => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return null;
    const live = sessionRef.current;
    if (
      !live ||
      drag.ownerGeneration !== useGradientEditStore.getState().generation
    ) {
      detachRef.current?.();
      setDragAngle(null);
      setDragStop(null);
      return null;
    }
    return drag;
  };

  const applyWindowMove = (event: PointerEvent) => {
    const drag = ownedDrag(event);
    if (!drag) return;
    const live = sessionRef.current;
    const spec = currentSpec();
    if (!live || !spec) return;
    if (!drag.moved) {
      if (
        Math.hypot(event.clientX - drag.downX, event.clientY - drag.downY) <
        DRAG_THRESHOLD_PX
      ) {
        return;
      }
      drag.moved = true;
    }

    if (drag.type === 'rotate') {
      const next = angleFromClient(
        event.clientX,
        event.clientY,
        drag,
        event.ctrlKey || event.metaKey,
      );
      setDragAngle(next);
      live.apply({ ...spec, angle: next }, false);
      return;
    }

    // 스톱은 항상 현재 축에 사영 - 위치만 이동, 각도 불변, 잡은 지점 보정
    const pos = clampGradientAxisPosition(
      projectionFromClient(event.clientX, event.clientY) + drag.posOffset,
    );
    drag.lastPos = pos;
    setDragStop({ index: drag.index, pos });
    live.apply({ ...spec, stops: stopsWithMovedIndex(drag.index, pos) }, false);
  };

  const handleWindowMove = (event: PointerEvent) => {
    const drag = ownedDrag(event);
    if (!drag) return;
    // 창 밖에서 버튼이 이미 떼졌으면 stale 드래그 - 커밋 없이 종료
    if (event.buttons === 0) {
      cancelActiveDrag();
      return;
    }
    moveSchedulerRef.current?.push(event);
  };

  const handleWindowUp = (event: PointerEvent) => {
    // 마지막 move 프리뷰를 먼저 반영해 moved 상태와 화면을 확정
    moveSchedulerRef.current?.flush();
    const drag = ownedDrag(event);
    if (!drag) return;
    detachRef.current?.();
    setDragAngle(null);
    setDragStop(null);
    const live = sessionRef.current;
    const spec = currentSpec();
    if (!live || !spec) return;
    if (drag.type === 'rotate') {
      if (!drag.moved) {
        // 클릭 - 축 히트 스트립이면 그 위치에 스톱 추가
        if (drag.addOnClick) {
          addStopAt(posFromClient(event.clientX, event.clientY));
        }
        return;
      }
      const finalAngle = angleFromClient(
        event.clientX,
        event.clientY,
        drag,
        event.ctrlKey || event.metaKey,
      );
      live.apply(toCanonicalGradient({ ...spec, angle: finalAngle }), true);
      return;
    }
    if (!drag.moved) return; // 클릭 - 선택만
    // pointerup 좌표를 직접 사용해 마지막 프레임 사이 입력도 유실하지 않음
    commitStopDrag(
      drag.index,
      clampGradientAxisPosition(
        projectionFromClient(event.clientX, event.clientY) + drag.posOffset,
      ),
    );
  };

  // 취소 - preview로 반영된 변경을 시작 시점 spec으로 복원
  const cancelActiveDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    detachRef.current?.();
    setDragAngle(null);
    setDragStop(null);
    const live = sessionRef.current;
    // 세대가 드래그 시작 시점 그대로일 때만 복원 - 포인터 이벤트 없이
    // A→B→새 A로 교체된 세션에 stale 롤백이 새지 않게
    if (
      live &&
      drag.ownerGeneration === useGradientEditStore.getState().generation
    ) {
      live.apply(drag.startSpec, false);
      live.cancel?.();
    }
  };
  // eslint-disable-next-line react-hooks/refs
  cancelActiveDragRef.current = cancelActiveDrag;

  const handleWindowCancel = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelActiveDrag();
  };

  // 창 포커스 상실 - pointerup이 오지 않으므로 유령 드래그 방지 취소
  const handleWindowBlur = () => cancelActiveDrag();

  // 드래그 제스처의 후속 click이 그리드 선택 해제로 새지 않게 1회 억제
  const suppressNextClick = () => {
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener('click', swallow, true);
    };
    window.addEventListener('click', swallow, true);
    // click이 아예 안 오는 경로(cancel 등) 대비 - 다음 틱에 정리
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };

  // 프레스 즉시 grabbing - 키와 같은 정책(호버 무변화, 잡는 동안만 grabbing).
  // pointerdown preventDefault로 :active가 안 걸리고, 캡처 중에도 커서는
  // 히트테스트 기준(크로뮴)이라 문서 전역 클래스로 드래그 내내 고정
  const grabPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget as HTMLElement;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // 미지원 환경은 커서 고정 없이 동작만 유지
    }
    beginDragCursor('grabbing', element.ownerDocument);
    grabbedRef.current = { el: element, pointerId: event.pointerId };
  };

  const releaseGrabbed = () => {
    const grabbed = grabbedRef.current;
    if (!grabbed) return;
    endDragCursor(grabbed.el.ownerDocument);
    try {
      grabbed.el.releasePointerCapture(grabbed.pointerId);
    } catch {
      // 이미 해제됐으면 무시
    }
    grabbedRef.current = null;
  };

  const attachWindowDrag = () => {
    moveSchedulerRef.current = createRafLatestScheduler(
      applyWindowMove,
      continuousInputStrategy,
    );
    window.addEventListener('pointermove', handleWindowMove);
    window.addEventListener('pointerup', handleWindowUp);
    window.addEventListener('pointercancel', handleWindowCancel);
    window.addEventListener('blur', handleWindowBlur);
    detachRef.current = () => {
      window.removeEventListener('pointermove', handleWindowMove);
      window.removeEventListener('pointerup', handleWindowUp);
      window.removeEventListener('pointercancel', handleWindowCancel);
      window.removeEventListener('blur', handleWindowBlur);
      releaseGrabbed();
      moveSchedulerRef.current?.cancel();
      moveSchedulerRef.current = null;
      detachRef.current = null;
      dragRef.current = null;
      suppressNextClick();
    };
  };

  const beginRotateDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    end: GradientAxisEnd,
    addOnClick: boolean,
  ) => {
    if (event.button !== 0 || !session) return;
    stopAll(event);
    detachRef.current?.();
    grabPointer(event);
    dragRef.current = {
      type: 'rotate',
      pointerId: event.pointerId,
      end,
      ownerGeneration: useGradientEditStore.getState().generation,
      startSpec: session.spec,
      moved: false,
      addOnClick,
      angleOffset:
        session.spec.angle -
        pointerAngleFromClient(event.clientX, event.clientY, end),
      downX: event.clientX,
      downY: event.clientY,
    };
    attachWindowDrag();
  };

  // 축 히트 스트립 - 잡은 지점이 축의 어느 절반인지로 회전 기준 방향 결정
  const beginStripPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    // preventDefault가 기본 포커스 이동을 막으므로 명시 부여 - 화살표 각도 조절이
    // 그리드 키 이동으로 새지 않게 슬라이더가 포커스를 가져간다
    if (event.button === 0) {
      event.currentTarget.focus({ preventScroll: true });
    }
    const origin = clientOrigin();
    const geo = geoRef.current;
    const along =
      (event.clientX - origin.x) * (geo?.dirX ?? 0) +
      (event.clientY - origin.y) * (geo?.dirY ?? 0);
    beginRotateDrag(event, along >= 0 ? 'end' : 'start', true);
  };

  const beginAnchorRotate =
    (end: GradientAxisEnd) => (event: React.PointerEvent<HTMLDivElement>) =>
      beginRotateDrag(event, end, false);

  const beginStopDrag =
    (index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !session) return;
      stopAll(event);
      detachRef.current?.();
      grabPointer(event);
      session.selectStop(index);
      dragRef.current = {
        type: 'stop',
        pointerId: event.pointerId,
        index,
        moved: false,
        ownerGeneration: useGradientEditStore.getState().generation,
        startSpec: session.spec,
        lastPos: session.spec.stops[index]?.pos ?? 0.5,
        posOffset:
          (session.spec.stops[index]?.pos ?? 0.5) -
          projectionFromClient(event.clientX, event.clientY),
        downX: event.clientX,
        downY: event.clientY,
      };
      attachWindowDrag();
    };

  // 키보드 각도 조절 - 화살표 ±1°, Shift ±15° (슬라이더 시맨틱)
  const handleRotateKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!session) return;
    let delta = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 15 : 1;
    const next = normalizeGradientAxisAngle(session.spec.angle + delta * step);
    session.apply(toCanonicalGradient({ ...session.spec, angle: next }), true);
  };

  // 우클릭 삭제 - 최소 2개 유지 (피커 스톱 바와 동일 규칙)
  const handleStopContextMenu =
    (index: number) => (event: React.MouseEvent) => {
      if (!session) return;
      event.preventDefault();
      event.stopPropagation();
      if (session.spec.stops.length <= 2) return;
      const stops = session.spec.stops.filter(
        (_stop, stopIndex) => stopIndex !== index,
      );
      const nextSelected =
        session.selectedIndex > index
          ? session.selectedIndex - 1
          : Math.min(session.selectedIndex, stops.length - 1);
      session.selectStop(Math.max(0, nextSelected));
      session.apply(toCanonicalGradient({ ...session.spec, stops }), true);
    };

  return {
    rootRef,
    angle,
    geometry,
    dragStop,
    isRotating: dragAngle !== null,
    beginStripPointer,
    beginAnchorRotate,
    beginStopDrag,
    handleRotateKeyDown,
    handleStopContextMenu,
  };
};
