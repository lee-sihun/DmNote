import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CounterAnimationBezier,
  KeyCounterSettings,
} from '@src/types/key/keys';
import type { CounterAnimationPreset } from '@src/types/key/counterAnimation';
import FullSurfaceModalLayout from '@components/main/Modal/FullSurfaceModalLayout';
import Dropdown from '@components/main/common/Dropdown';
import {
  TextInput,
  NumberInput,
} from '@components/main/Grid/PropertiesPanel/PropertyInputs';
import CountDisplay from '@components/overlay/counters/CountDisplay';
import {
  COUNTER_BEZIER_PRESETS,
  clampCounterBezier,
  findBezierPresetId,
} from '@utils/cubicBezier';
import {
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_COUNTER_FONT_SIZE,
  DEFAULT_COUNTER_FONT_WEIGHT,
} from '@utils/core/elementDefaults';
import { useKeyStore } from '@stores/data/useKeyStore';
import {
  computeCounterAnimationPreviewKeyStyles,
  type CounterAnimationKeyVisual,
} from '@utils/core/counterAnimationPreview';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';
import { counterAnimationApi } from '@api/modules/resourceApi';

type EditorMode = 'create' | 'edit';

interface CounterAnimationEditorModalProps {
  isOpen: boolean;
  mode: EditorMode;
  initialPreset?: CounterAnimationPreset | null;
  counterSettings?: KeyCounterSettings;
  keyVisual?: CounterAnimationKeyVisual;
  onClose: () => void;
  onSaved: (payload: {
    preset: CounterAnimationPreset;
    mode: EditorMode;
    affectedUsageCount: number;
  }) => void;
  t: (key: string) => string;
  /** 성능 계측용 비교 전략. 제품 경로는 프레임당 최신 입력만 반영한다. */
  continuousInputStrategy?: ContinuousInputStrategy;
}

type DragTarget = 'p1' | 'p2' | null;

const EDITOR_SIZE = 110;
const EDITOR_PADDING = 20;
const TOTAL_SIZE = EDITOR_SIZE + EDITOR_PADDING * 2;
const GRID_SUB = EDITOR_SIZE / 4;
const GRID_EXTENT = 40;
// 캔버스 그리드 색 — 커브 에디터와 미리보기 스테이지가 공유
// 흰색 알파 토큰이라 반투명 인셋 웰(글래스) 위에서 배경 톤을 따라 자연 합성됨
const GRID_MAJOR_COLOR = 'var(--ui-line)';
const GRID_MINOR_COLOR = 'var(--ui-line-faint)';
const HANDLE_RADIUS = 6;
const HANDLE_HIT_RADIUS = 10;
// 기준 렌더 크기 — 핸들·코너 화면 크기의 기준값 (실제 렌더는 캔버스 실측)
// 뷰박스 세로는 TOTAL_SIZE 기준, 가로는 캔버스 종횡비만큼 넓어지는 풀블리드 캔버스
// 오프셋 (0,0) = 커브 정사각이 뷰 중앙, 포인터 수학은 비율 좌표라 크기 변화에 안전
const EDITOR_RENDER_SIZE = 220;
const PAN_MARGIN = 14;
const MAX_DURATION = 5000;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3.0;
const ZOOM_SENSITIVITY = 0.002;
const AUTO_FIT_MARGIN = 14;
const AUTO_FIT_DURATION = 260;

// 격자 경로 — 월드 좌표가 정적이라 모듈에서 1회 생성, <line> 162개 대신 <path> 2개
const buildGridPath = (major: boolean) => {
  const far = GRID_EXTENT * GRID_SUB;
  const start = EDITOR_PADDING - far;
  const end = EDITOR_PADDING + far;
  const segments: string[] = [];
  for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
    if ((i % 4 === 0) !== major) continue;
    const pos = EDITOR_PADDING + i * GRID_SUB;
    segments.push(`M ${pos} ${start} V ${end}`);
    segments.push(`M ${start} ${pos} H ${end}`);
  }
  return segments.join(' ');
};
const GRID_PATH_MAJOR = buildGridPath(true);
const GRID_PATH_MINOR = buildGridPath(false);

