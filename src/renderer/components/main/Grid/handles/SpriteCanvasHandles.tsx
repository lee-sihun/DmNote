'use no memo';
// 렌더 중 ref 대입(세션·지오메트리 최신화)이 React Compiler bailout이라
// 컴파일 대상에서 빠진다. 조용한 제외와 구분되게 명시한다 (GradientAxisHandle과 같은 이유)
import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from '@contexts/useTranslation';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import {
  useSpritePoseHandleStore,
  type SpritePoseHandleSession,
} from '@stores/grid/useSpritePoseHandleStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { spriteItemsApi } from '@api/modules/itemsApi';
import { subscribeHistoryEditorFlushStart } from '@src/renderer/editor/runtime/historyEditorFlushLock';
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
  isSameSpriteAnchor,
  isSameSpriteTransform,
  spritePivotPx,
} from '@utils/sprite/spriteGeometry';
import {
  compensateTransformForPivotDelta,
  compensateTransformForPosePivotDelta,
  pivotHandleLocalPoint,
  pivotForHandleTarget,
  placeSpriteVisual,
  posePivotHandleLocalPoint,
  posePivotForHandleTarget,
  snapPivotToPreset,
  snapPosePivotToPreset,
  spriteIdleVisual,
  spritePivotChangePatch,
  type SpritePivotHandleFrame,
  type SpritePosePivotHandleFrame,
} from '@utils/sprite/spritePlacement';
import { clamp } from '@utils/core/clamp';
import { resolveRotationDrag } from '@utils/core/rotation';
import { rotatePointAround } from '@utils/core/rotation';
import { suppressNextClick } from '@utils/dom/suppressNextClick';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';
import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';
import {
  getCursor,
  lockCustomCursor,
  unlockCustomCursor,
  type RotationCursorType,
} from '@utils/grid/cursorUtils';
import { getActiveElement } from '@utils/dom/activeElement';
import { isHTMLElementNode } from '@utils/dom/isElementNode';
import {
  releaseDragSession,
  tryAcquireDragSession,
} from '@hooks/Grid/dragSession';
import { SELECTION_BORDER_CENTER } from './selectionOutline';
import RotateCornerHandles from './RotateCornerHandles';

/**
 * 온캔버스 스프라이트 핸들.
 * 스프라이트가 선택돼 있으면 기준점 십자를 그리고 드래그로 옮긴다 (9점 자석 스냅,
 * Ctrl/Cmd로 해제). 기본 그림과 독립 상태는 제자리에 두고 연결 상태는 새 축을 따른다.
 * 자세 팝업이 열려 있으면 자세 이미지 프레임을 그린다: 본체 드래그 = 위치,
 * 모서리 바깥 = 회전(Shift 15° 스냅), 모서리 = 배율(기준점 중심)
 * 배치는 GradientAxisOverlay와 동일한 비스케일 오버레이 층 - zoom/pan을 직접 계산.
 * 드래그 계산은 전부 요소 로컬 px에서 하므로 도중에 팬·줌이 바뀌어도 포인터가
 * 가리키는 자리를 그대로 따라간다
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

type PivotDragBase =
  | {
      kind: 'base';
      mode: string;
      id: string;
      canonical: ReactiveSpritePosition;
      frame: SpritePivotHandleFrame;
      grabOffset: Point;
    }
  | {
      kind: 'pose';
      poseId: string;
      /** 세션(표시 기하)에서 뜬 프레임 - 저장 대기 중인 필드 편집도 그대로 담긴다 */
      frame: SpritePosePivotHandleFrame;
      grabOffset: Point;
    };

interface DragState {
  kind: DragKind;
  pointerId: number;
  /** buttons가 유효했던 이동을 본 뒤 0으로 바뀌면 누락된 up으로 판정 */
  sawPressedMove: boolean;
  /** 드래그 시작 포인터 (요소 로컬 px) */
  startLocal: Point;
  /** 드래그 시작 시점 자세 transform (자세 핸들) */
  baseTransform: SpriteTransform;
  /** 회전·배율 축의 로컬 위치 - 시작 시점 이동값이 더해진 P */
  axisLocal: Point;
  startAngle: number;
  startDistance: number;
  /** 시작 시점 세션 - 스토어 세션이 먼저 닫혀도 cancel 배선을 유지한다 */
  session: SpritePoseHandleSession | null;
  /** 기준점 드래그의 canonical 스프라이트 - 도중에 바뀌면 드래그를 포기한다 */
  pivotBase: PivotDragBase | null;
  /** 자석에 붙은 프리셋 - 더 넓은 이탈 반경까지 유지해 경계 떨림 방지 */
  snappedPivot: SpriteAnchor | null;
}

