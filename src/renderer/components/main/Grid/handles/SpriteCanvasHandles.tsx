'use no memo';
// 렌더 중 ref 대입(세션·지오메트리 최신화)이 React Compiler bailout이라
// 컴파일 대상에서 빠진다. 조용한 제외와 구분되게 명시한다 (GradientAxisHandle과 같은 이유)
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import {
  useSpritePoseHandleStore,
  type SpritePoseHandleSession,
} from '@stores/grid/useSpritePoseHandleStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { spriteItemsApi } from '@api/modules/itemsApi';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import {
  SPRITE_CONSTRAINTS,
  type ReactiveSpritePosition,
  type SpriteAnchor,
  type SpriteTransform,
} from '@src/types/key/sprites';
import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  SPRITE_ANCHOR_PRESETS,
  spritePivotPx,
} from '@utils/sprite/spriteGeometry';
import { spritePivotChangePatch } from '@utils/sprite/spritePlacement';
import { clamp } from '@utils/core/clamp';
import { suppressNextClick } from '@utils/dom/suppressNextClick';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';
import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';
import {
  releaseDragSession,
  tryAcquireDragSession,
} from '@hooks/Grid/dragSession';

/**
 * 온캔버스 스프라이트 핸들.
 * 스프라이트가 선택돼 있으면 기준점 십자를 그리고 드래그로 옮긴다 (9점 자석 스냅,
 * Ctrl/Cmd로 해제). 기준점을 옮겨도 그림은 움직이지 않는다 - 자세 이동값을 함께 보정.
 * 자세 팝업이 열려 있으면 자세 이미지 프레임을 그린다: 본체 드래그 = 위치,
 * 위쪽 노브 = 회전(Shift 15° 스냅), 모서리 = 배율(기준점 중심).
 * 배치는 GradientAxisOverlay와 동일한 비스케일 오버레이 층 - zoom/pan을 직접 계산
 */

interface SpriteCanvasHandlesProps {
  spritePositions: Record<string, ReactiveSpritePosition[] | undefined>;
  selectedElements: SelectedElement[];
  selectedKeyType: string;
  zoom: number;
  panX: number;
  panY: number;
}

type DragKind = 'pivot' | 'move' | 'rotate' | 'scale';

interface Point {
  x: number;
  y: number;
}

interface DragState {
  kind: DragKind;
  pointerId: number;
  start: Point;
  /** 드래그 시작 시점 자세 transform (자세 핸들) */
  baseTransform: SpriteTransform;
  /** 시작 시점 세션 - 스토어 세션이 먼저 닫혀도 cancel 배선을 유지한다 */
  session: SpritePoseHandleSession | null;
  /** 기준점 드래그의 canonical 스프라이트와 문서 좌표 */
  pivotBase: {
    mode: string;
    id: string;
    canonical: ReactiveSpritePosition;
    /** 십자가 따라가는 이동값 - 자세 편집 중이면 그 자세의 값 */
    translate: Point;
  } | null;
  /** 회전 축의 화면 좌표와 시작 각도·거리 */
  axisScreen: Point;
  startAngle: number;
  startDistance: number;
}

