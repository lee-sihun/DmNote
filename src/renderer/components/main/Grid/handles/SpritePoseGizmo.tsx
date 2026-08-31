'use no memo';
// 렌더 중 ref 대입(세션·지오메트리 최신화)이 React Compiler bailout이라
// 컴파일 대상에서 빠진다. 조용한 제외와 구분되게 명시한다 (GradientAxisHandle과 같은 이유)
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useSpritePoseGizmoStore } from '@stores/grid/useSpritePoseGizmoStore';
import {
  contactWorldPosition,
  solveTransformTowardTarget,
  type ContactGeometry,
} from '@utils/sprite/contactSolver';
import {
  DEFAULT_SPRITE_CONTACT_POINT,
  SPRITE_CONSTRAINTS,
  type SpriteAnchor,
  type SpriteTransform,
} from '@src/types/key/sprites';
import { anchorPx } from '@utils/sprite/spriteGeometry';
import { suppressNextClick } from '@utils/dom/suppressNextClick';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';
import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';
import {
  releaseDragSession,
  tryAcquireDragSession,
} from '@hooks/Grid/dragSession';

/**
 * 온캔버스 자세 기즈모 - 자세 팝업이 열려 있는 동안 손끝(핀) 노브를 그린다.
 * 노브 드래그 = 축(기준점) 고정 역산: x·y를 두고 rotation(·뻗기 시 scale)을 계산.
 * Alt 드래그 = 핀 배치: transform은 두고 contactPoint만 옮긴다.
 * 배치는 GradientAxisOverlay와 동일한 비스케일 오버레이 층 - zoom/pan을 직접 계산
 */

interface SpritePoseGizmoProps {
  zoom: number;
  panX: number;
  panY: number;
}

type DragMode = 'aim' | 'pin';

interface DragState {
  mode: DragMode;
  pointerId: number;
  /** 드래그 시작 시점 transform - 뻗기 OFF의 scale 기준 */
  baseTransform: SpriteTransform;
  /** 시작 시점 세션 - 스토어 세션이 먼저 닫혀도 cancel 배선을 유지한다 */
  session: import('@stores/grid/useSpritePoseGizmoStore').SpritePoseGizmoSession;
}