interface PendingBasePivotLanding {
  generation: number;
  mode: string;
  id: string;
  pivot: SpriteAnchor;
}

/** 최신 렌더의 표시 기하 - 드래그 시작이 포커스 정산 뒤에 읽는다 */
interface HandleGeometry {
  session: SpritePoseHandleSession | null;
  sprite: ReactiveSpritePosition | null;
  origin: { dx: number; dy: number };
  rotation: number;
  box: { width: number; height: number };
  imagePivot: SpriteAnchor;
  displayTransform: SpriteTransform;
  pivotLocal: Point;
}

const KNOB_HIT_SIZE = 22;
const PIVOT_SNAP_PX = 8;
const PIVOT_SNAP_RELEASE_PX = 12;
// 기준점 표식 - 포커스 브래킷: 가운데 점을 네 귀퉁이 꺾쇠가 감싼다. 꺾쇠는 대각선
// 방향으로만 뻗어 선택 테두리와 겹치지 않고, 호버·드래그에서 안쪽으로 조여든다
const PIVOT_HIT_SIZE = 26;
const PIVOT_CENTER = PIVOT_HIT_SIZE / 2;
const PIVOT_BRACKET_REACH = 8;
const PIVOT_BRACKET_ARM = 4.5;
const PIVOT_BRACKET_ACTIVE_SCALE = 0.8125;
const PIVOT_DOT_RADIUS = 1.75;
const PIVOT_DOT_ACTIVE_RADIUS = 2;
const PIVOT_BRACKETS = (() => {
  const near = PIVOT_CENTER - PIVOT_BRACKET_REACH;
  const far = PIVOT_CENTER + PIVOT_BRACKET_REACH;
  const arm = PIVOT_BRACKET_ARM;
  return [
    `M${near} ${near + arm}V${near}H${near + arm}`,
    `M${far - arm} ${near}H${far}V${near + arm}`,
    `M${far} ${far - arm}V${far}H${far - arm}`,
    `M${near + arm} ${far}H${near}V${far - arm}`,
  ].join('');
})();
// 축과 겹친 모서리는 배율 방향이 정의되지 않아 잡지 않는다
const MIN_SCALE_ARM_PX = 2;

