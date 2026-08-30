import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import {
  supportsActiveVisualState,
  useGradientEditStore,
} from '@stores/grid/useGradientEditStore';
import {
  toCanonicalGradient,
  GRADIENT_STOPS_MAX,
  type GradientSpec,
} from '@src/types/color';
import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';
import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';

/**
 * 온캔버스 그라데이션 축 - 피커가 그라데이션 형식으로 열려 있는 동안
 * 대상 요소 위에 축 선·앵커 점·색 스왓치를 그린다.
 * 축과 색은 완전 분리: 축 선·끝 앵커(흰 점) 드래그 = 각도만,
 * 색 스왓치(앵커 점 바로 위 태그) 드래그 = 축 위 위치만.
 * 축 선 클릭 = 스톱 추가, 스왓치 우클릭 = 삭제.
 * 모서리·변 중앙 방향 자석 스냅 기본, Ctrl/Cmd를 누르면 스냅 해제
 */

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GradientAxisOverlayProps {
  positions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  graphPositions?: Record<string, GraphItemPosition[] | undefined>;
  knobPositions?: Record<string, KnobItemPosition[] | undefined>;
  selectedElements: SelectedElement[];
  selectedKeyType: string;
  zoom: number;
  panX: number;
  panY: number;
  /** 성능 계측용 비교 전략. 제품 경로는 프레임당 최신 입력만 반영한다. */
  continuousInputStrategy?: ContinuousInputStrategy;
}

// 축 끝 회전 앵커 - 시각 점과 히트 영역(px)
const ANCHOR_DOT_SIZE = 7;
const ANCHOR_HIT_SIZE = 18;
// 스톱 표식 - 앵커 점은 선 위, 색 스왓치는 그 바로 위에 붙는 태그
const STOP_ANCHOR_DOT_SIZE = 5;
const SWATCH_SIZE = 15;
const SWATCH_LIFT = 16;
// 축 선의 드래그 히트 두께(px) - 시각 선은 1.5px, 잡는 영역은 넓게
const AXIS_HIT_THICKNESS = 12;
// 자석 스냅 판정 각도(도) - 모서리·변 중앙 방향에 이 범위 안이면 흡착
const MAGNET_THRESHOLD_DEG = 6;
// 클릭이 드래그로 승격되는 이동 임계값(px)
const DRAG_THRESHOLD_PX = 3;

type AxisEnd = 'start' | 'end';

type DragState =
  | {
      type: 'rotate';
      pointerId: number;
      end: AxisEnd;
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

const normalizeAngle = (deg: number): number => ((deg % 360) + 360) % 360;

const circularDistance = (a: number, b: number): number => {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, 360 - diff);
};

// 변 중앙 4방향 + 모서리 4방향 (요소 종횡비 반영)
const buildMagnetAngles = (width: number, height: number): number[] => {
  const corner = normalizeAngle(
    (Math.atan2(width / 2, height / 2) * 180) / Math.PI,
  );
  return [
    0,
    90,
    180,
    270,
    corner,
    normalizeAngle(180 - corner),
    normalizeAngle(180 + corner),
    normalizeAngle(360 - corner),
  ];
};