const KNOB_HIT_SIZE = 22;
const PIVOT_SNAP_PX = 8;
const ROTATE_KNOB_OFFSET_PX = 22;
const ROTATE_SNAP_DEG = 15;
// 축과 겹친 모서리는 배율 방향이 정의되지 않아 잡지 않는다
const MIN_SCALE_ARM_PX = 2;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// atan2 차(-360~360도)를 최단 호 표현(-180~180]으로 접는다
const wrapDegrees = (deg: number): number => {
  const wrapped = ((deg + 540) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
};

const SpriteCanvasHandles = ({
  spritePositions,
  selectedElements,
  selectedKeyType,
  zoom,
  panX,
  panY,
}: SpriteCanvasHandlesProps) => {
  const { t } = useTranslation();
  const session = useSpritePoseHandleStore((state) => state.session);

  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const grabbedRef = useRef<{ el: Element; pointerId: number } | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const moveSchedulerRef = useRef<ReturnType<
    typeof createRafLatestScheduler<PointerEvent>
  > | null>(null);
  const ownerGenerationRef = useRef(0);
  const lastTransformRef = useRef<SpriteTransform | null>(null);
  const lastPivotPatchRef = useRef<ReturnType<
    typeof spritePivotChangePatch
  > | null>(null);

  // 드래그 중 로컬 표시값 - preview 채널과 별개로 핸들을 즉시 따라가게 한다
  const [dragTransform, setDragTransform] = useState<SpriteTransform | null>(
    null,
  );
  const [dragPivot, setDragPivot] = useState<SpriteAnchor | null>(null);

  const selected = selectedElements.length === 1 ? selectedElements[0] : null;
  const sprite =
    selected && selected.type === 'sprite'
      ? spritePositions[selectedKeyType]?.find(
          (candidate) => candidate.id === selected.id,
        ) ?? null
      : null;

  // 드래그 도중 휠 팬·줌이 좌표를 움직여도 매 이벤트에서 최신 지오메트리로
  // 재계산한다 (GradientAxisHandle과 같은 이유의 렌더 중 ref 대입)
  const viewRef = useRef({ zoom, panX, panY });
  // eslint-disable-next-line react-hooks/refs
  viewRef.current = { zoom, panX, panY };
  const sessionRef = useRef(session);
  // eslint-disable-next-line react-hooks/refs
  sessionRef.current = session;

  // 활성 드래그 취소 배선 - 세션 종료·대상 교체·언마운트에서
  // window 리스너·포인터 캡처·전역 드래그 락·열린 preview 제스처를 함께 정리한다
  const cancelDragRef = useRef<(() => void) | null>(null);
  const ownerKey = session
    ? `${session.positionId}\n${session.poseId}`
    : sprite
    ? sprite.id
    : null;
  useEffect(() => {
    if (dragRef.current) cancelDragRef.current?.();
  }, [ownerKey]);
  useEffect(() => () => cancelDragRef.current?.(), []);

  // undo/redo 반영은 대상도 세대도 바꾸지 않아 위 배선에 걸리지 않는다. 그대로 두면
  // 저장값이 되돌아간 뒤 pointerup이 시작 시점 값으로 푼 결과를 다시 커밋한다
  const historyTick = useCommittedApplyStore((state) => state.historyTick);
  const historyTickRef = useRef(historyTick);
  useEffect(() => {
    if (historyTickRef.current === historyTick) return;
    historyTickRef.current = historyTick;
    if (dragRef.current) cancelDragRef.current?.();
  }, [historyTick]);

  if (!sprite && !session) {
    if (dragTransform !== null || dragPivot !== null) {
      // 대상이 사라지면 로컬 드래그 상태도 함께 비운다 (렌더 중 보정 패턴)
      setDragTransform(null);
      setDragPivot(null);
    }
    return null;
  }

  // 기하의 원천 - 세션이 있으면 세션(자세 편집 대상), 없으면 선택 스프라이트
  const origin = session ? session.origin : { dx: sprite!.dx, dy: sprite!.dy };
  const box = session
    ? { width: session.width, height: session.height }
    : { width: sprite!.width, height: sprite!.height };
  const pivot = dragPivot ?? (session ? session.pivot : sprite!.pivot);
  const displayTransform =
    dragTransform ?? (session ? session.transform : sprite!.idleTransform);
  const axis = spritePivotPx({ ...box, pivot });

  const toScreen = (local: Point): Point => ({
    x: (origin.dx + local.x) * zoom + panX,
    y: (origin.dy + local.y) * zoom + panY,
  });
  // 십자는 화면에서 실제로 회전이 일어나는 점 - 축에 이동값이 더해진다
  const pivotScreen = toScreen({
    x: axis.x + displayTransform.x,
    y: axis.y + displayTransform.y,
  });

  const clientToLocal = (clientX: number, clientY: number): Point | null => {
    const hostRect = rootRef.current?.getBoundingClientRect();
    if (!hostRect) return null;
    const view = viewRef.current;
    return {
      x: (clientX - hostRect.left - view.panX) / view.zoom - origin.dx,
      y: (clientY - hostRect.top - view.panY) / view.zoom - origin.dy,
    };
  };

  const clientToScreen = (clientX: number, clientY: number): Point | null => {
    const hostRect = rootRef.current?.getBoundingClientRect();
    if (!hostRect) return null;
    return { x: clientX - hostRect.left, y: clientY - hostRect.top };
  };

  // 자세 프레임 - 배치 rect의 네 모서리에 자세 변환을 적용한 화면 폴리곤.
  // 한 점 u는 t + P + sR(u − P)에 놓인다
  const poseCorners = (() => {
    if (!session) return null;
    const { rect } = session.placement;
    const rad = displayTransform.rotation * DEG_TO_RAD;
    const cos = Math.cos(rad) * displayTransform.scale;
    const sin = Math.sin(rad) * displayTransform.scale;
    const corners: Point[] = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ];
    return corners.map((corner) => {
      const dx = corner.x - axis.x;
      const dy = corner.y - axis.y;
      return toScreen({
        x: displayTransform.x + axis.x + dx * cos - dy * sin,
        y: displayTransform.y + axis.y + dx * sin + dy * cos,
      });
    });
  })();

  // 회전 노브 - 프레임 윗변 중앙에서 바깥쪽으로 고정 거리
  const rotateKnob = (() => {
    if (!poseCorners) return null;
    const top = {
      x: (poseCorners[0].x + poseCorners[1].x) / 2,
      y: (poseCorners[0].y + poseCorners[1].y) / 2,
    };
    const bottom = {
      x: (poseCorners[2].x + poseCorners[3].x) / 2,
      y: (poseCorners[2].y + poseCorners[3].y) / 2,
    };
    const ux = top.x - bottom.x;
    const uy = top.y - bottom.y;
    const length = Math.hypot(ux, uy);
    if (length < 1e-3)
      return {
        anchor: top,
        knob: { x: top.x, y: top.y - ROTATE_KNOB_OFFSET_PX },
      };
    return {
      anchor: top,
      knob: {
        x: top.x + (ux / length) * ROTATE_KNOB_OFFSET_PX,
        y: top.y + (uy / length) * ROTATE_KNOB_OFFSET_PX,
      },
    };
  })();

  const generationNow = () => useSpritePoseHandleStore.getState().generation;
  // 드래그 시작 때 잡은 세대가 아직 유효한지 - preview·커밋의 공통 전제
  const ownsSession = () => ownerGenerationRef.current === generationNow();

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

  const finishDrag = () => {
    if (!dragRef.current) return;
    cancelDragRef.current = null;
    releaseDragSession();
    releaseGrabbed();
    moveSchedulerRef.current?.cancel();
    moveSchedulerRef.current = null;
    detachRef.current?.();
    detachRef.current = null;
    dragRef.current = null;
    setDragTransform(null);
    setDragPivot(null);
    lastTransformRef.current = null;
    lastPivotPatchRef.current = null;
    suppressNextClick();
  };

  const cancelActiveDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    // 스토어 세션이 먼저 닫혔어도 시작 시점 세션으로 preview 제스처를 닫는다
    if (drag.kind === 'pivot') editGestureController.cancel();
    else drag.session?.cancel();
    finishDrag();
  };

  // 기준점 드래그 - 포인터를 이미지 정규화 좌표로 되돌리고 9점에 자석 스냅
  const pivotFromPointer = (
    drag: DragState,
    clientX: number,
    clientY: number,
    snapDisabled: boolean,
  ): SpriteAnchor | null => {
    const local = clientToLocal(clientX, clientY);
    const screen = clientToScreen(clientX, clientY);
    const base = drag.pivotBase;
    if (!local || !screen || !base) return null;
    const { width, height } = base.canonical;
    const next: SpriteAnchor = {
      x: clamp01((local.x - base.translate.x) / width),
      y: clamp01((local.y - base.translate.y) / height),
    };
    if (snapDisabled) return next;
    const view = viewRef.current;
    for (const preset of SPRITE_ANCHOR_PRESETS) {
      const presetScreen = {
        x:
          (base.canonical.dx + base.translate.x + preset.x * width) *
            view.zoom +
          view.panX,
        y:
          (base.canonical.dy + base.translate.y + preset.y * height) *
            view.zoom +
          view.panY,
      };
      if (
        Math.hypot(presetScreen.x - screen.x, presetScreen.y - screen.y) <=
        PIVOT_SNAP_PX
      ) {
        return { x: preset.x, y: preset.y };
      }
    }
    return next;
  };

  const previewPivotPatch = (drag: DragState, next: SpriteAnchor) => {
    const base = drag.pivotBase;
    if (!base) return;
    const patch = spritePivotChangePatch(base.canonical, next);
    lastPivotPatchRef.current = patch;
    setDragPivot(next);
    editGestureController.preview(base.mode, [{ id: base.id, patch }], {
      domain: 'spritePosition',
    });
  };

  const applyWindowMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pivot') {
      const next = pivotFromPointer(
        drag,
        event.clientX,
        event.clientY,
        event.ctrlKey || event.metaKey,
      );
      if (next) previewPivotPatch(drag, next);
      return;
    }
    const live = sessionRef.current;
    if (!live) return;
    // 소유권이 갈린 뒤의 move는 이미 취소된 preview를 되열 뿐이라 버린다
    if (!ownsSession()) return;
    const screen = clientToScreen(event.clientX, event.clientY);
    if (!screen) return;
    const { offset, rotation, scale } = SPRITE_CONSTRAINTS;
    let next: SpriteTransform;
    if (drag.kind === 'move') {
      const view = viewRef.current;
      next = {
        ...drag.baseTransform,
        x: clamp(
          drag.baseTransform.x + (screen.x - drag.start.x) / view.zoom,
          offset.min,
          offset.max,
        ),
        y: clamp(
          drag.baseTransform.y + (screen.y - drag.start.y) / view.zoom,
          offset.min,
          offset.max,
        ),
      };
    } else if (drag.kind === 'rotate') {
      const angle = Math.atan2(
        screen.y - drag.axisScreen.y,
        screen.x - drag.axisScreen.x,
      );
      let deg = wrapDegrees(
        drag.baseTransform.rotation + (angle - drag.startAngle) * RAD_TO_DEG,
      );
      if (event.shiftKey) {
        deg = wrapDegrees(Math.round(deg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG);
      }
      next = {
        ...drag.baseTransform,
        rotation: clamp(deg, rotation.min, rotation.max),
      };
    } else {
      const distance = Math.hypot(
        screen.x - drag.axisScreen.x,
        screen.y - drag.axisScreen.y,
      );
      next = {
        ...drag.baseTransform,
        scale: clamp(
          (drag.baseTransform.scale * distance) / drag.startDistance,
          scale.min,
          scale.max,
        ),
      };
    }
    lastTransformRef.current = next;
    setDragTransform(next);
    live.preview(next);
  };

  const handleWindowUp = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 다른 포인터의 up이 첫 드래그를 커밋하지 못하게 한다 (멀티터치)
    if (event.pointerId !== drag.pointerId) return;
    if (drag.kind === 'pivot') {
      moveSchedulerRef.current?.flush();
      const patch = lastPivotPatchRef.current;
      const base = drag.pivotBase;
      if (patch && base) {
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = spriteItemsApi.patchPosition(
          base.mode,
          base.id,
          patch,
          gestureId,
        );
        editGestureController.settleCommit(persisted);
        void persisted.catch((error) => {
          console.error('Failed to move sprite pivot', error);
        });
      } else {
        editGestureController.cancel();
      }
      finishDrag();
      return;
    }
    // 소유권을 잃었으면 커밋도 flush도 하지 않고 포기 경로로 간다 -
    // 대기 move를 flush하면 리사이즈 착지가 닫아둔 preview가 다시 열린다
    if (!ownsSession()) {
      cancelActiveDrag();
      return;
    }
    // 같은 프레임의 마지막 move가 rAF에 남아 있으면 커밋 전에 반영한다
    moveSchedulerRef.current?.flush();
    if (lastTransformRef.current) {
      drag.session?.commit(lastTransformRef.current);
    }
    finishDrag();
  };

  const handleWindowMove = (event: PointerEvent) => {
    if (event.pointerId !== dragRef.current?.pointerId) return;
    // 창 밖에서 버튼이 이미 떼졌으면 stale 드래그 - 커밋 없이 종료
    if (event.buttons === 0) {
      cancelActiveDrag();
      return;
    }
    moveSchedulerRef.current?.push(event);
  };
  const handleWindowCancel = (event: PointerEvent) => {
    if (event.pointerId !== dragRef.current?.pointerId) return;
    cancelActiveDrag();
  };
  const handleWindowBlur = () => cancelActiveDrag();

  const attachWindowListeners = () => {
    window.addEventListener('pointermove', handleWindowMove);
    window.addEventListener('pointerup', handleWindowUp);
    window.addEventListener('pointercancel', handleWindowCancel);
    window.addEventListener('blur', handleWindowBlur);
    detachRef.current = () => {
      window.removeEventListener('pointermove', handleWindowMove);
      window.removeEventListener('pointerup', handleWindowUp);
      window.removeEventListener('pointercancel', handleWindowCancel);
      window.removeEventListener('blur', handleWindowBlur);
    };
  };

  const grab = (event: React.PointerEvent<Element>, cursor: string) => {
    const el = event.currentTarget;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // 미지원 환경은 커서 고정 없이 동작만 유지
    }
    beginDragCursor(cursor, el.ownerDocument);
    grabbedRef.current = { el, pointerId: event.pointerId };
  };

  const beginPoseDrag = (
    event: React.PointerEvent<Element>,
    kind: Exclude<DragKind, 'pivot'>,
  ) => {
    if (event.button !== 0 || dragRef.current || !session) return;
    const screen = clientToScreen(event.clientX, event.clientY);
    if (!screen) return;
    const startDistance = Math.hypot(
      screen.x - pivotScreen.x,
      screen.y - pivotScreen.y,
    );
    if (kind === 'scale' && startDistance < MIN_SCALE_ARM_PX) return;
    event.preventDefault();
    event.stopPropagation();
    if (!tryAcquireDragSession()) return;
    grab(event, kind === 'move' ? 'move' : 'grabbing');
    ownerGenerationRef.current = generationNow();
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      start: screen,
      baseTransform: session.transform,
      session,
      pivotBase: null,
      axisScreen: pivotScreen,
      startAngle: Math.atan2(
        screen.y - pivotScreen.y,
        screen.x - pivotScreen.x,
      ),
      startDistance,
    };
    cancelDragRef.current = cancelActiveDrag;
    moveSchedulerRef.current = createRafLatestScheduler(applyWindowMove);
    attachWindowListeners();
  };

  const beginPivotDrag = (event: React.PointerEvent<Element>) => {
    if (event.button !== 0 || dragRef.current) return;
    const id = session ? session.positionId : sprite?.id;
    if (!id || !isNativeElementId(id)) return;
    const locator = resolveElementById('sprite', id);
    if (!locator) return;
    const canonical = useSpriteStore
      .getState()
      .positions[locator.mode]?.find((candidate) => candidate.id === id);
    if (!canonical) return;
    const screen = clientToScreen(event.clientX, event.clientY);
    if (!screen) return;
    event.preventDefault();
    event.stopPropagation();
    if (!tryAcquireDragSession()) return;
    grab(event, 'grabbing');
    dragRef.current = {
      kind: 'pivot',
      pointerId: event.pointerId,
      start: screen,
      baseTransform: displayTransform,
      session: null,
      pivotBase: {
        mode: locator.mode,
        id,
        canonical,
        translate: { x: displayTransform.x, y: displayTransform.y },
      },
      axisScreen: pivotScreen,
      startAngle: 0,
      startDistance: 0,
    };
    cancelDragRef.current = cancelActiveDrag;
    moveSchedulerRef.current = createRafLatestScheduler(applyWindowMove);
    attachWindowListeners();
  };

  const knobStyle = (center: Point, cursor: string): React.CSSProperties => ({
    position: 'absolute',
    left: center.x - KNOB_HIT_SIZE / 2,
    top: center.y - KNOB_HIT_SIZE / 2,
    width: KNOB_HIT_SIZE,
    height: KNOB_HIT_SIZE,
    cursor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  const knobDotStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: 'var(--ui-selection-border)',
    border: '2px solid rgba(255, 255, 255, 0.9)',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.4)',
  };

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 'var(--z-canvas-gradient-editor)' }}
      // 핸들 조작이 자세 팝업의 바깥 클릭으로 읽히지 않게 한다
      data-dmn-canvas-editor-overlay="true"
    >
      <svg
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
        style={{ overflow: 'visible' }}
      >
        {poseCorners ? (
          <>
            {/* 자세 프레임 - 본체 드래그 = 위치 */}
            <polygon
              points={poseCorners.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="transparent"
              stroke="var(--ui-selection-border)"
              strokeWidth={1}
              style={{ pointerEvents: 'auto', cursor: 'move' }}
              data-sprite-pose-frame="true"
              onPointerDown={(event) => beginPoseDrag(event, 'move')}
            />
            {rotateKnob ? (
              <line
                x1={rotateKnob.anchor.x}
                y1={rotateKnob.anchor.y}
                x2={rotateKnob.knob.x}
                y2={rotateKnob.knob.y}
                stroke="var(--ui-selection-border)"
                strokeWidth={1}
              />
            ) : null}
          </>
        ) : null}
      </svg>
      {poseCorners
        ? poseCorners.map((corner, index) => (
            // 모서리 배율 노브 - 기준점 중심 균일 배율
            <div
              key={index}
              role="button"
              aria-label={t('propertiesPanel.spriteScale') || '배율'}
              onPointerDown={(event) => beginPoseDrag(event, 'scale')}
              className="pointer-events-auto"
              style={knobStyle(corner, 'nwse-resize')}
              data-sprite-scale-knob="true"
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: 'rgba(255, 255, 255, 0.95)',
                  border: '1px solid var(--ui-selection-border)',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
                }}
              />
            </div>
          ))
        : null}
      {rotateKnob ? (
        <div
          role="button"
          aria-label={t('propertiesPanel.spriteRotation') || '회전'}
          onPointerDown={(event) => beginPoseDrag(event, 'rotate')}
          className="pointer-events-auto"
          style={knobStyle(rotateKnob.knob, 'grab')}
          data-sprite-rotate-knob="true"
        >
          <div style={knobDotStyle} />
        </div>
      ) : null}
      {/* 기준점 십자 - 드래그로 옮긴다. 그림은 움직이지 않는다 */}
      <div
        role="button"
        aria-label={t('propertiesPanel.spritePivot') || '기준점'}
        title={
          t('propertiesPanel.spritePivotHint') ||
          '드래그: 기준점 이동 · Ctrl/⌘: 스냅 해제'
        }
        onPointerDown={beginPivotDrag}
        className="pointer-events-auto"
        style={{
          ...knobStyle(pivotScreen, 'grab'),
          color: 'var(--ui-selection-border)',
          opacity: dragPivot ? 1 : 0.85,
        }}
        data-sprite-pivot-handle="true"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <circle
            cx="7.5"
            cy="7.5"
            r="3"
            fill="rgba(255, 255, 255, 0.9)"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M7.5 0.5V3M7.5 12V14.5M0.5 7.5H3M12 7.5H14.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
};

export default SpriteCanvasHandles;
