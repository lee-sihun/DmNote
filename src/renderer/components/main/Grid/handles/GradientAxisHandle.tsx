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

/**
 * 온캔버스 그라데이션 축 — 피커가 그라데이션 형식으로 열려 있는 동안
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
}

// 축 끝 회전 앵커 — 시각 점과 히트 영역(px)
const ANCHOR_DOT_SIZE = 7;
const ANCHOR_HIT_SIZE = 18;
// 스톱 표식 — 앵커 점은 선 위, 색 스왓치는 그 바로 위에 붙는 태그
const STOP_ANCHOR_DOT_SIZE = 5;
const SWATCH_SIZE = 15;
const SWATCH_LIFT = 16;
// 축 선의 드래그 히트 두께(px) — 시각 선은 1.5px, 잡는 영역은 넓게
const AXIS_HIT_THICKNESS = 12;
// 자석 스냅 판정 각도(도) — 모서리·변 중앙 방향에 이 범위 안이면 흡착
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
      /** 이동 없이 떼면 그 자리에 스톱 추가 — 축 히트 스트립 한정 */
      addOnClick: boolean;
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
}: GradientAxisOverlayProps) => {
  const { t } = useTranslation();
  const session = useGradientEditStore((state) => state.session);
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
  // 드래그 세션 해제자 — begin에서 등록, 종료 경로 어디서든 1회 실행
  const detachRef = useRef<(() => void) | null>(null);

  // 드래그 중 언마운트(피커 닫힘 등)에도 window 리스너 정리
  useEffect(() => () => detachRef.current?.(), []);

  if (!session) return null;

  // 앵커 → 월드 bounds 해석
  const resolveBounds = (): Bounds | null => {
    const { anchor } = session;
    if (anchor.kind === 'batch') {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const el of selectedElements) {
        if (el.index === undefined) continue;
        if (
          session.stateMode === 'active' &&
          !supportsActiveVisualState(el.type)
        ) {
          continue;
        }
        const pos =
          el.type === 'key'
            ? positions[selectedKeyType]?.[el.index]
            : el.type === 'stat'
            ? statPositions[selectedKeyType]?.[el.index]
            : el.type === 'graph'
            ? graphPositions?.[selectedKeyType]?.[el.index]
            : el.type === 'knob'
            ? knobPositions?.[selectedKeyType]?.[el.index]
            : undefined;
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

    const pos =
      anchor.kind === 'key'
        ? positions[selectedKeyType]?.[anchor.index]
        : anchor.kind === 'stat'
        ? statPositions[selectedKeyType]?.[anchor.index]
        : anchor.kind === 'graph'
        ? graphPositions?.[selectedKeyType]?.[anchor.index]
        : knobPositions?.[selectedKeyType]?.[anchor.index];
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || (anchor.kind === 'graph' ? 200 : 60),
      height: pos.height || (anchor.kind === 'graph' ? 100 : 60),
    };
  };

  const bounds = resolveBounds();
  if (!bounds) return null;

  const cx = (bounds.x + bounds.width / 2) * zoom + panX;
  const cy = (bounds.y + bounds.height / 2) * zoom + panY;
  const magnetAngles = buildMagnetAngles(bounds.width, bounds.height);

  const angle = dragAngle ?? session.spec.angle;
  const rad = (angle * Math.PI) / 180;
  // CSS linear-gradient: 0deg = 위, 시계 방향 — 화면 좌표(y 아래)로 변환
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  // CSS 그라데이션 라인 절반 길이 — pos 0/1이 이 지점에 해당
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

  // 화면(client) 기준 중심 — 드래그 중 휠 팬·줌으로 좌표가 움직여도
  // 매 이벤트에서 최신 지오메트리로 재계산한다
  const clientOrigin = () => {
    const hostRect = rootRef.current?.getBoundingClientRect();
    const geo = geoRef.current;
    return {
      x: (hostRect?.left ?? 0) + (geo?.cx ?? 0),
      y: (hostRect?.top ?? 0) + (geo?.cy ?? 0),
    };
  };

  const angleFromClient = (
    clientX: number,
    clientY: number,
    end: AxisEnd,
    magnetDisabled: boolean,
  ): number => {
    const origin = clientOrigin();
    const raw =
      (Math.atan2(clientX - origin.x, origin.y - clientY) * 180) / Math.PI;
    // 시작점 쪽을 잡으면 축 반대 방향이 그라데이션 진행 방향
    let next = normalizeAngle(Math.round(end === 'start' ? raw + 180 : raw));
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

  // 포인터를 축에 사영해 pos(0~1) 계산
  const posFromClient = (clientX: number, clientY: number): number => {
    const origin = clientOrigin();
    const geo = geoRef.current;
    if (!geo || geo.halfLine === 0) return 0.5;
    const dx = clientX - origin.x;
    const dy = clientY - origin.y;
    const projected =
      (dx * geo.dirX + dy * geo.dirY) / (2 * geo.halfLine) + 0.5;
    return Math.min(1, Math.max(0, projected));
  };

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

  // 축 클릭 스톱 추가 — 색은 선택 스톱 기준 (피커 스톱 바와 동일 규칙)
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

  // 드래그 소유 세션 검증 — 세션이 사라지거나 한 번이라도 교체되면 중단.
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

  const handleWindowMove = (e: PointerEvent) => {
    const drag = ownedDrag(e);
    if (!drag) return;
    // 창 밖에서 버튼이 이미 떼졌으면 stale 드래그 — 커밋 없이 종료
    if (e.buttons === 0) {
      cancelActiveDrag();
      return;
    }
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
        drag.end,
        e.ctrlKey || e.metaKey,
      );
      setDragAngle(next);
      live.apply({ ...currentSpec(), angle: next }, false);
      return;
    }

    // 스톱은 항상 현재 축에 사영 — 위치만 이동, 각도 불변
    const pos = posFromClient(e.clientX, e.clientY);
    drag.lastPos = pos;
    setDragStop({ index: drag.index, pos });
    live.apply(
      { ...currentSpec(), stops: stopsWithMovedIndex(drag.index, pos) },
      false,
    );
  };

  const handleWindowUp = (e: PointerEvent) => {
    const drag = ownedDrag(e);
    if (!drag) return;
    detachRef.current?.();
    setDragAngle(null);
    setDragStop(null);
    const live = sessionRef.current;
    if (!live) return;
    if (drag.type === 'rotate') {
      if (!drag.moved) {
        // 클릭 — 축 히트 스트립이면 그 위치에 스톱 추가
        if (drag.addOnClick) addStopAt(posFromClient(e.clientX, e.clientY));
        return;
      }
      const finalAngle = angleFromClient(
        e.clientX,
        e.clientY,
        drag.end,
        e.ctrlKey || e.metaKey,
      );
      live.apply(
        toCanonicalGradient({ ...currentSpec(), angle: finalAngle }),
        true,
      );
      return;
    }
    if (!drag.moved) return; // 클릭 — 선택만
    commitStopDrag(drag.index, drag.lastPos);
  };

  // 취소 — preview로 반영된 변경을 시작 시점 spec으로 복원
  const cancelActiveDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    detachRef.current?.();
    setDragAngle(null);
    setDragStop(null);
    const live = sessionRef.current;
    // 세대가 드래그 시작 시점 그대로일 때만 복원 — 포인터 이벤트 없이
    // A→B→새 A로 교체된 세션에 stale 롤백이 새지 않게
    if (
      live &&
      drag.ownerGeneration === useGradientEditStore.getState().generation
    ) {
      live.apply(drag.startSpec, false);
    }
  };

  const handleWindowCancel = (e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    cancelActiveDrag();
  };

  // 창 포커스 상실 — pointerup이 오지 않으므로 유령 드래그 방지 취소
  const handleWindowBlur = () => cancelActiveDrag();

  // 드래그 제스처의 후속 click이 그리드 선택 해제로 새지 않게 1회 억제
  const suppressNextClick = () => {
    const swallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('click', swallow, true);
    };
    window.addEventListener('click', swallow, true);
    // click이 아예 안 오는 경로(cancel 등) 대비 — 다음 틱에 정리
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };

  const attachWindowDrag = () => {
    window.addEventListener('pointermove', handleWindowMove);
    window.addEventListener('pointerup', handleWindowUp);
    window.addEventListener('pointercancel', handleWindowCancel);
    window.addEventListener('blur', handleWindowBlur);
    detachRef.current = () => {
      window.removeEventListener('pointermove', handleWindowMove);
      window.removeEventListener('pointerup', handleWindowUp);
      window.removeEventListener('pointercancel', handleWindowCancel);
      window.removeEventListener('blur', handleWindowBlur);
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
    dragRef.current = {
      type: 'rotate',
      pointerId: e.pointerId,
      end,
      ownerGeneration: useGradientEditStore.getState().generation,
      startSpec: session.spec,
      moved: false,
      addOnClick,
      downX: e.clientX,
      downY: e.clientY,
    };
    attachWindowDrag();
  };

  // 축 히트 스트립 — 잡은 지점이 축의 어느 절반인지로 회전 기준 방향 결정
  const beginStripPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    // preventDefault가 기본 포커스 이동을 막으므로 명시 부여 — 화살표 각도 조절이
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
      session.selectStop(index);
      dragRef.current = {
        type: 'stop',
        pointerId: e.pointerId,
        index,
        moved: false,
        ownerGeneration: useGradientEditStore.getState().generation,
        startSpec: session.spec,
        lastPos: session.spec.stops[index]?.pos ?? 0.5,
        downX: e.clientX,
        downY: e.clientY,
      };
      attachWindowDrag();
    };

  // 키보드 각도 조절 — 화살표 ±1°, Shift ±15° (슬라이더 시맨틱)
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

  // 우클릭 삭제 — 최소 2개 유지 (피커 스톱 바와 동일 규칙)
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
      // 리사이즈 핸들(21~25) 위, 사이드 패널(z-30) 아래 — 패널 위로 새지 않게
      style={{ zIndex: 26 }}
      data-dmn-gradient-overlay="true"
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
      {/* 축 히트 스트립 — 드래그 = 회전, 클릭 = 스톱 추가, 화살표 = 미세 조절 */}
      <div
        role="slider"
        tabIndex={0}
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
          cursor: isRotating ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
          touchAction: 'none',
        }}
      />
      {/* 축 끝 앵커 — 선 끝점 위 흰 점, 드래그로 각도만 조절 */}
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
              cursor: isRotating ? 'grabbing' : 'grab',
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
      {/* 스톱 — 앵커 점은 선 위, 색 스왓치는 바로 위 태그. 드래그 = 위치, 우클릭 = 삭제 */}
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
                // 반투명 색은 격자 위 합성으로 표시 — 뒤 요소 비침 방지
                background: `linear-gradient(${stop.color}, ${stop.color}), var(--ui-checker-pattern) center / var(--ui-checker-size-sm) var(--ui-checker-size-sm) repeat`,
                border: '1.5px solid white',
                boxShadow:
                  i === session.selectedIndex
                    ? '0 0 0 2px var(--ui-selection-border-strong), 0 1px 4px rgba(0,0,0,0.5)'
                    : '0 1px 4px rgba(0,0,0,0.5)',
                transform: 'translate(-50%, -50%)',
                cursor: dragStop?.index === i ? 'grabbing' : 'grab',
                pointerEvents: 'auto',
                touchAction: 'none',
              }}
            />
          </React.Fragment>
        );
      })}
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