const KNOB_HIT_SIZE = 22;
// 노브를 잡을 수 있는 최소 팔 길이(요소 로컬 px). 솔버의 CONTACT_EPSILON은
// "수학적으로 방향이 정의되지 않음"이고 이쪽은 "화면에서 집을 수 없음"이라 따로 둔다
const MIN_GRABBABLE_ARM_PX = 1e-3;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const SpritePoseGizmo = ({ zoom, panX, panY }: SpritePoseGizmoProps) => {
  const { t } = useTranslation();
  const session = useSpritePoseGizmoStore((state) => state.session);

  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const grabbedRef = useRef<{ el: HTMLElement; pointerId: number } | null>(
    null,
  );
  const detachRef = useRef<(() => void) | null>(null);
  const moveSchedulerRef = useRef<ReturnType<
    typeof createRafLatestScheduler<PointerEvent>
  > | null>(null);
  const ownerGenerationRef = useRef(0);
  const lastSolvedRef = useRef<SpriteTransform | null>(null);
  const lastPinRef = useRef<SpriteAnchor | null>(null);

  // 드래그 중 로컬 표시값 - preview 채널과 별개로 노브를 즉시 따라가게 한다
  const [dragTransform, setDragTransform] = useState<SpriteTransform | null>(
    null,
  );
  const [dragPin, setDragPin] = useState<SpriteAnchor | null>(null);

  // 드래그 도중 휠 팬·줌이 좌표를 움직여도 매 이벤트에서 최신 지오메트리로
  // 재계산한다 (GradientAxisHandle과 같은 이유의 렌더 중 ref 대입)
  const geoRef = useRef<{
    geometry: ContactGeometry;
    origin: { dx: number; dy: number };
    zoom: number;
    panX: number;
    panY: number;
  } | null>(null);
  const sessionRef = useRef(session);
  // eslint-disable-next-line react-hooks/refs
  sessionRef.current = session;

  // 활성 드래그 취소 배선 - 세션 종료(Escape·대상 소실)·대상 교체·언마운트에서
  // window 리스너·포인터 캡처·전역 드래그 락·열린 preview 제스처를 함께 정리한다
  const cancelDragRef = useRef<(() => void) | null>(null);
  const ownerKey = session ? `${session.positionId}\n${session.poseId}` : null;
  useEffect(() => {
    if (dragRef.current) cancelDragRef.current?.();
  }, [ownerKey]);
  useEffect(() => () => cancelDragRef.current?.(), []);

  if (!session) {
    if (dragTransform !== null || dragPin !== null) {
      // 세션이 닫히면 로컬 드래그 상태도 함께 비운다 (렌더 중 보정 패턴)
      setDragTransform(null);
      setDragPin(null);
    }
    return null;
  }

  const geometry: ContactGeometry = {
    imageRect: session.imageRect,
    pivot: session.pivot,
    contactPoint: dragPin ?? session.contactPoint,
  };
  // eslint-disable-next-line react-hooks/refs
  geoRef.current = {
    geometry,
    origin: session.origin,
    zoom,
    panX,
    panY,
  };

  const displayTransform = dragTransform ?? session.transform;
  const axis = anchorPx(session.imageRect, session.pivot);
  const contactWorld = contactWorldPosition(geometry, displayTransform);
  const knobScreen = {
    x: (session.origin.dx + contactWorld.x) * zoom + panX,
    y: (session.origin.dy + contactWorld.y) * zoom + panY,
  };
  const axisScreen = {
    x: (session.origin.dx + displayTransform.x + axis.x) * zoom + panX,
    y: (session.origin.dy + displayTransform.y + axis.y) * zoom + panY,
  };

  // 핀=축 퇴화 - 방향이 정의되지 않아 조작 불가, 핀 재배치(Alt)만 허용
  const baseVector = {
    x: (geometry.contactPoint.x - session.pivot.x) * session.imageRect.width,
    y: (geometry.contactPoint.y - session.pivot.y) * session.imageRect.height,
  };
  const degenerate =
    Math.hypot(baseVector.x, baseVector.y) <= MIN_GRABBABLE_ARM_PX;

  const clientToElementLocal = (clientX: number, clientY: number) => {
    const geo = geoRef.current;
    const hostRect = rootRef.current?.getBoundingClientRect();
    if (!geo || !hostRect) return null;
    return {
      x: (clientX - hostRect.left - geo.panX) / geo.zoom - geo.origin.dx,
      y: (clientY - hostRect.top - geo.panY) / geo.zoom - geo.origin.dy,
    };
  };

  // Alt 드래그의 핀 역산 - 화면 목표를 이미지 정규화 좌표로 되돌린다
  const targetToPin = (target: { x: number; y: number }): SpriteAnchor => {
    const geo = geoRef.current;
    const live = sessionRef.current;
    if (!geo || !live) return DEFAULT_SPRITE_CONTACT_POINT;
    const { imageRect, pivot } = geo.geometry;
    const axis = anchorPx(imageRect, pivot);
    const transform = lastSolvedRef.current ?? live.transform;
    const rad = (-transform.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const scale = Math.max(transform.scale, SPRITE_CONSTRAINTS.scale.min);
    const dx = (target.x - transform.x - axis.x) / scale;
    const dy = (target.y - transform.y - axis.y) / scale;
    const pre = {
      x: axis.x + dx * cos - dy * sin,
      y: axis.y + dx * sin + dy * cos,
    };
    return {
      x: clamp01((pre.x - imageRect.x) / imageRect.width),
      y: clamp01((pre.y - imageRect.y) / imageRect.height),
    };
  };

  const applyWindowMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    const live = sessionRef.current;
    if (!drag || !live) return;
    const target = clientToElementLocal(event.clientX, event.clientY);
    if (!target) return;

    if (drag.mode === 'pin') {
      const pin = targetToPin(target);
      lastPinRef.current = pin;
      setDragPin(pin);
      return;
    }

    const solved = solveTransformTowardTarget(
      geoRef.current!.geometry,
      drag.baseTransform,
      target,
      live.stretch,
    );
    if (solved.status !== 'ok') return;
    lastSolvedRef.current = solved.transform;
    setDragTransform(solved.transform);
    live.preview(solved.transform);
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
    setDragPin(null);
    lastSolvedRef.current = null;
    lastPinRef.current = null;
    suppressNextClick();
  };

  const handleWindowUp = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 다른 포인터의 up이 첫 드래그를 커밋하지 못하게 한다 (멀티터치)
    if (event.pointerId !== drag.pointerId) return;
    // 같은 프레임의 마지막 move가 rAF에 남아 있으면 커밋 전에 반영한다
    moveSchedulerRef.current?.flush();
    if (ownerGenerationRef.current === generationNow()) {
      if (drag.mode === 'aim' && lastSolvedRef.current) {
        drag.session.commit(lastSolvedRef.current);
      } else if (drag.mode === 'pin' && lastPinRef.current) {
        drag.session.commitContactPoint(lastPinRef.current);
      }
    }
    finishDrag();
  };

  const cancelActiveDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    // 스토어 세션이 먼저 닫혔어도 시작 시점 세션으로 preview 제스처를 닫는다
    if (drag.mode === 'aim') drag.session.cancel();
    finishDrag();
  };

  const generationNow = () => useSpritePoseGizmoStore.getState().generation;

  const handleWindowMove = (event: PointerEvent) => {
    if (event.pointerId !== dragRef.current?.pointerId) return;
    moveSchedulerRef.current?.push(event);
  };
  const handleWindowCancel = (event: PointerEvent) => {
    if (event.pointerId !== dragRef.current?.pointerId) return;
    cancelActiveDrag();
  };
  const handleWindowBlur = () => cancelActiveDrag();

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (dragRef.current) return;
    const mode: DragMode = event.altKey ? 'pin' : 'aim';
    if (mode === 'aim' && degenerate) return;
    event.preventDefault();
    event.stopPropagation();
    if (!tryAcquireDragSession()) return;

    const el = event.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // 미지원 환경은 커서 고정 없이 동작만 유지
    }
    beginDragCursor('grabbing', el.ownerDocument);
    grabbedRef.current = { el, pointerId: event.pointerId };
    ownerGenerationRef.current = generationNow();
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      baseTransform: session.transform,
      session,
    };
    cancelDragRef.current = cancelActiveDrag;
    moveSchedulerRef.current = createRafLatestScheduler(applyWindowMove);
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

  const knobTitle = degenerate
    ? t('propertiesPanel.spriteContactDegenerate') ||
      '핀이 기준점과 겹쳐 있습니다. Alt 드래그로 핀을 옮기세요'
    : t('propertiesPanel.spriteContactKnobHint') ||
      '드래그: 손끝을 키에 조준 · Alt 드래그: 핀 위치 이동';

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 'var(--z-canvas-gradient-editor)' }}
      data-sprite-pose-gizmo="true"
    >
      {/* 축→핀 안내선 */}
      <svg
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
        style={{ overflow: 'visible' }}
      >
        <line
          x1={axisScreen.x}
          y1={axisScreen.y}
          x2={knobScreen.x}
          y2={knobScreen.y}
          stroke="var(--ui-selection-border)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.7}
        />
        {/* 축(기준점) 표식 */}
        <circle
          cx={axisScreen.x}
          cy={axisScreen.y}
          r={3}
          fill="none"
          stroke="var(--ui-selection-border)"
          strokeWidth={1.5}
          opacity={0.8}
        />
      </svg>
      {/* 손끝 노브 - 유일한 히트 대상 */}
      <div
        role="button"
        aria-label={t('propertiesPanel.spriteContactPoint') || '손끝'}
        tabIndex={-1}
        title={knobTitle}
        onPointerDown={beginDrag}
        className="absolute pointer-events-auto"
        style={{
          left: knobScreen.x - KNOB_HIT_SIZE / 2,
          top: knobScreen.y - KNOB_HIT_SIZE / 2,
          width: KNOB_HIT_SIZE,
          height: KNOB_HIT_SIZE,
          cursor: degenerate ? 'not-allowed' : 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        data-sprite-contact-knob="true"
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: 'var(--ui-selection-border)',
            border: '2px solid rgba(255, 255, 255, 0.9)',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.4)',
            opacity: degenerate ? 0.45 : 1,
          }}
        />
      </div>
    </div>
  );
};

export default SpritePoseGizmo;