const stopAll = (e: React.SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

const GradientAxisOverlay = ({
  positions,
  statPositions,
  graphPositions,
  knobPositions,
  selectedElements,
  selectedKeyType,
  zoom,
  panX,
  panY,
  continuousInputStrategy = 'frame',
}: GradientAxisOverlayProps) => {
  const { t } = useTranslation();
  const session = useGradientEditStore((state) => state.session);
  // 카운터처럼 요소 저장 박스와 페인트 박스가 다른 표면이 등록한 실측 박스
  const registeredAnchorBounds = useGradientEditStore(
    (state) => state.anchorBounds,
  );
  // 피커 색 드래그 중 - 오버레이를 흐려 대상의 실제 색이 보이게 한다
  const colorAdjusting = useGradientEditStore((state) => state.colorAdjusting);
  const dragRef = useRef<DragState | null>(null);
  const [dragAngle, setDragAngle] = useState<number | null>(null);
  const [dragStop, setDragStop] = useState<{
    index: number;
    pos: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // window 드래그 핸들러가 리렌더와 무관하게 최신 값을 읽도록 ref로 노출
  const sessionRef = useRef(session);
  // eslint-disable-next-line react-hooks/refs
  sessionRef.current = session;
  const geoRef = useRef<{
    cx: number;
    cy: number;
    halfLine: number;
    dirX: number;
    dirY: number;
    magnetAngles: number[];
    worldW: number;
    worldH: number;
    zoom: number;
  } | null>(null);
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

  // 앵커 → 월드 bounds 해석
  const resolveBounds = (): Bounds | null => {
    if (!session) return null;
    // 표면 소유 레이어가 실측 박스를 등록했으면 우선 사용 - 카운터 표면은
    // 요소(키) 박스가 아니라 실제 카운터 텍스트 박스가 축의 기준이다
    if (registeredAnchorBounds?.sessionKey === session.sessionKey) {
      const { bounds, origin } = registeredAnchorBounds;
      const anchor = session.anchor;
      // 등록 후 요소가 이동하면 저장 좌표 델타로 실측 박스를 추종
      if (origin && anchor.kind !== 'batch') {
        const collection =
          anchor.kind === 'key'
            ? positions[selectedKeyType]
            : anchor.kind === 'stat'
            ? statPositions[selectedKeyType]
            : anchor.kind === 'graph'
            ? graphPositions?.[selectedKeyType]
            : knobPositions?.[selectedKeyType];
        const pos = collection?.find((position) => position.id === anchor.id);
        if (pos && (pos.dx !== origin.x || pos.dy !== origin.y)) {
          return {
            ...bounds,
            x: bounds.x + (pos.dx - origin.x),
            y: bounds.y + (pos.dy - origin.y),
          };
        }
      }
      return bounds;
    }
    const { anchor } = session;
    if (anchor.kind === 'batch') {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const el of selectedElements) {
        if (
          session.stateMode === 'active' &&
          !supportsActiveVisualState(el.type)
        ) {
          continue;
        }
        const collection =
          el.type === 'key'
            ? positions[selectedKeyType]
            : el.type === 'stat'
            ? statPositions[selectedKeyType]
            : el.type === 'graph'
            ? graphPositions?.[selectedKeyType]
            : el.type === 'knob'
            ? knobPositions?.[selectedKeyType]
            : undefined;
        const pos = collection?.find((position) => position.id === el.id);
        if (!pos) continue;
        const w = pos.width || (el.type === 'graph' ? 200 : 60);
        const h = pos.height || (el.type === 'graph' ? 100 : 60);
        minX = Math.min(minX, pos.dx);
        minY = Math.min(minY, pos.dy);
        maxX = Math.max(maxX, pos.dx + w);
        maxY = Math.max(maxY, pos.dy + h);
      }
      if (!Number.isFinite(minX)) return null;
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    const collection =
      anchor.kind === 'key'
        ? positions[selectedKeyType]
        : anchor.kind === 'stat'
        ? statPositions[selectedKeyType]
        : anchor.kind === 'graph'
        ? graphPositions?.[selectedKeyType]
        : knobPositions?.[selectedKeyType];
    const pos = collection?.find((position) => position.id === anchor.id);
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || (anchor.kind === 'graph' ? 200 : 60),
      height: pos.height || (anchor.kind === 'graph' ? 100 : 60),
    };
  };

  const bounds = resolveBounds();
  const missingSingleSessionKey =
    session && session.anchor.kind !== 'batch' && !bounds
      ? session.sessionKey
      : null;

  useEffect(() => {
    if (!missingSingleSessionKey) return;
    const store = useGradientEditStore.getState();
    if (store.session?.sessionKey === missingSingleSessionKey) {
      store.setSession(null);
    }
  }, [missingSingleSessionKey]);

  if (!session || !bounds) return null;

  const cx = (bounds.x + bounds.width / 2) * zoom + panX;
  const cy = (bounds.y + bounds.height / 2) * zoom + panY;
  const magnetAngles = buildMagnetAngles(bounds.width, bounds.height);

  const angle = dragAngle ?? session.spec.angle;
  const rad = (angle * Math.PI) / 180;
  // CSS linear-gradient: 0deg = 위, 시계 방향 - 화면 좌표(y 아래)로 변환
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  // CSS 그라데이션 라인 절반 길이 - pos 0/1이 이 지점에 해당
  const halfLine =
    ((Math.abs(bounds.width * Math.sin(rad)) +
      Math.abs(bounds.height * Math.cos(rad))) /
      2) *
    zoom;
  const endX = cx + dirX * halfLine;
  const endY = cy + dirY * halfLine;
  // pos(0~1) → 축 위 화면 좌표
  const stopPoint = (pos: number) => ({
    x: cx + dirX * (pos - 0.5) * 2 * halfLine,
    y: cy + dirY * (pos - 0.5) * 2 * halfLine,
  });

  // eslint-disable-next-line react-hooks/refs
  geoRef.current = {
    cx,
    cy,
    halfLine,
    dirX,
    dirY,
    magnetAngles,
    worldW: bounds.width,
    worldH: bounds.height,
    zoom,
  };

  // 화면(client) 기준 중심 - 드래그 중 휠 팬·줌으로 좌표가 움직여도
  // 매 이벤트에서 최신 지오메트리로 재계산한다
  const clientOrigin = () => {
    const hostRect = rootRef.current?.getBoundingClientRect();
    const geo = geoRef.current;
    return {
      x: (hostRect?.left ?? 0) + (geo?.cx ?? 0),
      y: (hostRect?.top ?? 0) + (geo?.cy ?? 0),
    };
  };

  // 포인터가 가리키는 축 각도 (보정·자석 이전의 원값)
  const pointerAngleFromClient = (
    clientX: number,
    clientY: number,
    end: AxisEnd,
  ): number => {
    const origin = clientOrigin();
    const raw =
      (Math.atan2(clientX - origin.x, origin.y - clientY) * 180) / Math.PI;
    // 시작점 쪽을 잡으면 축 반대 방향이 그라데이션 진행 방향
    return normalizeAngle(end === 'start' ? raw + 180 : raw);
  };

  const applyMagnet = (angle: number, magnetDisabled: boolean): number => {
    let next = normalizeAngle(Math.round(angle));
    if (!magnetDisabled) {
      for (const magnet of geoRef.current?.magnetAngles ?? []) {
        if (circularDistance(next, magnet) <= MAGNET_THRESHOLD_DEG) {
          next = magnet;
          break;
        }
      }
    }
    return normalizeAngle(Math.round(next));
  };

  const angleFromClient = (
    clientX: number,
    clientY: number,
    drag: Extract<DragState, { type: 'rotate' }>,
    magnetDisabled: boolean,
  ): number =>
    applyMagnet(
      pointerAngleFromClient(clientX, clientY, drag.end) + drag.angleOffset,
      magnetDisabled,
    );

  // 포인터의 축 투영 원값 - 잡은 지점 보정 후 호출부가 클램프
  const projectionFromClient = (clientX: number, clientY: number): number => {
    const origin = clientOrigin();
    const geo = geoRef.current;
    if (!geo || geo.halfLine === 0) return 0.5;
    const dx = clientX - origin.x;
    const dy = clientY - origin.y;
    return (dx * geo.dirX + dy * geo.dirY) / (2 * geo.halfLine) + 0.5;
  };

  const clampPos = (pos: number): number => Math.min(1, Math.max(0, pos));

  // 포인터를 축에 사영해 pos(0~1) 계산 - 클릭 지점 직접 사용 경로(스톱 추가)
  const posFromClient = (clientX: number, clientY: number): number =>
    clampPos(projectionFromClient(clientX, clientY));

  const currentSpec = () => sessionRef.current?.spec ?? session.spec;

  const stopsWithMovedIndex = (index: number, pos: number) =>
    currentSpec().stops.map((s, i) => (i === index ? { ...s, pos } : s));

  const commitStopDrag = (index: number, pos: number) => {
    const live = sessionRef.current;
    if (!live) return;
    const stops = stopsWithMovedIndex(index, pos);
    const next = toCanonicalGradient({ ...currentSpec(), stops });
    // canonical과 동일한 안정 정렬을 원본 인덱스 태그로 재현해 선택 재매핑
    const sortedIndexes = stops
      .map((s, i) => ({ i, pos: Math.min(1, Math.max(0, s.pos)) }))
      .sort((a, b) => a.pos - b.pos);
    const newIndex = sortedIndexes.findIndex((s) => s.i === index);
    if (newIndex >= 0) live.selectStop(newIndex);
    live.apply(next, true);
  };

  // 축 클릭 스톱 추가 - 색은 선택 스톱 기준 (피커 스톱 바와 동일 규칙)
  const addStopAt = (pos: number) => {
    const live = sessionRef.current;
    if (!live) return;
    const spec = currentSpec();
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
      (s) => s.pos === pos && s.color === color,
    );
    live.selectStop(newIndex >= 0 ? newIndex : next.stops.length - 1);
    live.apply(next, true);
  };

  // 드래그 소유 세션 검증 - 세션이 사라지거나 한 번이라도 교체되면 중단.
  // 세대 비교라 포인터 이벤트 사이의 A→B→새 A 왕복도 잡는다
  const ownedDrag = (e: PointerEvent): DragState | null => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return null;
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

  const applyWindowMove = (e: PointerEvent) => {
    const drag = ownedDrag(e);
    if (!drag) return;
    const live = sessionRef.current;
    if (!live) return;
    if (!drag.moved) {
      if (
        Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) <
        DRAG_THRESHOLD_PX
      ) {
        return;
      }
      drag.moved = true;
    }

    if (drag.type === 'rotate') {
      const next = angleFromClient(
        e.clientX,
        e.clientY,
        drag,
        e.ctrlKey || e.metaKey,
      );
      setDragAngle(next);
      live.apply({ ...currentSpec(), angle: next }, false);
      return;
    }

    // 스톱은 항상 현재 축에 사영 - 위치만 이동, 각도 불변, 잡은 지점 보정
    const pos = clampPos(
      projectionFromClient(e.clientX, e.clientY) + drag.posOffset,
    );
    drag.lastPos = pos;
    setDragStop({ index: drag.index, pos });
    live.apply(
      { ...currentSpec(), stops: stopsWithMovedIndex(drag.index, pos) },
      false,
    );
  };

  const handleWindowMove = (e: PointerEvent) => {
    const drag = ownedDrag(e);
    if (!drag) return;
    // 창 밖에서 버튼이 이미 떼졌으면 stale 드래그 - 커밋 없이 종료
    if (e.buttons === 0) {
      cancelActiveDrag();
      return;
    }
    moveSchedulerRef.current?.push(e);
  };

  const handleWindowUp = (e: PointerEvent) => {
    // 마지막 move 프리뷰를 먼저 반영해 moved 상태와 화면을 확정
    moveSchedulerRef.current?.flush();
    const drag = ownedDrag(e);
    if (!drag) return;
    detachRef.current?.();
    setDragAngle(null);
    setDragStop(null);
    const live = sessionRef.current;
    if (!live) return;
    if (drag.type === 'rotate') {
      if (!drag.moved) {
        // 클릭 - 축 히트 스트립이면 그 위치에 스톱 추가
        if (drag.addOnClick) addStopAt(posFromClient(e.clientX, e.clientY));
        return;
      }
      const finalAngle = angleFromClient(
        e.clientX,
        e.clientY,
        drag,
        e.ctrlKey || e.metaKey,
      );
      live.apply(
        toCanonicalGradient({ ...currentSpec(), angle: finalAngle }),
        true,
      );
      return;
    }
    if (!drag.moved) return; // 클릭 - 선택만
    // pointerup 좌표를 직접 사용해 마지막 프레임 사이 입력도 유실하지 않음
    commitStopDrag(
      drag.index,
      clampPos(projectionFromClient(e.clientX, e.clientY) + drag.posOffset),
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

  const handleWindowCancel = (e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    cancelActiveDrag();
  };

  // 창 포커스 상실 - pointerup이 오지 않으므로 유령 드래그 방지 취소
  const handleWindowBlur = () => cancelActiveDrag();

  // 드래그 제스처의 후속 click이 그리드 선택 해제로 새지 않게 1회 억제
  const suppressNextClick = () => {
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('click', swallow, true);
    };
    window.addEventListener('click', swallow, true);
    // click이 아예 안 오는 경로(cancel 등) 대비 - 다음 틱에 정리
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };

  // 프레스 즉시 grabbing - 키와 같은 정책(호버 무변화, 잡는 동안만 grabbing).
  // pointerdown preventDefault로 :active가 안 걸리고, 캡처 중에도 커서는
  // 히트테스트 기준(크로뮴)이라 문서 전역 클래스로 드래그 내내 고정한다
  const grabPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // 미지원 환경은 커서 고정 없이 동작만 유지
    }
    beginDragCursor('grabbing', el.ownerDocument);
    grabbedRef.current = { el, pointerId: e.pointerId };
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
    e: React.PointerEvent<HTMLDivElement>,
    end: AxisEnd,
    addOnClick: boolean,
  ) => {
    if (e.button !== 0) return;
    stopAll(e);
    detachRef.current?.();
    grabPointer(e);
    dragRef.current = {
      type: 'rotate',
      pointerId: e.pointerId,
      end,
      ownerGeneration: useGradientEditStore.getState().generation,
      startSpec: session.spec,
      moved: false,
      addOnClick,
      angleOffset:
        session.spec.angle - pointerAngleFromClient(e.clientX, e.clientY, end),
      downX: e.clientX,
      downY: e.clientY,
    };
    attachWindowDrag();
  };

  // 축 히트 스트립 - 잡은 지점이 축의 어느 절반인지로 회전 기준 방향 결정
  const beginStripPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    // preventDefault가 기본 포커스 이동을 막으므로 명시 부여 - 화살표 각도 조절이
    // 그리드 키 이동으로 새지 않게 슬라이더가 포커스를 가져간다
    if (e.button === 0) {
      e.currentTarget.focus({ preventScroll: true });
    }
    const origin = clientOrigin();
    const geo = geoRef.current;
    const along =
      (e.clientX - origin.x) * (geo?.dirX ?? 0) +
      (e.clientY - origin.y) * (geo?.dirY ?? 0);
    beginRotateDrag(e, along >= 0 ? 'end' : 'start', true);
  };

  const beginAnchorRotate =
    (end: AxisEnd) => (e: React.PointerEvent<HTMLDivElement>) =>
      beginRotateDrag(e, end, false);

  const beginStopDrag =
    (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      stopAll(e);
      detachRef.current?.();
      grabPointer(e);
      session.selectStop(index);
      dragRef.current = {
        type: 'stop',
        pointerId: e.pointerId,
        index,
        moved: false,
        ownerGeneration: useGradientEditStore.getState().generation,
        startSpec: session.spec,
        lastPos: session.spec.stops[index]?.pos ?? 0.5,
        posOffset:
          (session.spec.stops[index]?.pos ?? 0.5) -
          projectionFromClient(e.clientX, e.clientY),
        downX: e.clientX,
        downY: e.clientY,
      };
      attachWindowDrag();
    };

  // 키보드 각도 조절 - 화살표 ±1°, Shift ±15° (슬라이더 시맨틱)
  const handleRotateKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let delta = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 15 : 1;
    const next = normalizeAngle(session.spec.angle + delta * step);
    session.apply(toCanonicalGradient({ ...session.spec, angle: next }), true);
  };

  // 우클릭 삭제 - 최소 2개 유지 (피커 스톱 바와 동일 규칙)
  const handleStopContextMenu = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (session.spec.stops.length <= 2) return;
    const stops = session.spec.stops.filter((_, i) => i !== index);
    const nextSelected =
      session.selectedIndex > index
        ? session.selectedIndex - 1
        : Math.min(session.selectedIndex, stops.length - 1);
    session.selectStop(Math.max(0, nextSelected));
    session.apply(toCanonicalGradient({ ...session.spec, stops }), true);
  };

  const isRotating = dragAngle !== null;
  const dragStopScreen = dragStop ? stopPoint(dragStop.pos) : null;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 pointer-events-none"
      // 리사이즈 핸들 위, 사이드 패널 아래에 두는 내부 편집 층 - 패널 위로 새지 않게
      style={{ zIndex: 'var(--z-canvas-gradient-editor)' }}
      data-dmn-gradient-overlay="true"
    >
      {/* 조작 UI 묶음 - 핸들 드래그나 피커 색 드래그 동안 흐려져
          가려진 대상의 실제 색이 보인다. 값 배지는 묶음 밖이라 선명 유지 */}
      <div
        className="absolute inset-0 pointer-events-none"
        data-dmn-gradient-axis-ui="true"
        style={{
          opacity: colorAdjusting || isRotating || dragStop ? 0.12 : 1,
          transition: 'opacity 120ms ease',
        }}
      >
        {/* 축 선 (시각) */}
        <div
          style={{
            position: 'absolute',
            left: cx,
            top: cy,
            width: halfLine * 2,
            height: 0,
            borderTop: '1.5px solid var(--ui-selection-border-strong)',
            transform: `translate(-50%, -50%) rotate(${angle - 90}deg)`,
            opacity: 0.9,
            pointerEvents: 'none',
          }}
        />
        {/* 축 히트 스트립 - 드래그 = 회전, 클릭 = 스톱 추가, 화살표 = 미세 조절 */}
        <div
          role="slider"
          tabIndex={0}
          // 마우스로 잡은 뒤 방향키 미세 조정이 설계된 컨트롤 - 잔류 포커스 가드 제외
          data-dmn-pointer-focus="retain"
          aria-label={t('colorPicker.gradientAngle')}
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={Math.round(angle)}
          className="outline-none focus-visible:shadow-focus-ring"
          onPointerDown={beginStripPointer}
          onKeyDown={handleRotateKeyDown}
          onMouseDown={stopAll}
          style={{
            position: 'absolute',
            left: cx,
            top: cy,
            width: halfLine * 2,
            height: AXIS_HIT_THICKNESS,
            transform: `translate(-50%, -50%) rotate(${angle - 90}deg)`,
            cursor: isRotating ? 'grabbing' : 'default',
            pointerEvents: 'auto',
            touchAction: 'none',
          }}
        />
        {/* 축 끝 앵커 - 선 끝점 위 흰 점, 드래그로 각도만 조절 */}
        {(['start', 'end'] as AxisEnd[]).map((end) => {
          const point = stopPoint(end === 'end' ? 1 : 0);
          return (
            <div
              key={`axis-${end}`}
              data-axis-anchor={end}
              aria-hidden="true"
              onPointerDown={beginAnchorRotate(end)}
              onMouseDown={stopAll}
              style={{
                position: 'absolute',
                left: point.x,
                top: point.y,
                width: ANCHOR_HIT_SIZE,
                height: ANCHOR_HIT_SIZE,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: 'translate(-50%, -50%)',
                cursor: isRotating ? 'grabbing' : 'default',
                pointerEvents: 'auto',
                touchAction: 'none',
              }}
            >
              <i
                style={{
                  display: 'block',
                  width: ANCHOR_DOT_SIZE,
                  height: ANCHOR_DOT_SIZE,
                  borderRadius: '50%',
                  background: 'white',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                }}
              />
            </div>
          );
        })}
        {/* 스톱 - 앵커 점은 선 위, 색 스왓치는 바로 위 태그. 드래그 = 위치, 우클릭 = 삭제 */}
        {session.spec.stops.map((stop, i) => {
          const point = stopPoint(stop.pos);
          const isAxisEnd = stop.pos === 0 || stop.pos === 1;
          return (
            <React.Fragment key={`stop-${i}`}>
              {!isAxisEnd && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: point.x,
                    top: point.y,
                    width: STOP_ANCHOR_DOT_SIZE,
                    height: STOP_ANCHOR_DOT_SIZE,
                    borderRadius: '50%',
                    background: 'white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              <div
                role="button"
                aria-label={`stop ${i + 1}`}
                onPointerDown={beginStopDrag(i)}
                onMouseDown={stopAll}
                onContextMenu={handleStopContextMenu(i)}
                style={{
                  position: 'absolute',
                  left: point.x,
                  top: point.y - SWATCH_LIFT,
                  width: SWATCH_SIZE,
                  height: SWATCH_SIZE,
                  borderRadius: 4,
                  // 반투명 색은 격자 위 합성으로 표시 - 뒤 요소 비침 방지
                  background: `linear-gradient(${stop.color}, ${stop.color}), var(--ui-checker-pattern) center / var(--ui-checker-size-sm) var(--ui-checker-size-sm) repeat`,
                  border: '1.5px solid white',
                  boxShadow:
                    i === session.selectedIndex
                      ? '0 0 0 2px var(--ui-selection-border-strong), 0 1px 4px rgba(0,0,0,0.5)'
                      : '0 1px 4px rgba(0,0,0,0.5)',
                  transform: 'translate(-50%, -50%)',
                  cursor: dragStop?.index === i ? 'grabbing' : 'default',
                  pointerEvents: 'auto',
                  touchAction: 'none',
                }}
              />
            </React.Fragment>
          );
        })}
      </div>
      {/* 드래그 중 각도 표시 */}
      {isRotating && (
        <div
          className="text-caption text-fg tabular-nums"
          style={{
            position: 'absolute',
            left: endX + 12,
            top: endY - 24,
            padding: '2px 6px',
            borderRadius: 6,
            background: 'var(--ui-bg-inset-solid, rgba(24,24,29,0.9))',
            boxShadow: 'inset 0 0 0 1px var(--ui-line)',
            whiteSpace: 'nowrap',
          }}
        >
          {angle}°
        </div>
      )}
      {/* 스톱 드래그 중 위치 표시 */}
      {dragStop && dragStopScreen && (
        <div
          className="text-caption text-fg tabular-nums"
          style={{
            position: 'absolute',
            left: dragStopScreen.x + 12,
            top: dragStopScreen.y - 24,
            padding: '2px 6px',
            borderRadius: 6,
            background: 'var(--ui-bg-inset-solid, rgba(24,24,29,0.9))',
            boxShadow: 'inset 0 0 0 1px var(--ui-line)',
            whiteSpace: 'nowrap',
          }}
        >
          {Math.round(dragStop.pos * 100)}%
        </div>
      )}
    </div>
  );
};

export default GradientAxisOverlay;