// 뷰박스 치수 — 커브 정사각(TOTAL_SIZE)이 짧은 변에 맞고, 긴 변은 종횡비만큼 넓어짐
const viewDims = (scale: number, aspect: number) => {
  const base = TOTAL_SIZE / scale;
  const safeAspect = Math.max(aspect, 0.01);
  return {
    base,
    vbW: base * Math.max(safeAspect, 1),
    vbH: base * Math.max(1 / safeAspect, 1),
  };
};

const normalizeScale = (value: number) => {
  if (!Number.isFinite(value)) return 1.1;
  return value;
};

const clampDuration = (value: number) => {
  if (!Number.isFinite(value)) return 300;
  return Math.min(Math.max(Math.round(value), 1), MAX_DURATION);
};

const parseNumber = (raw: string): number | null => {
  if (!raw || raw === '-' || raw === '.' || raw === '-.') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatBezierInput = (bezier: CounterAnimationBezier): string =>
  bezier.map((value) => Number(Number(value).toFixed(2))).join(', ');

const parseBezierInput = (raw: string): CounterAnimationBezier | null => {
  const values = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (values.length !== 4) return null;

  const numbers = values.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  });
  if (numbers.some((v) => !Number.isFinite(v))) return null;

  const clamped = clampCounterBezier(numbers);
  return [clamped[0], clamped[1], clamped[2], clamped[3]];
};

const toInitialState = (preset: CounterAnimationPreset | null | undefined) => {
  if (!preset) {
    return {
      name: '',
      bezier: [0.25, 0.46, 0.45, 0.94] as CounterAnimationBezier,
      scale: 1.1,
      durationMs: 300,
    };
  }

  return {
    name: preset.name || '',
    bezier: clampCounterBezier(preset.bezier),
    scale: normalizeScale(preset.scale),
    durationMs: clampDuration(preset.durationMs),
  };
};

