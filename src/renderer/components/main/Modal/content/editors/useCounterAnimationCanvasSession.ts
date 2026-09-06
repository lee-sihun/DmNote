import { beginDragCursor, endDragCursor } from '@utils/dom/dragCursor';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CounterAnimationBezier } from '@src/types/key/keys';
import type { CounterAnimationPreset } from '@src/types/key/counterAnimation';
import { clampCounterBezier } from '@utils/cubicBezier';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';
import {
  COUNTER_EDITOR_PADDING as EDITOR_PADDING,
  COUNTER_EDITOR_SIZE as EDITOR_SIZE,
  COUNTER_EDITOR_TOTAL_SIZE as TOTAL_SIZE,
  createCounterAnimationEditorState as toInitialState,
  formatCounterBezierInput as formatBezierInput,
  resolveCounterEditorViewDimensions as viewDims,
} from './counterAnimationEditorModel';
import { COUNTER_ANIMATION_HANDLE_RADIUS as HANDLE_RADIUS } from './CounterAnimationCurveCanvas';

type EditorMode = 'create' | 'edit';
type DragTarget = 'p1' | 'p2' | null;

const EDITOR_RENDER_SIZE = 220;
const PAN_MARGIN = 14;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3.0;
const ZOOM_SENSITIVITY = 0.002;
const AUTO_FIT_MARGIN = 14;
const AUTO_FIT_DURATION = 260;

interface UseCounterAnimationCanvasSessionOptions {
  isOpen: boolean;
  mode: EditorMode;
  initialPreset?: CounterAnimationPreset | null;
  continuousInputStrategy: ContinuousInputStrategy;
  setNameInput: React.Dispatch<React.SetStateAction<string>>;
  setScaleInput: React.Dispatch<React.SetStateAction<string>>;
  setDurationInput: React.Dispatch<React.SetStateAction<string>>;
  setErrorText: React.Dispatch<React.SetStateAction<string>>;
}