const findCanonicalSprite = (
  mode: string,
  id: string,
): ReactiveSpritePosition | null =>
  useSpriteStore
    .getState()
    .positions[mode]?.find((candidate) => candidate.id === id) ?? null;

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
  const lastPosePivotRef = useRef<{
    pivot: SpriteAnchor;
    transform: SpriteTransform;
  } | null>(null);
  const pendingBasePivotGenerationRef = useRef(0);
  const [pendingBasePivotLanding, setPendingBasePivotLanding] =
    useState<PendingBasePivotLanding | null>(null);

  // 드래그 중 로컬 표시값 - preview 채널과 별개로 핸들을 즉시 따라가게 한다
  const [dragTransform, setDragTransform] = useState<SpriteTransform | null>(
    null,
  );
  const [dragPivot, setDragPivot] = useState<SpriteAnchor | null>(null);
  // 기준점 드래그 중 표식이 놓일 보정 transform - 오버레이 재합성을 기다리지 않고
  // 표식이 포인터 아래에 바로 놓이게 한다 (자세 편집 중엔 세션 값이 보정되지 않아 필수)
  const [dragPivotTransform, setDragPivotTransform] =
    useState<SpriteTransform | null>(null);
  const [pivotHover, setPivotHover] = useState(false);

  const selected = selectedElements.length === 1 ? selectedElements[0] : null;
  const sprite =
    selected && selected.type === 'sprite'
      ? spritePositions[selectedKeyType]?.find(
          (candidate) => candidate.id === selected.id,
        ) ?? null
      : null;

  // 드래그 도중 휠 팬·줌이 좌표를 움직여도 매 이벤트에서 최신 뷰로
  // 재계산한다 (GradientAxisHandle과 같은 이유의 렌더 중 ref 대입)
  const viewRef = useRef({ zoom, panX, panY });
  // eslint-disable-next-line react-hooks/refs
  viewRef.current = { zoom, panX, panY };
  const sessionRef = useRef(session);
  // eslint-disable-next-line react-hooks/refs
  sessionRef.current = session;
  // 드래그 시작은 포커스 필드 정산(flushSync) 뒤에 온다. 정산이 값을 커밋하면 세션과
  // 표시 기하가 같은 프레임에 바뀌므로 시작 값은 렌더 클로저가 아니라 여기서 읽는다
  const latestRef = useRef<HandleGeometry | null>(null);

  // 활성 드래그 취소 배선 - 세션 종료·대상 교체·언마운트에서
  // window 리스너·포인터 캡처·전역 드래그 락·열린 preview 제스처를 함께 정리한다
  const cancelDragRef = useRef<(() => void) | null>(null);
  useEffect(
    () => subscribeHistoryEditorFlushStart(() => cancelDragRef.current?.()),
    [],
  );
  const ownerKey = session
    ? `${session.positionId}\n${session.poseId}`
    : sprite
    ? sprite.id
    : null;
  useEffect(() => {
    if (dragRef.current) cancelDragRef.current?.();
    if (ownerKey === null) {
      pendingBasePivotGenerationRef.current += 1;
      setPendingBasePivotLanding(null);
    }
  }, [ownerKey]);
  useEffect(
    () => () => {
      pendingBasePivotGenerationRef.current += 1;
      cancelDragRef.current?.();
    },
    [],
  );

  // undo/redo 반영은 대상도 세대도 바꾸지 않아 위 배선에 걸리지 않는다. 그대로 두면
  // 저장값이 되돌아간 뒤 pointerup이 시작 시점 값으로 푼 결과를 다시 커밋한다
  useEffect(
    () =>
      useCommittedApplyStore.subscribe((state, previous) => {
        if (state.historyTick === previous.historyTick) return;
        cancelDragRef.current?.();
        pendingBasePivotGenerationRef.current += 1;
        setPendingBasePivotLanding(null);
      }),
    [],
  );

  if (!sprite && !session) {
    // eslint-disable-next-line react-hooks/refs
    latestRef.current = null;
    if (
      dragTransform !== null ||
      dragPivot !== null ||
      dragPivotTransform !== null ||
      pendingBasePivotLanding !== null
    ) {
      // 대상이 사라지면 로컬 드래그 상태도 함께 비운다 (렌더 중 보정 패턴)
      setDragTransform(null);
      setDragPivot(null);
      setDragPivotTransform(null);
    }
    return null;
  }

  // 기하의 원천 - 세션이 있으면 세션(자세 편집 대상), 없으면 선택 스프라이트
  const origin = session ? session.origin : { dx: sprite!.dx, dy: sprite!.dy };
  const box = session
    ? { width: session.width, height: session.height }
    : { width: sprite!.width, height: sprite!.height };
  const rotation = session ? session.rotation ?? 0 : sprite!.rotation ?? 0;
  const visiblePendingBasePivot =
    !session &&
    pendingBasePivotLanding?.mode === selectedKeyType &&
    pendingBasePivotLanding.id === sprite?.id
      ? spritePivotChangePatch(sprite!, pendingBasePivotLanding.pivot)
      : null;
  const imagePivot =
    dragPivot ??
    visiblePendingBasePivot?.pivot ??
    (session ? session.imagePivot : sprite!.pivot);
  const axisPivot = session ? session.pivot : imagePivot;
  const displayTransform =
    dragPivotTransform ??
    dragTransform ??
    visiblePendingBasePivot?.idleTransform ??
    (session ? session.transform : sprite!.idleTransform);
  const axis = spritePivotPx({ ...box, pivot: axisPivot });

  const toScreen = (local: Point): Point => {
    const point = rotatePointAround(
      local,
      { x: box.width / 2, y: box.height / 2 },
      rotation,
    );
    return {
      x: (origin.dx + point.x) * zoom + panX,
      y: (origin.dy + point.y) * zoom + panY,
    };
  };
  // 십자는 화면에서 실제로 회전이 일어나는 점 - 축에 이동값이 더해진다
  const pivotLocal = {
    x: axis.x + displayTransform.x,
    y: axis.y + displayTransform.y,
  };
  // eslint-disable-next-line react-hooks/refs
  latestRef.current = {
    session,
    sprite,
    origin,
    rotation,
    box,
    imagePivot,
    displayTransform,
    pivotLocal,
  };
  // 선택 테두리와 리사이즈 핸들은 상자 밖 1px 프레임에 그려진다. 상자 핸들이 보이는 동안은
  // 표식도 그 프레임에 앉혀 모서리·변에서 선·핸들 중심과 정확히 겹치게 한다.
  // 자세 편집 중에는 자세 프레임 선이 상자 그대로라 보정하지 않는다
  const frameInset = session ? 0 : SELECTION_BORDER_CENTER;
  const pivotAxisScreen = toScreen(pivotLocal);
  const pivotInset = rotatePointAround(
    {
      x: (2 * axisPivot.x - 1) * frameInset,
      y: (2 * axisPivot.y - 1) * frameInset,
    },
    { x: 0, y: 0 },
    rotation,
  );
  const pivotScreen = {
    x: pivotAxisScreen.x + pivotInset.x,
    y: pivotAxisScreen.y + pivotInset.y,
  };

  const posePlacement = session
    ? {
        rect: {
          ...session.placement.rect,
          x:
            session.placement.rect.x -
            (imagePivot.x - session.imagePivot.x) *
              session.placement.rect.width,
          y:
            session.placement.rect.y -
            (imagePivot.y - session.imagePivot.y) *
              session.placement.rect.height,
        },
        pivot: imagePivot,
      }
    : null;

  // 뷰(zoom·pan)와 원점은 ref에서 읽는다 - 드래그 중 최신 값이어야 팬·줌과
  // 정산된 위치 편집을 따라간다
  const clientToLocal = (clientX: number, clientY: number): Point | null => {
    const hostRect = rootRef.current?.getBoundingClientRect();
    if (!hostRect) return null;
    const view = viewRef.current;
    const live = latestRef.current;
    const liveOrigin = live?.origin ?? origin;
    const liveBox = live?.box ?? box;
    return rotatePointAround(
      {
        x: (clientX - hostRect.left - view.panX) / view.zoom - liveOrigin.dx,
        y: (clientY - hostRect.top - view.panY) / view.zoom - liveOrigin.dy,
      },
      { x: liveBox.width / 2, y: liveBox.height / 2 },
      -(live?.rotation ?? rotation),
    );
  };

  // 자세 프레임 - 배치 rect의 네 모서리에 자세 변환을 적용한 화면 폴리곤.
  // 한 점 u는 t + P + sR(u − P)에 놓인다
  const poseCorners = (() => {
    if (!session) return null;
    const { rect } = posePlacement!;
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

  const generationNow = () => useSpritePoseHandleStore.getState().generation;
  // 드래그 시작 때 잡은 세대가 아직 유효한지 - 자세 preview·커밋의 공통 전제
  const ownsSession = () => ownerGenerationRef.current === generationNow();
  // 기준점 드래그의 전제. 기본 기준점은 시작 시점 canonical이 아직 스토어의 그 객체인지 -
  // 리사이즈 착지·다른 창 편집·undo가 끼어들면 시작 시점 patch는 낡은 값이다.
  // 자세 기준점은 세션 프레임이 기준이라 세션 소유권으로 판정한다 (기하가 바뀌면 세대가 오른다)
  const pivotBaseCurrent = (drag: DragState): boolean => {
    const base = drag.pivotBase;
    if (!base) return false;
    if (base.kind === 'pose') return ownsSession();
    const current = findCanonicalSprite(base.mode, base.id);
    if (!current) return false;
    const placement = placeSpriteVisual(current, spriteIdleVisual(current));
    return (
      current.dx === base.canonical.dx &&
      current.dy === base.canonical.dy &&
      (current.rotation ?? 0) === (base.canonical.rotation ?? 0) &&
      current.width === base.frame.box.width &&
      current.height === base.frame.box.height &&
      isSameSpriteAnchor(current.pivot, base.frame.pivot) &&
      isSameSpriteTransform(current.idleTransform, base.frame.transform) &&
      placement.rect.width === base.frame.rect.width &&
      placement.rect.height === base.frame.rect.height
    );
  };

  const releaseGrabbed = () => {
    const grabbed = grabbedRef.current;
    if (!grabbed) return;
    endDragCursor(grabbed.el.ownerDocument);
    if (dragRef.current?.kind === 'rotate') unlockCustomCursor();
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
    moveSchedulerRef.current?.cancel();
    moveSchedulerRef.current = null;
    detachRef.current?.();
    detachRef.current = null;
    releaseGrabbed();
    dragRef.current = null;
    setDragTransform(null);
    setDragPivot(null);
    setDragPivotTransform(null);
    // 캡처 중 leave가 유실되면 호버 채움이 남는다
    setPivotHover(false);
    lastTransformRef.current = null;
    lastPivotPatchRef.current = null;
    lastPosePivotRef.current = null;
    suppressNextClick();
  };

  const cancelActiveDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    // 기준점은 드래그 중 저장 프리뷰를 만들지 않아 정리할 세션이 없다
    if (drag.kind !== 'pivot') {
      drag.session?.cancel();
    }
    finishDrag();
  };

  // 기준점 드래그 - 표식이 포인터(잡은 자리 보정) 아래에 오도록 역변환으로 기준점을
  // 구한다. 표식은 P + t + sR·Δ에 놓이므로 회전·배율이 있어도 포인터를 그대로 따라간다.
  // 9점 프리셋은 각 프리셋일 때 표식이 놓일 자리와 화면 px로 비교해 자석 스냅한다 -
  // 줌과 무관하게 같은 손맛이다
  const pivotFromPointer = (
    drag: DragState,
    local: Point,
    snapDisabled: boolean,
  ): SpriteAnchor | null => {
    const base = drag.pivotBase;
    if (!base) return null;
    const target = {
      x: local.x - base.grabOffset.x,
      y: local.y - base.grabOffset.y,
    };
    const next =
      base.kind === 'pose'
        ? posePivotForHandleTarget(base.frame, target)
        : pivotForHandleTarget(base.frame, target);
    if (snapDisabled) {
      drag.snappedPivot = null;
      return next;
    }
    const held = drag.snappedPivot;
    if (held) {
      const at =
        base.kind === 'pose'
          ? posePivotHandleLocalPoint(base.frame, held)
          : pivotHandleLocalPoint(base.frame, held);
      const releaseRadius = PIVOT_SNAP_RELEASE_PX / viewRef.current.zoom;
      if (Math.hypot(at.x - target.x, at.y - target.y) <= releaseRadius) {
        return held;
      }
      drag.snappedPivot = null;
    }
    const snapped =
      base.kind === 'pose'
        ? snapPosePivotToPreset(
            base.frame,
            target,
            PIVOT_SNAP_PX / viewRef.current.zoom,
          )
        : snapPivotToPreset(
            base.frame,
            target,
            PIVOT_SNAP_PX / viewRef.current.zoom,
          );
    drag.snappedPivot = snapped;
    return snapped ?? next;
  };

  const updatePivotDrag = (drag: DragState, next: SpriteAnchor) => {
    const base = drag.pivotBase;
    if (!base) return;
    if (base.kind === 'pose') {
      const display = compensateTransformForPosePivotDelta(base.frame, next);
      if (!display) return;
      lastPosePivotRef.current = { pivot: next, transform: display };
      setDragPivot(next);
      setDragPivotTransform(display);
      return;
    }
    // 보정이 이동값 범위를 넘는 자리는 그림이 움직이므로 받지 않는다 -
    // 마지막으로 가능했던 자리에 머문다
    // 커밋 patch(canonical 기준)와 표식 보정(표시 프레임 기준)이 둘 다 성립할 때만 발행
    const patch = spritePivotChangePatch(base.canonical, next);
    const display = compensateTransformForPivotDelta(base.frame, next);
    if (!patch || !display) return;
    lastPivotPatchRef.current = patch;
    setDragPivot(next);
    setDragPivotTransform(display);
  };

  const applyWindowMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const local = clientToLocal(event.clientX, event.clientY);
    if (!local) return;
    if (drag.kind === 'pivot') {
      if (!pivotBaseCurrent(drag)) {
        cancelActiveDrag();
        return;
      }
      const next = pivotFromPointer(
        drag,
        local,
        event.ctrlKey || event.metaKey,
      );
      if (next) updatePivotDrag(drag, next);
      return;
    }
    const live = sessionRef.current;
    if (!live) return;
    // 소유권이 갈린 뒤의 move는 이미 취소된 preview를 되열 뿐이라 버린다
    if (!ownsSession()) return;
    const { offset, scale } = SPRITE_CONSTRAINTS;
    let next: SpriteTransform;
    if (drag.kind === 'move') {
      next = {
        ...drag.baseTransform,
        x: clamp(
          drag.baseTransform.x + (local.x - drag.startLocal.x),
          offset.min,
          offset.max,
        ),
        y: clamp(
          drag.baseTransform.y + (local.y - drag.startLocal.y),
          offset.min,
          offset.max,
        ),
      };
    } else if (drag.kind === 'rotate') {
      next = {
        ...drag.baseTransform,
        rotation: resolveRotationDrag({
          base: drag.baseTransform.rotation,
          startAngle: drag.startAngle,
          angle: Math.atan2(
            local.y - drag.axisLocal.y,
            local.x - drag.axisLocal.x,
          ),
          snap: event.shiftKey,
        }),
      };
    } else {
      const distance = Math.hypot(
        local.x - drag.axisLocal.x,
        local.y - drag.axisLocal.y,
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

  const settleActiveDrag = (pointerId: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 다른 포인터의 up이 첫 드래그를 커밋하지 못하게 한다 (멀티터치)
    if (pointerId !== drag.pointerId) return;
    if (drag.kind === 'pivot') {
      // 시작 시점 canonical이 바뀌었으면 낡은 patch라 커밋하지 않는다
      if (!pivotBaseCurrent(drag)) {
        cancelActiveDrag();
        return;
      }
      moveSchedulerRef.current?.flush();
      const base = drag.pivotBase;
      if (base?.kind === 'pose') {
        const next = lastPosePivotRef.current;
        if (next && ownsSession()) {
          drag.session?.commitPivot(next.pivot, next.transform);
        }
        finishDrag();
        return;
      }
      const patch = lastPivotPatchRef.current;
      if (patch && base && pivotBaseCurrent(drag)) {
        const landingGeneration = pendingBasePivotGenerationRef.current + 1;
        pendingBasePivotGenerationRef.current = landingGeneration;
        setPendingBasePivotLanding({
          generation: landingGeneration,
          mode: base.mode,
          id: base.id,
          pivot: patch.pivot,
        });
        const gestureId = editGestureController.activeGestureId() ?? undefined;
        const persisted = spriteItemsApi.patchPosition(
          base.mode,
          base.id,
          patch,
          gestureId,
          (current) => spritePivotChangePatch(current, patch.pivot),
        );
        editGestureController.settleCommit(persisted);
        void persisted.then(
          (result) => {
            if (pendingBasePivotGenerationRef.current === landingGeneration) {
              setPendingBasePivotLanding(null);
            }
            if (result === 'skipped') {
              console.warn(
                'Sprite pivot change skipped against the latest base',
                base.id,
                patch.pivot,
              );
            }
          },
          (error) => {
            if (pendingBasePivotGenerationRef.current === landingGeneration) {
              setPendingBasePivotLanding(null);
            }
            console.error('Failed to move sprite pivot', error);
          },
        );
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

  const handleWindowUp = (event: PointerEvent) => {
    settleActiveDrag(event.pointerId);
  };

  const handleWindowMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (event.pointerId !== drag?.pointerId) return;
    if (event.buttons !== 0) drag.sawPressedMove = true;
    moveSchedulerRef.current?.push(event);
    // 일부 WebView 합성 입력은 up 없이 마지막 move의 buttons만 0으로 바뀐다
    // 처음부터 buttons가 0인 합성 드래그는 기존처럼 명시적 up까지 유지한다
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
    // 일부 WebView는 마우스 해제를 pointerup으로 올리지 않는다
    settleActiveDrag(drag.pointerId);
  };
  const handleLostPointerCapture = (event: Event) => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerId !== dragRef.current?.pointerId) return;
    // 캡처 해제 시점의 buttons는 엔진마다 달라 마지막 유효 위치를 확정한다
    // 명시적인 중단은 pointercancel과 blur가 맡는다
    settleActiveDrag(pointerEvent.pointerId);
  };
  const handleWindowBlur = () => cancelActiveDrag();

  const attachWindowListeners = () => {
    const captureTarget = grabbedRef.current?.el ?? null;
    const ownerDocument = captureTarget?.ownerDocument ?? document;
    const ownerWindow = ownerDocument.defaultView ?? window;
    ownerWindow.addEventListener('pointermove', handleWindowMove, true);
    ownerWindow.addEventListener('pointerup', handleWindowUp, true);
    ownerWindow.addEventListener('pointercancel', handleWindowCancel, true);
    ownerWindow.addEventListener('mouseup', handleMouseUp, true);
    ownerWindow.addEventListener('blur', handleWindowBlur);
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
      captureTarget?.removeEventListener(
        'lostpointercapture',
        handleLostPointerCapture,
      );
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

  const settleFocusedField = () => {
    const active = getActiveElement();
    if (
      isHTMLElementNode(active) &&
      active.matches('input, textarea, [contenteditable="true"]')
    ) {
      flushSync(() => active.blur());
    }
  };

  const beginPoseDrag = (
    event: React.PointerEvent<Element>,
    kind: Exclude<DragKind, 'pivot'>,
    rotationCursor: RotationCursorType = 'rotate',
  ) => {
    if (event.button !== 0 || dragRef.current || !session) return;
    settleFocusedField();
    // 정산이 팝업 필드를 커밋했으면 세션은 이미 새 값이다 - 시작 자세도 그 값이어야
    // 입력한 값 위에 이동량이 더해진다
    const live = latestRef.current;
    const liveSession = live?.session;
    if (!live || !liveSession) return;
    const local = clientToLocal(event.clientX, event.clientY);
    if (!local) return;
    const startDistance = Math.hypot(
      local.x - live.pivotLocal.x,
      local.y - live.pivotLocal.y,
    );
    if (
      kind === 'scale' &&
      startDistance * viewRef.current.zoom < MIN_SCALE_ARM_PX
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!tryAcquireDragSession()) return;
    grab(
      event,
      kind === 'rotate'
        ? getCursor(rotationCursor)
        : kind === 'move'
        ? 'move'
        : 'grabbing',
    );
    if (kind === 'rotate') lockCustomCursor(rotationCursor, event.nativeEvent);
    ownerGenerationRef.current = generationNow();
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      sawPressedMove: false,
      startLocal: local,
      baseTransform: liveSession.transform,
      axisLocal: live.pivotLocal,
      startAngle: Math.atan2(
        local.y - live.pivotLocal.y,
        local.x - live.pivotLocal.x,
      ),
      startDistance,
      session: liveSession,
      pivotBase: null,
      snappedPivot: null,
    };
    cancelDragRef.current = cancelActiveDrag;
    moveSchedulerRef.current = createRafLatestScheduler(applyWindowMove);
    attachWindowListeners();
  };

  // 표시 상태가 canonical과 어긋나 드래그를 거부할 때는 이유를 남긴다 - 조용히 죽은
  // 핸들처럼 보이지 않게
  const refusePivotDrag = (reason: string) => {
    console.warn('Sprite pivot drag refused:', reason);
  };

  const beginPivotDrag = (event: React.PointerEvent<Element>) => {
    if (event.button !== 0 || dragRef.current) return;
    settleFocusedField();
    const live = latestRef.current;
    if (!live) return;
    const liveSession = live.session;
    let pivotBase: PivotDragBase;
    let reclaimedOrphanPreview = false;
    if (liveSession) {
      // 자세 편집 중에는 세션이 표시 기하의 원천이다. 방금 정산된 필드 커밋이 canonical에
      // 아직 닿지 않았어도 세션 프레임으로 역변환하고, 커밋은 저장 시점 최신 자세 위에 병합된다
      pivotBase = {
        kind: 'pose',
        poseId: liveSession.poseId,
        frame: {
          axis: spritePivotPx({
            width: liveSession.width,
            height: liveSession.height,
            pivot: liveSession.pivot,
          }),
          rect: liveSession.placement.rect,
          pivot: liveSession.imagePivot,
          transform: liveSession.transform,
        },
        grabOffset: { x: 0, y: 0 },
      };
    } else {
      const id = live.sprite?.id;
      if (!id || !isNativeElementId(id)) return;
      const locator = resolveElementById('sprite', id);
      if (!locator) return;
      const canonical = findCanonicalSprite(locator.mode, id);
      if (!canonical) return;
      // 컨트롤러 소유권이 사라진 로컬 프리뷰는 새 조작보다 먼저 회수한다
      reclaimedOrphanPreview =
        editGestureController.discardOrphanedLocalPreviews();
      // 상자 크기·배치 각도가 canonical과 다르면 포인터 역변환이 달라진다
      if (
        !reclaimedOrphanPreview &&
        (live.box.width !== canonical.width ||
          live.box.height !== canonical.height ||
          live.rotation !== (canonical.rotation ?? 0))
      ) {
        refusePivotDrag('displayed box differs from canonical');
        return;
      }
      if (
        !reclaimedOrphanPreview &&
        !isSameSpriteAnchor(live.imagePivot, canonical.pivot)
      ) {
        refusePivotDrag('displayed pivot differs from canonical');
        return;
      }
      if (
        !reclaimedOrphanPreview &&
        !isSameSpriteTransform(live.displayTransform, canonical.idleTransform)
      ) {
        refusePivotDrag('displayed transform differs from canonical');
        return;
      }
      const rect = placeSpriteVisual(
        canonical,
        spriteIdleVisual(canonical),
      ).rect;
      pivotBase = {
        kind: 'base',
        mode: locator.mode,
        id,
        canonical,
        frame: {
          box: { width: canonical.width, height: canonical.height },
          rect,
          pivot: canonical.pivot,
          transform: canonical.idleTransform,
        },
        grabOffset: { x: 0, y: 0 },
      };
    }
    const local = clientToLocal(event.clientX, event.clientY);
    if (!local) return;
    event.preventDefault();
    event.stopPropagation();
    if (!tryAcquireDragSession()) return;
    grab(event, 'grabbing');
    pivotBase.grabOffset = {
      x: local.x - live.pivotLocal.x,
      y: local.y - live.pivotLocal.y,
    };
    if (liveSession) ownerGenerationRef.current = generationNow();
    dragRef.current = {
      kind: 'pivot',
      pointerId: event.pointerId,
      sawPressedMove: false,
      startLocal: local,
      baseTransform: pivotBase.frame.transform,
      axisLocal: live.pivotLocal,
      startAngle: 0,
      startDistance: 0,
      session: liveSession,
      pivotBase,
      snappedPivot: null,
    };
    if (reclaimedOrphanPreview && pivotBase.kind === 'base') {
      const recoveredPivot = pivotForHandleTarget(
        pivotBase.frame,
        live.pivotLocal,
      );
      const recoveredTransform = compensateTransformForPivotDelta(
        pivotBase.frame,
        recoveredPivot,
      );
      if (recoveredTransform) {
        setDragPivot(recoveredPivot);
        setDragPivotTransform(recoveredTransform);
      }
    }
    cancelDragRef.current = cancelActiveDrag;
    moveSchedulerRef.current = createRafLatestScheduler(applyWindowMove);
    attachWindowListeners();
  };

  const knobStyle = (
    center: Point,
    cursor: string,
    size = KNOB_HIT_SIZE,
  ): React.CSSProperties => ({
    position: 'absolute',
    left: center.x - size / 2,
    top: center.y - size / 2,
    width: size,
    height: size,
    cursor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  const pivotActive = pivotHover || dragPivot !== null;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 'var(--z-canvas-gradient-editor)' }}
      // 핸들 조작이 자세 팝업의 바깥 클릭으로 읽히지 않게 한다
      data-dmn-canvas-editor-overlay="true"
    >
      {poseCorners ? (
        <RotateCornerHandles
          corners={poseCorners}
          innerReach={19}
          label={t('propertiesPanel.spriteRotation') || '회전'}
          onPointerDown={(event, cursor) =>
            beginPoseDrag(event, 'rotate', cursor)
          }
        />
      ) : null}
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
      {/* 기준점 표식 - 드래그로 옮긴다. 그림은 움직이지 않는다 */}
      <div
        role="button"
        aria-label={t('propertiesPanel.spritePivot') || '기준점'}
        title={
          t('propertiesPanel.spritePivotHint') ||
          '드래그: 기준점 이동 · Ctrl/⌘: 스냅 해제'
        }
        onPointerDown={beginPivotDrag}
        onContextMenu={(event) => event.preventDefault()}
        onPointerEnter={() => setPivotHover(true)}
        onPointerLeave={() => setPivotHover(false)}
        className="pointer-events-auto"
        style={{
          ...knobStyle(pivotScreen, 'grab', PIVOT_HIT_SIZE),
          color: pivotActive
            ? 'var(--ui-selection)'
            : 'var(--ui-selection-border-strong)',
        }}
        data-sprite-pivot-handle="true"
      >
        <svg
          width={PIVOT_HIT_SIZE}
          height={PIVOT_HIT_SIZE}
          viewBox={`0 0 ${PIVOT_HIT_SIZE} ${PIVOT_HIT_SIZE}`}
          fill="none"
          aria-hidden="true"
          style={{ overflow: 'visible' }}
        >
          <path
            d={PIVOT_BRACKETS}
            stroke="currentColor"
            strokeWidth={1.5}
            style={{
              transformOrigin: `${PIVOT_CENTER}px ${PIVOT_CENTER}px`,
              transform: pivotActive
                ? `scale(${PIVOT_BRACKET_ACTIVE_SCALE})`
                : undefined,
              transition: 'transform 150ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
          <circle
            cx={PIVOT_CENTER}
            cy={PIVOT_CENTER}
            r={pivotActive ? PIVOT_DOT_ACTIVE_RADIUS : PIVOT_DOT_RADIUS}
            fill="currentColor"
          />
        </svg>
      </div>
    </div>
  );
};

export default SpriteCanvasHandles;