const CounterAnimationEditorModal = ({
  isOpen,
  mode,
  initialPreset,
  counterSettings,
  keyVisual,
  onClose,
  onSaved,
  t,
  continuousInputStrategy = 'frame',
}: CounterAnimationEditorModalProps) => {
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

  const [nameInput, setNameInput] = useState('');
  // 캔버스 실측 — 뷰박스 종횡비와 핸들 화면 크기 계산용
  const [editorSize, setEditorSize] = useState({
    width: EDITOR_RENDER_SIZE,
    height: EDITOR_RENDER_SIZE,
  });
  const [localBezier, setLocalBezier] = useState<CounterAnimationBezier>([
    0.25, 0.46, 0.45, 0.94,
  ]);
  const [bezierInput, setBezierInput] = useState('0.25, 0.46, 0.45, 0.94');
  const [scaleInput, setScaleInput] = useState('1.1');
  const [durationInput, setDurationInput] = useState('300');
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [viewScale, setViewScale] = useState(1);

  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [errorText, setErrorText] = useState('');

  const [previewCount, setPreviewCount] = useState(0);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewCss, setPreviewCss] = useState('');

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

    const ptsMinX = Math.min(...pts.map((p) => p.x));
    const ptsMaxX = Math.max(...pts.map((p) => p.x));
    const ptsMinY = Math.min(...pts.map((p) => p.y));
    const ptsMaxY = Math.max(...pts.map((p) => p.y));

    const minX = Math.min(ptsMinX, EDITOR_PADDING);
    const maxX = Math.max(ptsMaxX, EDITOR_PADDING + EDITOR_SIZE);
    const minY = Math.min(ptsMinY, EDITOR_PADDING);
    const maxY = Math.max(ptsMaxY, EDITOR_PADDING + EDITOR_SIZE);

    // 기본 뷰의 긴 변 허용 범위는 종횡비만큼 넓다 (측정 전에는 정사각 취급)
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
    // 긴 변은 종횡비만큼 더 보이므로 짧은 변 기준 크기로 환산해 맞춤
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

    // edit 모드: 컨트롤 포인트가 기본 뷰 밖이면 auto-fit, 아니면 기본 뷰
    // create 모드: 항상 기본 뷰
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

  // 캔버스 리사이즈 추적 - 첫 페인트 전에 실측해야 초기 aspect 불일치로
  // 커브가 늘어났다 복귀하는 프레임이 없음 (preserveAspectRatio=none).
  // 시트 본문은 첫 paint 뒤에 붙으므로(after-paint) 마운트 이펙트로는 노드를 못 잡는다.
  // 노드가 실제로 붙는 순간을 ref 콜백으로 받고, 콜백 정체성은 고정한다
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceHeldRef.current = true;
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
        }
        if (svgRef.current) {
          svgRef.current.style.cursor = 'grab';
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
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

  useEffect(() => {
    if (!isOpen) return;
    const loadCss = async () => {
      try {
        const [globalCss, globalUse, tabOverrides] = await Promise.all([
          window.api.css.get(),
          window.api.css.getUse(),
          window.api.css.tab.getAll(),
        ]);
        if (!globalUse) {
          setPreviewCss('');
          return;
        }
        const currentTab = useKeyStore.getState().selectedKeyType;
        const tabCss = tabOverrides[currentTab];
        if (tabCss) {
          if (!tabCss.enabled) {
            setPreviewCss('');
            return;
          }
          if (tabCss.path && tabCss.content) {
            setPreviewCss(tabCss.content);
            return;
          }
        }
        setPreviewCss(globalCss.content || '');
      } catch {
        setPreviewCss('');
      }
    };
    void loadCss();
  }, [isOpen]);

  // window 리스너는 pointerup/pointercancel 시 자가 정리돼서 클린업 추가 안 해뒀어요

  const handlePreviewPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    setPreviewActive(true);
    setPreviewCount((prev) => prev + 1);

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
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / AUTO_FIT_DURATION);
      const k = easeOutCubic(t);

      const newOffset = {
        x: fromOffset.x + (target.offset.x - fromOffset.x) * k,
        y: fromOffset.y + (target.offset.y - fromOffset.y) * k,
      };
      const newScale = fromScale + (target.scale - fromScale) * k;

      applyView(newOffset, newScale);

      if (t < 1) {
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

    // 축소 시 auto-pan 과도 이동 방지용 margin 제한
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
        const startOff = pinchStartOffsetRef.current;
        const worldX =
          startOff.x - (oldView.vbW - oldView.base) / 2 + fracX * oldView.vbW;
        const worldY =
          startOff.y - (oldView.vbH - oldView.base) / 2 + fracY * oldView.vbH;
        const newOff = {
          x: worldX + (newView.vbW - newView.base) / 2 - fracX * newView.vbW,
          y: worldY + (newView.vbH - newView.base) / 2 - fracY * newView.vbH,
        };

        applyView(newOff, newScale);
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

      // 컨트롤 포인트 드래그 종료 후 auto-fit
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
      // 드래그 중 모달이 닫히면 전역 커서도 함께 복원
      if (isPanningRef.current || dragTargetRef.current) endDragCursor();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
    // 핸들러는 ref만 읽어서 재구독 불필요 — 매 렌더 재등록이 드래그 렉을 만듦
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousInputStrategy, isOpen]);

  const handlePointPointerDown = (
    event: React.PointerEvent<SVGCircleElement>,
    target: DragTarget,
  ) => {
    if (event.button !== 0 || spaceHeldRef.current) return;
    // 드래그가 시작되면 텍스트 편집은 끝난 것으로 본다.
    // 아래 preventDefault가 포커스를 남기는데, 드래그는 베지어 입력값도 같이 바꾼다.
    // 편집 세션을 안 끊으면 뒤이은 Escape가 드래그 결과까지 함께 되돌린다
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, textarea')) {
      active.blur();
    }
    event.preventDefault();
    event.stopPropagation();
    cancelAutoFit();
    // 잡는 동안 grabbing 유지 - 좌표 클램프로 포인터가 핸들 밖에 있어도 복귀 방지
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

      const off = viewOffsetRef.current;
      const worldX = off.x - (vbW - base) / 2 + fracX * vbW;
      const worldY = off.y - (vbH - base) / 2 + fracY * vbH;
      const newOff = {
        x: worldX + (newView.vbW - newView.base) / 2 - fracX * newView.vbW,
        y: worldY + (newView.vbH - newView.base) / 2 - fracY * newView.vbH,
      };

      applyView(newOff, newScale);
      return;
    }

    const off = viewOffsetRef.current;
    const dx =
      ((event.shiftKey ? event.deltaX || event.deltaY : event.deltaX) /
        rect.width) *
      vbW;
    const dy =
      ((event.shiftKey && !event.deltaX ? 0 : event.deltaY) / rect.height) *
      vbH;
    const newOff = { x: off.x + dx, y: off.y + dy };
    viewOffsetRef.current = newOff;
    setViewOffset(newOff);
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

  const selectedPreset = findBezierPresetId(localBezier);

  const customLabel = t('counterSetting.presetCustom') || 'Custom';

  const presetOptions = (() => {
    const base = COUNTER_BEZIER_PRESETS.map((preset) => ({
      value: preset.id,
      label: preset.fallbackLabel,
    }));
    if (selectedPreset === 'custom') {
      return [{ value: 'custom', label: customLabel }, ...base];
    }
    return base;
  })();

  const handlePresetChange = (value: string) => {
    if (value === 'custom') return;
    const preset = COUNTER_BEZIER_PRESETS.find((item) => item.id === value);
    if (!preset) return;
    const nextBezier = clampCounterBezier(preset.bezier);
    localBezierRef.current = nextBezier;
    setLocalBezier(nextBezier);
    setBezierInput(formatBezierInput(nextBezier));

    cancelAutoFit();
    applyView({ x: 0, y: 0 }, 1);
  };

  const parsedScale = (() => {
    const parsed = parseNumber(scaleInput);
    const normalized = normalizeScale(parsed ?? 1.1);
    return Math.round(normalized * 100) / 100;
  })();

  const parsedDuration = (() => {
    const parsed = parseNumber(durationInput);
    return clampDuration(parsed ?? 300);
  })();

  const canSave = !isSaving && nameInput.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;

    const normalizedBezier: CounterAnimationBezier = [
      localBezierRef.current[0],
      localBezierRef.current[1],
      localBezierRef.current[2],
      localBezierRef.current[3],
    ];

    const requestBase = {
      name: nameInput.trim(),
      bezier: normalizedBezier,
      scale: parsedScale,
      durationMs: parsedDuration,
    };

    setErrorText('');
    setIsSaving(true);
    try {
      const response =
        mode === 'edit' && initialPreset
          ? await counterAnimationApi.update({
              id: initialPreset.id,
              ...requestBase,
            })
          : await counterAnimationApi.create(requestBase);

      if (!response) throw new Error('counter animation update failed');

      onSaved({
        preset: response.preset,
        mode,
        affectedUsageCount: response.affectedUsageCount,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save counter animation preset', error);
      setErrorText(
        t('counterSetting.saveAnimationFailed') || '모션 저장에 실패했습니다.',
      );
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const P = EDITOR_PADDING;
  const S = EDITOR_SIZE;
  const p1w = { x: P + localBezier[0] * S, y: P + (1 - localBezier[1]) * S };
  const p2w = { x: P + localBezier[2] * S, y: P + (1 - localBezier[3]) * S };
  const startW = { x: P, y: P + S };
  const endW = { x: P + S, y: P };

  const renderAspect =
    editorSize.height > 0 ? editorSize.width / editorSize.height : 1;
  const { base: vbBase, vbW, vbH } = viewDims(viewScale, renderAspect);
  const viewLeft = viewOffset.x - (vbW - vbBase) / 2;
  const viewTop = viewOffset.y - (vbH - vbBase) / 2;
  const viewBoxStr = `${viewLeft} ${viewTop} ${vbW} ${vbH}`;
  const ns = 1 / viewScale;
  // 캔버스와 줌에 관계없이 기존 손잡이 화면 크기 유지
  const uns =
    ns *
    (TOTAL_SIZE / Math.max(Math.min(editorSize.width, editorSize.height), 1));

  const headerTitle =
    mode === 'edit'
      ? t('counterSetting.editAnimationTitle') || '모션 편집'
      : t('counterSetting.createAnimationTitle') || '모션 추가';

  return (
    <FullSurfaceModalLayout
      onClose={onClose}
      title={headerTitle}
      headerInfo={
        <div className="min-w-0 flex items-center gap-[6px] text-fg-faint">
          <svg
            className="w-[14px] h-[14px] shrink-0"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          <span className="text-caption truncate">
            {t('counterSetting.motionPerformanceNotice') ||
              '모션 효과는 시스템 리소스를 추가로 사용합니다'}
          </span>
        </div>
      }
      submitLabel={
        isSaving
          ? t('counterSetting.saving') || '저장 중...'
          : t('common.save') || '저장'
      }
      submitDisabled={!canSave}
      onSubmit={() => {
        void handleSave();
      }}
      cancelLabel={t('common.cancel') || '취소'}
    >
      {/* 본문 — 상단: 캔버스 히어로 + 미리보기 무대, 하단: 파라미터 데크 */}
      <div className="flex-1 min-h-0 flex flex-col gap-[12px]">
        <div className="flex-1 min-h-0 flex gap-[12px]">
          {/* 커브 캔버스 — 카드 내부를 통째로 채우는 풀블리드 캔버스 */}
          <div className="flex-1 min-w-0 min-h-0 bg-fill-faint rounded-surface p-[10px] flex flex-col">
            <div
              ref={observeEditorArea}
              className="relative flex-1 min-h-0 min-w-0 rounded-md overflow-hidden bg-inset"
            >
              <svg
                ref={svgRef}
                data-counter-bezier-editor="true"
                className="absolute inset-0 w-full h-full"
                viewBox={viewBoxStr}
                preserveAspectRatio="xMidYMid meet"
                onWheel={handleWheel}
                onPointerDown={handleSvgPointerDown}
                onDoubleClick={handleDoubleClick}
                style={{ cursor: 'default', touchAction: 'none' }}
              >
                {/* 배경 웰은 컨테이너 div(bg-inset)가 소유 — 프레임별 좌표 갱신 제거 */}
                {/* 커브 작업 사각형 — 좌표 영역이라 라운딩 없이 각을 유지 */}
                <rect
                  x={P}
                  y={P}
                  width={S}
                  height={S}
                  fill="var(--ui-fill-faint)"
                />
                {/* crispEdges — CSS 그리드(미리보기)와 같은 또렷한 1px 라인 */}
                <path
                  d={GRID_PATH_MINOR}
                  fill="none"
                  stroke={GRID_MINOR_COLOR}
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  shapeRendering="crispEdges"
                />
                <path
                  d={GRID_PATH_MAJOR}
                  fill="none"
                  stroke={GRID_MAJOR_COLOR}
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  shapeRendering="crispEdges"
                />
                <rect
                  x={P}
                  y={P}
                  width={S}
                  height={S}
                  fill="none"
                  stroke="var(--ui-line)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={P}
                  y1={P + S}
                  x2={P + S}
                  y2={P}
                  stroke="var(--ui-line-strong)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="3 3"
                />
                <line
                  x1={startW.x}
                  y1={startW.y}
                  x2={p1w.x}
                  y2={p1w.y}
                  stroke="var(--ui-fg-disabled)"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={endW.x}
                  y1={endW.y}
                  x2={p2w.x}
                  y2={p2w.y}
                  stroke="var(--ui-fg-disabled)"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={`M ${startW.x} ${startW.y} C ${p1w.x} ${p1w.y}, ${p2w.x} ${p2w.y}, ${endW.x} ${endW.y}`}
                  fill="none"
                  stroke="var(--ui-accent)"
                  strokeWidth="1.8"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  data-counter-bezier-handle="p1"
                  cx={p1w.x}
                  cy={p1w.y}
                  r={HANDLE_HIT_RADIUS * uns}
                  fill="transparent"
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => handlePointPointerDown(e, 'p1')}
                />
                <circle
                  cx={p1w.x}
                  cy={p1w.y}
                  r={HANDLE_RADIUS * uns}
                  fill="var(--ui-bg-inset-solid)"
                  stroke="var(--ui-accent)"
                  strokeWidth={2 * uns}
                  style={{ pointerEvents: 'none' }}
                />
                <circle
                  data-counter-bezier-handle="p2"
                  cx={p2w.x}
                  cy={p2w.y}
                  r={HANDLE_HIT_RADIUS * uns}
                  fill="transparent"
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => handlePointPointerDown(e, 'p2')}
                />
                <circle
                  cx={p2w.x}
                  cy={p2w.y}
                  r={HANDLE_RADIUS * uns}
                  fill="var(--ui-bg-inset-solid)"
                  stroke="rgba(255, 255, 255, 0.85)"
                  strokeWidth={2 * uns}
                  style={{ pointerEvents: 'none' }}
                />
              </svg>
            </div>
          </div>

          {/* 미리보기 — 풀하이트 무대, 라벨 없이 스테이지 안 힌트만 */}
          <div className="w-[300px] shrink-0 min-h-0 bg-fill-faint rounded-surface p-[10px] flex flex-col">
            <div
              className="flex-1 min-h-0 flex items-center justify-center relative bg-inset rounded-md overflow-hidden cursor-pointer select-none"
              onPointerDown={handlePreviewPointerDown}
            >
              {previewCss && (
                <style dangerouslySetInnerHTML={{ __html: previewCss }} />
              )}
              {/* 그리드 — 커브 캔버스와 동일 팔레트 */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: `linear-gradient(${GRID_MINOR_COLOR} 1px, transparent 1px), linear-gradient(90deg, ${GRID_MINOR_COLOR} 1px, transparent 1px)`,
                  backgroundSize: '40px 40px',
                  backgroundPosition: 'center center',
                }}
              />
              <div className="relative z-10 w-full h-full flex items-center justify-center">
                {(() => {
                  const PREVIEW_MAX_W = 200;
                  const PREVIEW_MAX_H = 160;

                  const placement = counterSettings?.placement ?? 'inside';
                  const align = counterSettings?.align ?? 'top';
                  const alignMode = counterSettings?.alignMode ?? 'center';
                  const gap = counterSettings?.gap ?? 4;
                  const isInside = placement === 'inside';
                  const isHorizontal = align === 'left' || align === 'right';
                  const isBetween = alignMode === 'between';

                  const keyW = keyVisual?.width ?? 60;
                  const keyH = keyVisual?.height ?? 60;
                  const counterExtra =
                    (counterSettings?.fontSize ?? DEFAULT_COUNTER_FONT_SIZE) +
                    gap;

                  let totalW = keyW;
                  let totalH = keyH;
                  if (!isInside) {
                    if (align === 'left' || align === 'right')
                      totalW += counterExtra;
                    else totalH += counterExtra;
                  }

                  const fitScale = Math.min(
                    PREVIEW_MAX_W / totalW,
                    PREVIEW_MAX_H / totalH,
                    1,
                  );
                  const keyActive = previewActive && !keyVisual?.isStat;
                  const {
                    keyStyle: computedKeyStyle,
                    borderRingStyle,
                    imageStyle,
                    textStyle,
                    currentImageSrc,
                    hasCurrentImage,
                    isTransparent,
                    labelText,
                    useInline,
                  } = computeCounterAnimationPreviewKeyStyles({
                    keyVisual,
                    active: keyActive,
                    width: keyW,
                    height: keyH,
                  });

                  const labelEl = (
                    <span
                      className="pointer-events-none select-none leading-none text-safe-inline"
                      style={textStyle}
                    >
                      {labelText}
                    </span>
                  );

                  const counterEl = (
                    <CountDisplay
                      count={previewCount}
                      fillColor={
                        keyActive
                          ? counterSettings?.fill.active ??
                            DEFAULT_ELEMENT_ACTIVE_FONT
                          : counterSettings?.fill.idle ?? DEFAULT_ELEMENT_FONT
                      }
                      fillGradient={
                        keyActive
                          ? counterSettings?.fillActiveGradient ?? null
                          : counterSettings?.fillIdleGradient ?? null
                      }
                      globalKey="preview"
                      active={keyActive}
                      fontSize={
                        counterSettings?.fontSize ?? DEFAULT_COUNTER_FONT_SIZE
                      }
                      fontFamily={counterSettings?.fontFamily ?? null}
                      fontWeight={
                        counterSettings?.fontWeight ??
                        DEFAULT_COUNTER_FONT_WEIGHT
                      }
                      fontItalic={counterSettings?.fontItalic ?? false}
                      fontUnderline={counterSettings?.fontUnderline ?? false}
                      fontStrikethrough={
                        counterSettings?.fontStrikethrough ?? false
                      }
                      animationEnabled={true}
                      animationBezier={localBezier}
                      animationScale={parsedScale}
                      useInlineStyles={useInline}
                      animationDurationMs={parsedDuration}
                    />
                  );

                  const keyBoxStyle: React.CSSProperties = {
                    ...computedKeyStyle,
                    transform: 'none',
                    display: isTransparent ? 'none' : undefined,
                    zIndex: undefined,
                    cursor: undefined,
                  };

                  const outsideStyle: React.CSSProperties | undefined =
                    !isInside
                      ? {
                          position: 'absolute',
                          pointerEvents: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          ...(align === 'top' && {
                            bottom: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            paddingBottom: `${gap}px`,
                          }),
                          ...(align === 'bottom' && {
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            paddingTop: `${gap}px`,
                          }),
                          ...(align === 'left' && {
                            right: '100%',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            paddingRight: `${gap}px`,
                          }),
                          ...(align === 'right' && {
                            left: '100%',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            paddingLeft: `${gap}px`,
                          }),
                        }
                      : undefined;

                  return (
                    <div
                      className="relative"
                      style={
                        fitScale < 1
                          ? {
                              transform: `scale(${fitScale})`,
                              transformOrigin: 'center',
                            }
                          : undefined
                      }
                    >
                      <div
                        className={`relative flex items-center justify-center ${
                          keyVisual?.className || ''
                        }`}
                        style={keyBoxStyle}
                        data-state={keyActive ? 'active' : 'inactive'}
                        data-key-element="true"
                        data-key-image={hasCurrentImage ? 'true' : undefined}
                      >
                        {borderRingStyle && (
                          <span
                            aria-hidden="true"
                            data-gradient-border-ring="true"
                            style={borderRingStyle}
                          />
                        )}
                        {hasCurrentImage ? (
                          <img
                            src={currentImageSrc || ''}
                            alt=""
                            style={imageStyle}
                            draggable={false}
                          />
                        ) : isInside ? (
                          <div
                            className={`flex ${
                              isHorizontal ? '' : 'flex-col'
                            } w-full h-full items-center pointer-events-none select-none`}
                            style={{
                              justifyContent: isBetween
                                ? 'space-between'
                                : 'center',
                              padding: isBetween
                                ? isHorizontal
                                  ? `0 ${gap}px`
                                  : `${gap}px 0`
                                : '0',
                              gap: isBetween ? undefined : `${gap}px`,
                            }}
                          >
                            {(align === 'top' || align === 'left') && counterEl}
                            {labelEl}
                            {(align === 'bottom' || align === 'right') &&
                              counterEl}
                          </div>
                        ) : (
                          labelEl
                        )}
                      </div>
                      {!isInside && outsideStyle && (
                        <div
                          className={keyVisual?.className || undefined}
                          style={outsideStyle}
                        >
                          {counterEl}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              {/* 하단 안내 — 스크림 없이 흐린 캡션만 (풀하이트 스테이지라 키와 충돌 없음) */}
              <div className="absolute inset-x-0 bottom-[10px] z-20 text-center pointer-events-none">
                <span className="text-caption text-fg-faint">
                  {t('counterSetting.pressToPreview') || '눌러서 미리보기'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 파라미터 데크 — 하단 풀폭 항상 한 줄, 이름 입력이 남는 폭 흡수 */}
        <div className="shrink-0 bg-fill-faint rounded-surface px-[10px] py-[4px] flex flex-nowrap items-center gap-x-[10px] overflow-hidden">
          {/* 이름 필드 — 짧은 라벨 + 예시형 플레이스홀더, 입력이 남는 폭을 정확히 채워
                  옆 필드와 갭이 동일하게 유지됨 (라벨 길이가 긴 로케일도 flex로 자동 흡수) */}
          <div className="flex items-center gap-[8px] min-h-[32px] flex-1 min-w-0">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.nameLabel') || '이름'}
            </p>
            <input
              type="text"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder={
                t('counterSetting.animationNamePlaceholder') || '예: 내 모션'
              }
              className="flex-1 min-w-0 h-[23px] px-[8px] bg-inset rounded-md text-body text-fg placeholder-fg-faint outline-none focus:shadow-focus-ring transition-shadow duration-fast"
            />
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px]">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.presetLabel') || '프리셋'}
            </p>
            <Dropdown
              commitStrategy="after-paint"
              options={presetOptions}
              value={selectedPreset}
              onChange={(val) => handlePresetChange(String(val))}
              widthClass="w-[130px]"
            />
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px]">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.bezierLabel') || '베지어'}
            </p>
            <TextInput
              value={bezierInput}
              onChange={(raw) => {
                setBezierInput(raw);
                const parsed = parseBezierInput(raw);
                if (!parsed) return;
                localBezierRef.current = parsed;
                setLocalBezier(parsed);
              }}
              onBlur={() => {
                const parsed = parseBezierInput(bezierInput);
                if (!parsed) {
                  setBezierInput(formatBezierInput(localBezierRef.current));
                  return;
                }
                localBezierRef.current = parsed;
                setLocalBezier(parsed);
                setBezierInput(formatBezierInput(parsed));
              }}
              placeholder="0.25, 0.46, 0.45, 0.94"
              width="140px"
            />
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px]">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.scale') || '스케일'}
            </p>
            <NumberInput
              value={parsedScale}
              onChange={(val) => setScaleInput(String(val))}
              onBlur={(committed) => {
                // 확정값을 입력에서 직접 받는다. onChange가 예약한 scaleInput은
                // 같은 blur 이벤트 안에서 아직 이전 값이다
                const parsed = committed ?? parseNumber(scaleInput);
                const normalized = normalizeScale(parsed ?? 1.1);
                setScaleInput(String(Math.round(normalized * 100) / 100));
              }}
              allowDecimal={true}
              decimalScale={2}
              min={0}
              max={9999}
              width="54px"
            />
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px]">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.duration') || '지속 시간'}
            </p>
            <NumberInput
              value={parsedDuration}
              onChange={(val) => setDurationInput(String(val))}
              onBlur={(committed) => {
                // 확정값을 입력에서 직접 받는다. onChange가 예약한 durationInput은
                // 같은 blur 이벤트 안에서 아직 이전 값이다
                const parsed = committed ?? parseNumber(durationInput);
                const normalized = clampDuration(parsed ?? 300);
                setDurationInput(String(normalized));
              }}
              width="54px"
              min={100}
              max={5000}
            />
          </div>
        </div>

        {errorText ? (
          <p className="shrink-0 text-caption leading-[14px] text-danger-fg">
            {errorText}
          </p>
        ) : null}
      </div>
    </FullSurfaceModalLayout>
  );
};

export default CounterAnimationEditorModal;