export const useCounterAnimationCanvasSession = ({
  isOpen,
  mode,
  initialPreset,
  continuousInputStrategy,
  setNameInput,
  setScaleInput,
  setDurationInput,
  setErrorText,
}: UseCounterAnimationCanvasSessionOptions) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragTargetRef = useRef<DragTarget>(null);
  const localBezierRef = useRef<CounterAnimationBezier>([
    0.25, 0.46, 0.45, 0.94,
  ]);
  const draggedBezierRef = useRef<CounterAnimationBezier | null>(null);
  const viewOffsetRef = useRef({ x: 0, y: 0 });
  const viewScaleRef = useRef(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({
    clientX: 0,
    clientY: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const spaceHeldRef = useRef(false);
  const activePointersRef = useRef<
    Map<number, { clientX: number; clientY: number }>
  >(new Map());
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const pinchStartOffsetRef = useRef({ x: 0, y: 0 });
  const pinchStartMidFracRef = useRef({ x: 0, y: 0 });
  const autoFitRafRef = useRef<number | null>(null);
  const editorSizeRef = useRef({
    width: EDITOR_RENDER_SIZE,
    height: EDITOR_RENDER_SIZE,
  });

  const [editorSize, setEditorSize] = useState({
    width: EDITOR_RENDER_SIZE,
    height: EDITOR_RENDER_SIZE,
  });
  const [localBezier, setLocalBezier] = useState<CounterAnimationBezier>([
    0.25, 0.46, 0.45, 0.94,
  ]);
  const [bezierInput, setBezierInput] = useState('0.25, 0.46, 0.45, 0.94');
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [viewScale, setViewScale] = useState(1);
  const [previewCount, setPreviewCount] = useState(0);
  const [previewActive, setPreviewActive] = useState(false);

  const cancelAutoFit = () => {
    if (autoFitRafRef.current) {
      cancelAnimationFrame(autoFitRafRef.current);
      autoFitRafRef.current = null;
    }
  };

  const applyView = (offset: { x: number; y: number }, scale: number) => {
    viewOffsetRef.current = offset;
    viewScaleRef.current = scale;
    setViewOffset(offset);
    setViewScale(scale);
  };

  const computeAutoFit = (bezier: CounterAnimationBezier) => {
    const pts = [
      { x: EDITOR_PADDING, y: EDITOR_PADDING + EDITOR_SIZE },
      { x: EDITOR_PADDING + EDITOR_SIZE, y: EDITOR_PADDING },
      {
        x: EDITOR_PADDING + bezier[0] * EDITOR_SIZE,
        y: EDITOR_PADDING + (1 - bezier[1]) * EDITOR_SIZE,
      },
      {
        x: EDITOR_PADDING + bezier[2] * EDITOR_SIZE,
        y: EDITOR_PADDING + (1 - bezier[3]) * EDITOR_SIZE,
      },
    ];

    const ptsMinX = Math.min(...pts.map((point) => point.x));
    const ptsMaxX = Math.max(...pts.map((point) => point.x));
    const ptsMinY = Math.min(...pts.map((point) => point.y));
    const ptsMaxY = Math.max(...pts.map((point) => point.y));

    const minX = Math.min(ptsMinX, EDITOR_PADDING);
    const maxX = Math.max(ptsMaxX, EDITOR_PADDING + EDITOR_SIZE);
    const minY = Math.min(ptsMinY, EDITOR_PADDING);
    const maxY = Math.max(ptsMaxY, EDITOR_PADDING + EDITOR_SIZE);

    const { width: canvasW, height: canvasH } = editorSizeRef.current;
    const aspect = canvasH > 0 ? canvasW / canvasH : 1;
    const defaultView = viewDims(1, aspect);
    const defaultExtraW = (defaultView.vbW - TOTAL_SIZE) / 2;
    const defaultExtraH = (defaultView.vbH - TOTAL_SIZE) / 2;

    if (
      minX >= -defaultExtraW &&
      maxX <= TOTAL_SIZE + defaultExtraW &&
      minY >= -defaultExtraH &&
      maxY <= TOTAL_SIZE + defaultExtraH
    ) {
      return { offset: { x: 0, y: 0 }, scale: 1 };
    }

    const rawW = maxX - minX;
    const rawH = maxY - minY;
    const rawSize = Math.max(rawW, rawH, TOTAL_SIZE);
    const estHandleR = (HANDLE_RADIUS * rawSize) / TOTAL_SIZE;
    const margin = AUTO_FIT_MARGIN + estHandleR;

    const fitMinX = minX - margin;
    const fitMaxX = maxX + margin;
    const fitMinY = minY - margin;
    const fitMaxY = maxY + margin;

    const needW = fitMaxX - fitMinX;
    const needH = fitMaxY - fitMinY;
    const needSize = Math.max(
      needW / Math.max(aspect, 1),
      needH * Math.min(Math.max(aspect, 0.01), 1),
      TOTAL_SIZE,
    );

    const maxVB = TOTAL_SIZE / MIN_ZOOM;
    const vbSize = Math.min(needSize, maxVB);
    const fitScale = TOTAL_SIZE / vbSize;

    const cx = (fitMinX + fitMaxX) / 2;
    const cy = (fitMinY + fitMaxY) / 2;

    return {
      offset: { x: cx - vbSize / 2, y: cy - vbSize / 2 },
      scale: fitScale,
    };
  };

  useEffect(() => {
    if (!isOpen) return;
    const initial = toInitialState(initialPreset);
    localBezierRef.current = initial.bezier;
    setNameInput(initial.name);
    setLocalBezier(initial.bezier);
    setBezierInput(formatBezierInput(initial.bezier));
    setScaleInput(String(Math.round(initial.scale * 100) / 100));
    setDurationInput(String(initial.durationMs));
    setErrorText('');

    const fit =
      mode === 'edit' && initialPreset
        ? computeAutoFit(initial.bezier)
        : { offset: { x: 0, y: 0 }, scale: 1 };
    applyView(fit.offset, fit.scale);
    isPanningRef.current = false;
    activePointersRef.current.clear();
    pinchStartDistRef.current = 0;
    setPreviewCount(0);
    setPreviewActive(false);
    // setter와 계산 함수는 원본과 같은 열림 경계에서만 사용한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPreset, isOpen, mode]);

  useEffect(() => {
    if (isOpen) return;
    setPreviewActive(false);
    isPanningRef.current = false;
    spaceHeldRef.current = false;
    activePointersRef.current.clear();
    pinchStartDistRef.current = 0;
    cancelAutoFit();
  }, [isOpen]);

  useEffect(() => () => cancelAutoFit(), []);

  const observeEditorArea = useCallback((area: HTMLDivElement | null) => {
    if (!area) return;
    const measure = () => {
      const rect = area.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width <= 0 || height <= 0) return;
      editorSizeRef.current = { width, height };
      setEditorSize({ width, height });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) {
        spaceHeldRef.current = true;
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          event.preventDefault();
        }
        if (svgRef.current) {
          svgRef.current.style.cursor = 'grab';
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceHeldRef.current = false;
        if (svgRef.current && !isPanningRef.current) {
          svgRef.current.style.cursor = 'default';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      spaceHeldRef.current = false;
    };
  }, [isOpen]);

  const handlePreviewPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    setPreviewActive(true);
    setPreviewCount((previous) => previous + 1);

    const handleUp = () => {
      setPreviewActive(false);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const animateViewToFit = (bezier: CounterAnimationBezier) => {
    cancelAutoFit();

    const target = computeAutoFit(bezier);
    const fromOffset = { ...viewOffsetRef.current };
    const fromScale = viewScaleRef.current;

    const EPS = 1e-3;
    if (
      Math.abs(target.offset.x - fromOffset.x) < EPS &&
      Math.abs(target.offset.y - fromOffset.y) < EPS &&
      Math.abs(target.scale - fromScale) < EPS
    ) {
      return;
    }

    const start = performance.now();
    const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / AUTO_FIT_DURATION);
      const easing = easeOutCubic(progress);

      const newOffset = {
        x: fromOffset.x + (target.offset.x - fromOffset.x) * easing,
        y: fromOffset.y + (target.offset.y - fromOffset.y) * easing,
      };
      const newScale = fromScale + (target.scale - fromScale) * easing;

      applyView(newOffset, newScale);

      if (progress < 1) {
        autoFitRafRef.current = requestAnimationFrame(tick);
      } else {
        autoFitRafRef.current = null;
      }
    };

    autoFitRafRef.current = requestAnimationFrame(tick);
  };

  const updateBezierFromClient = (
    clientX: number,
    clientY: number,
    target: DragTarget,
  ) => {
    if (!target || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();

    const fracX = (clientX - rect.left) / rect.width;
    const fracY = (clientY - rect.top) / rect.height;

    const scale = viewScaleRef.current;
    const offset = viewOffsetRef.current;
    const { base, vbW, vbH } = viewDims(
      scale,
      rect.width / Math.max(rect.height, 1),
    );
    const extraW = (vbW - base) / 2;
    const extraH = (vbH - base) / 2;

    const worldX = offset.x - extraW + fracX * vbW;
    const worldY = offset.y - extraH + fracY * vbH;

    const bezierX = (worldX - EDITOR_PADDING) / EDITOR_SIZE;
    const bezierY = 1 - (worldY - EDITOR_PADDING) / EDITOR_SIZE;

    const current = localBezierRef.current;
    const nextBezier: CounterAnimationBezier =
      target === 'p1'
        ? [
            Math.min(Math.max(bezierX, 0), 1),
            Math.min(Math.max(bezierY, -4), 4),
            current[2],
            current[3],
          ]
        : [
            current[0],
            current[1],
            Math.min(Math.max(bezierX, 0), 1),
            Math.min(Math.max(bezierY, -4), 4),
          ];

    const clamped = clampCounterBezier(nextBezier);
    localBezierRef.current = clamped;
    setLocalBezier(clamped);
    setBezierInput(formatBezierInput(clamped));
    draggedBezierRef.current = clamped;

    const hx =
      EDITOR_PADDING +
      (target === 'p1' ? clamped[0] : clamped[2]) * EDITOR_SIZE;
    const hy =
      EDITOR_PADDING +
      (1 - (target === 'p1' ? clamped[1] : clamped[3])) * EDITOR_SIZE;

    const effectiveScale = Math.max(scale, 0.8);
    const margin = PAN_MARGIN / effectiveScale;
    let nx = offset.x;
    let ny = offset.y;

    const viewLeft = offset.x - extraW;
    const viewTop = offset.y - extraH;
    if (hx < viewLeft + margin) nx = hx - margin + extraW;
    else if (hx > viewLeft + vbW - margin) nx = hx - vbW + margin + extraW;
    if (hy < viewTop + margin) ny = hy - margin + extraH;
    else if (hy > viewTop + vbH - margin) ny = hy - vbH + margin + extraH;

    if (nx !== offset.x || ny !== offset.y) {
      const next = { x: nx, y: ny };
      viewOffsetRef.current = next;
      setViewOffset(next);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const applyPointerMove = (event: PointerEvent) => {
      if (
        activePointersRef.current.size === 2 &&
        pinchStartDistRef.current > 0
      ) {
        const svg = svgRef.current;
        if (!svg) return;
        const pointers = Array.from(activePointersRef.current.values());
        const dx = pointers[1].clientX - pointers[0].clientX;
        const dy = pointers[1].clientY - pointers[0].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ratio = dist / pinchStartDistRef.current;
        const oldScale = pinchStartScaleRef.current;
        const newScale = Math.min(
          Math.max(oldScale * ratio, MIN_ZOOM),
          MAX_ZOOM,
        );

        const rect = svg.getBoundingClientRect();
        const aspect = rect.width / Math.max(rect.height, 1);
        const fracX = pinchStartMidFracRef.current.x;
        const fracY = pinchStartMidFracRef.current.y;
        const oldView = viewDims(oldScale, aspect);
        const newView = viewDims(newScale, aspect);
        const startOffset = pinchStartOffsetRef.current;
        const worldX =
          startOffset.x -
          (oldView.vbW - oldView.base) / 2 +
          fracX * oldView.vbW;
        const worldY =
          startOffset.y -
          (oldView.vbH - oldView.base) / 2 +
          fracY * oldView.vbH;
        const newOffset = {
          x: worldX + (newView.vbW - newView.base) / 2 - fracX * newView.vbW,
          y: worldY + (newView.vbH - newView.base) / 2 - fracY * newView.vbH,
        };

        applyView(newOffset, newScale);
        return;
      }

      if (isPanningRef.current) {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const scale = viewScaleRef.current;
        const { vbW, vbH } = viewDims(
          scale,
          rect.width / Math.max(rect.height, 1),
        );
        const dxClient = event.clientX - panStartRef.current.clientX;
        const dyClient = event.clientY - panStartRef.current.clientY;
        const dxWorld = -(dxClient / rect.width) * vbW;
        const dyWorld = -(dyClient / rect.height) * vbH;

        const newOffset = {
          x: panStartRef.current.offsetX + dxWorld,
          y: panStartRef.current.offsetY + dyWorld,
        };
        viewOffsetRef.current = newOffset;
        setViewOffset(newOffset);
        return;
      }

      updateBezierFromClient(
        event.clientX,
        event.clientY,
        dragTargetRef.current,
      );
    };
    const moveScheduler = createRafLatestScheduler(
      applyPointerMove,
      continuousInputStrategy,
    );
    const handlePointerMove = (event: PointerEvent) => {
      if (activePointersRef.current.has(event.pointerId)) {
        activePointersRef.current.set(event.pointerId, {
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }
      moveScheduler.push(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      moveScheduler.flush();
      activePointersRef.current.delete(event.pointerId);
      if (activePointersRef.current.size < 2) {
        pinchStartDistRef.current = 0;
      }

      if (isPanningRef.current) {
        isPanningRef.current = false;
        endDragCursor();
        if (svgRef.current) {
          svgRef.current.style.cursor = spaceHeldRef.current
            ? 'grab'
            : 'default';
        }
        return;
      }

      if (dragTargetRef.current) {
        endDragCursor();
        animateViewToFit(localBezierRef.current);
      }

      draggedBezierRef.current = null;
      dragTargetRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      moveScheduler.cancel();
      if (isPanningRef.current || dragTargetRef.current) endDragCursor();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousInputStrategy, isOpen]);

  const handlePointPointerDown = (
    event: React.PointerEvent<SVGCircleElement>,
    target: DragTarget,
  ) => {
    if (event.button !== 0 || spaceHeldRef.current) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, textarea')) {
      active.blur();
    }
    event.preventDefault();
    event.stopPropagation();
    cancelAutoFit();
    beginDragCursor('grabbing');
    dragTargetRef.current = target;
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    cancelAutoFit();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const scale = viewScaleRef.current;
    const aspect = rect.width / Math.max(rect.height, 1);
    const { base, vbW, vbH } = viewDims(scale, aspect);

    if (event.ctrlKey || event.metaKey) {
      const fracX = (event.clientX - rect.left) / rect.width;
      const fracY = (event.clientY - rect.top) / rect.height;

      const delta = -event.deltaY * ZOOM_SENSITIVITY;
      const factor = Math.exp(delta);
      const newScale = Math.min(Math.max(scale * factor, MIN_ZOOM), MAX_ZOOM);
      const newView = viewDims(newScale, aspect);

      const offset = viewOffsetRef.current;
      const worldX = offset.x - (vbW - base) / 2 + fracX * vbW;
      const worldY = offset.y - (vbH - base) / 2 + fracY * vbH;
      const newOffset = {
        x: worldX + (newView.vbW - newView.base) / 2 - fracX * newView.vbW,
        y: worldY + (newView.vbH - newView.base) / 2 - fracY * newView.vbH,
      };

      applyView(newOffset, newScale);
      return;
    }

    const offset = viewOffsetRef.current;
    const dx =
      ((event.shiftKey ? event.deltaX || event.deltaY : event.deltaX) /
        rect.width) *
      vbW;
    const dy =
      ((event.shiftKey && !event.deltaX ? 0 : event.deltaY) / rect.height) *
      vbH;
    const newOffset = { x: offset.x + dx, y: offset.y + dy };
    viewOffsetRef.current = newOffset;
    setViewOffset(newOffset);
  };

  const handleSvgPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    cancelAutoFit();
    activePointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });

    if (activePointersRef.current.size === 2) {
      dragTargetRef.current = null;
      isPanningRef.current = false;
      const pointers = Array.from(activePointersRef.current.values());
      const dx = pointers[1].clientX - pointers[0].clientX;
      const dy = pointers[1].clientY - pointers[0].clientY;
      pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
      pinchStartScaleRef.current = viewScaleRef.current;
      pinchStartOffsetRef.current = { ...viewOffsetRef.current };
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        const midX = (pointers[0].clientX + pointers[1].clientX) / 2;
        const midY = (pointers[0].clientY + pointers[1].clientY) / 2;
        pinchStartMidFracRef.current = {
          x: (midX - rect.left) / rect.width,
          y: (midY - rect.top) / rect.height,
        };
      }
      return;
    }

    if (event.button === 1 || (event.button === 0 && spaceHeldRef.current)) {
      event.preventDefault();
      if (dragTargetRef.current) return;
      isPanningRef.current = true;
      panStartRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        offsetX: viewOffsetRef.current.x,
        offsetY: viewOffsetRef.current.y,
      };
      beginDragCursor('grabbing');
      if (svgRef.current) {
        svgRef.current.style.cursor = 'grabbing';
      }
    }
  };

  const handleDoubleClick = (_event: React.MouseEvent<SVGSVGElement>) => {
    cancelAutoFit();
    applyView({ x: 0, y: 0 }, 1);
  };

  return {
    svgRef,
    localBezierRef,
    editorSize,
    localBezier,
    setLocalBezier,
    bezierInput,
    setBezierInput,
    viewOffset,
    viewScale,
    previewCount,
    previewActive,
    cancelAutoFit,
    applyView,
    observeEditorArea,
    handlePreviewPointerDown,
    handlePointPointerDown,
    handleWheel,
    handleSvgPointerDown,
    handleDoubleClick,
  };
};
