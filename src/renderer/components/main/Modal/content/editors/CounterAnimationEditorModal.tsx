import React, { useEffect, useRef, useState } from 'react';
import type {
  CounterAnimationBezier,
  KeyCounterSettings,
} from '@src/types/key/keys';
import type { CounterAnimationPreset } from '@src/types/key/counterAnimation';
import Modal from '@components/main/Modal/Modal';
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
import { useKeyStore } from '@stores/data/useKeyStore';

type EditorMode = 'create' | 'edit';

interface KeyVisualProps {
  width?: number;
  height?: number;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  fontColor?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrikethrough?: boolean;
  displayText?: string;
  displayName?: string;
  className?: string;
  activeBackgroundColor?: string;
  activeBorderColor?: string;
  activeFontColor?: string;
  useInlineStyles?: boolean;
  isStat?: boolean;
}

interface CounterAnimationEditorModalProps {
  isOpen: boolean;
  mode: EditorMode;
  initialPreset?: CounterAnimationPreset | null;
  counterSettings?: KeyCounterSettings;
  keyVisual?: KeyVisualProps;
  onClose: () => void;
  onSaved: (payload: {
    preset: CounterAnimationPreset;
    mode: EditorMode;
    affectedUsageCount: number;
  }) => void;
  t: (key: string) => string;
}

type DragTarget = 'p1' | 'p2' | null;

const EDITOR_SIZE = 110;
const EDITOR_PADDING = 20;
const TOTAL_SIZE = EDITOR_SIZE + EDITOR_PADDING * 2;
const GRID_SUB = EDITOR_SIZE / 4;
const GRID_EXTENT = 24;
const HANDLE_RADIUS = 6;
const HANDLE_HIT_RADIUS = 10;
const PAN_MARGIN = 14;
const MAX_DURATION = 5000;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3.0;
const ZOOM_SENSITIVITY = 0.002;
const AUTO_FIT_MARGIN = 14;
const AUTO_FIT_DURATION = 260;

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

  const [nameInput, setNameInput] = useState('');
  const [localBezier, setLocalBezier] = useState<CounterAnimationBezier>([
    0.25, 0.46, 0.45, 0.94,
  ]);
  const [bezierInput, setBezierInput] = useState('0.25, 0.46, 0.45, 0.94');
  const [scaleInput, setScaleInput] = useState('1.1');
  const [durationInput, setDurationInput] = useState('300');
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [viewScale, setViewScale] = useState(1);

  const [isSaving, setIsSaving] = useState(false);
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

    const defaultBox = { minX: 0, minY: 0, maxX: TOTAL_SIZE, maxY: TOTAL_SIZE };

    if (
      minX >= defaultBox.minX &&
      maxX <= defaultBox.maxX &&
      minY >= defaultBox.minY &&
      maxY <= defaultBox.maxY
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
    const needSize = Math.max(needW, needH, TOTAL_SIZE);

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
    const vbSize = TOTAL_SIZE / scale;

    const worldX = offset.x + fracX * vbSize;
    const worldY = offset.y + fracY * vbSize;

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

    if (hx < offset.x + margin) nx = hx - margin;
    else if (hx > offset.x + vbSize - margin) nx = hx - vbSize + margin;
    if (hy < offset.y + margin) ny = hy - margin;
    else if (hy > offset.y + vbSize - margin) ny = hy - vbSize + margin;

    if (nx !== offset.x || ny !== offset.y) {
      const next = { x: nx, y: ny };
      viewOffsetRef.current = next;
      setViewOffset(next);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointersRef.current.has(event.pointerId)) {
        activePointersRef.current.set(event.pointerId, {
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }

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

        const fracX = pinchStartMidFracRef.current.x;
        const fracY = pinchStartMidFracRef.current.y;
        const oldVB = TOTAL_SIZE / oldScale;
        const newVB = TOTAL_SIZE / newScale;
        const startOff = pinchStartOffsetRef.current;
        const worldX = startOff.x + fracX * oldVB;
        const worldY = startOff.y + fracY * oldVB;
        const newOff = {
          x: worldX - fracX * newVB,
          y: worldY - fracY * newVB,
        };

        applyView(newOff, newScale);
        return;
      }

      if (isPanningRef.current) {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const scale = viewScaleRef.current;
        const vbSize = TOTAL_SIZE / scale;
        const dxClient = event.clientX - panStartRef.current.clientX;
        const dyClient = event.clientY - panStartRef.current.clientY;
        const dxWorld = -(dxClient / rect.width) * vbSize;
        const dyWorld = -(dyClient / rect.height) * vbSize;

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

    const handlePointerUp = (event: PointerEvent) => {
      activePointersRef.current.delete(event.pointerId);
      if (activePointersRef.current.size < 2) {
        pinchStartDistRef.current = 0;
      }

      if (isPanningRef.current) {
        isPanningRef.current = false;
        if (svgRef.current) {
          svgRef.current.style.cursor = spaceHeldRef.current
            ? 'grab'
            : 'default';
        }
        return;
      }

      // 컨트롤 포인트 드래그 종료 후 auto-fit
      if (dragTargetRef.current) {
        animateViewToFit(localBezierRef.current);
      }

      draggedBezierRef.current = null;
      dragTargetRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  });

  const handlePointPointerDown = (
    event: React.PointerEvent<SVGCircleElement>,
    target: DragTarget,
  ) => {
    if (event.button !== 0 || spaceHeldRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    cancelAutoFit();
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
    const vbSize = TOTAL_SIZE / scale;

    if (event.ctrlKey || event.metaKey) {
      const fracX = (event.clientX - rect.left) / rect.width;
      const fracY = (event.clientY - rect.top) / rect.height;

      const oldVB = vbSize;
      const delta = -event.deltaY * ZOOM_SENSITIVITY;
      const factor = Math.exp(delta);
      const newScale = Math.min(Math.max(scale * factor, MIN_ZOOM), MAX_ZOOM);
      const newVB = TOTAL_SIZE / newScale;

      const off = viewOffsetRef.current;
      const worldX = off.x + fracX * oldVB;
      const worldY = off.y + fracY * oldVB;
      const newOff = {
        x: worldX - fracX * newVB,
        y: worldY - fracY * newVB,
      };

      applyView(newOff, newScale);
      return;
    }

    const off = viewOffsetRef.current;
    const dx =
      ((event.shiftKey ? event.deltaX || event.deltaY : event.deltaX) /
        rect.width) *
      vbSize;
    const dy =
      ((event.shiftKey && !event.deltaX ? 0 : event.deltaY) / rect.height) *
      vbSize;
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

  const gridLines = (() => {
    const lines: React.ReactElement[] = [];
    const far = GRID_EXTENT * GRID_SUB;
    for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
      const pos = EDITOR_PADDING + i * GRID_SUB;
      const isMajor = i % 4 === 0;
      const color = isMajor ? '#3A3943' : '#2D2D35';
      lines.push(
        <line
          key={`gv${i}`}
          x1={pos}
          y1={EDITOR_PADDING - far}
          x2={pos}
          y2={EDITOR_PADDING + far}
          stroke={color}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />,
      );
      lines.push(
        <line
          key={`gh${i}`}
          x1={EDITOR_PADDING - far}
          y1={pos}
          x2={EDITOR_PADDING + far}
          y2={pos}
          stroke={color}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />,
      );
    }
    return lines;
  })();

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
    if (!canSave) return;

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
          ? await window.api.counterAnimation.update({
              id: initialPreset.id,
              ...requestBase,
            })
          : await window.api.counterAnimation.create(requestBase);

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

  const vbSize = TOTAL_SIZE / viewScale;
  const viewBoxStr = `${viewOffset.x} ${viewOffset.y} ${vbSize} ${vbSize}`;
  const ns = 1 / viewScale;

  const headerTitle =
    mode === 'edit'
      ? t('counterSetting.editAnimationTitle') || '모션 편집'
      : t('counterSetting.createAnimationTitle') || '모션 추가';

  return (
    <Modal onClick={onClose}>
      <div
        className="w-[730px] max-w-[calc(100vw-80px)] h-[366px] flex flex-col bg-elevated rounded-[12px] shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[37px] bg-white/[0.04] px-[12px] flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-[8px]">
            <span className="px-[6px] h-[18px] rounded-md bg-elevated text-caption leading-[18px] font-semibold tracking-[0.2px] text-accent-hover">
              Motion
            </span>
            <span className="truncate text-body leading-[16px] text-fg">
              {headerTitle}
            </span>
          </div>
        </div>

        <div className="flex-1 p-[16px] flex gap-[16px] bg-inset min-h-0">
          <div className="w-[390px] flex flex-col gap-[16px] min-h-0 shrink-0">
            <div>
              <input
                type="text"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder={
                  t('counterSetting.animationNamePlaceholder') || '모션 이름'
                }
                className="w-full h-[32px] px-[12px] rounded-[8px] bg-app text-body leading-[16px] text-fg placeholder-fg-faint outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all font-medium shadow-inner"
              />
            </div>

            <div className="flex-1 flex gap-[16px] p-[16px] rounded-[10px] bg-elevated shadow-sm min-h-0 items-center">
              <div className="shrink-0 flex flex-col">
                <div
                  className="rounded-[8px] bg-inset overflow-hidden"
                  style={{
                    width: `${TOTAL_SIZE + 16}px`,
                    height: `${TOTAL_SIZE + 16}px`,
                    padding: '8px',
                  }}
                >
                  <div
                    className="relative rounded-[6px] overflow-hidden"
                    style={{
                      width: `${TOTAL_SIZE}px`,
                      height: `${TOTAL_SIZE}px`,
                    }}
                  >
                    <svg
                      ref={svgRef}
                      className="absolute inset-0"
                      width={TOTAL_SIZE}
                      height={TOTAL_SIZE}
                      viewBox={viewBoxStr}
                      onWheel={handleWheel}
                      onPointerDown={handleSvgPointerDown}
                      onDoubleClick={handleDoubleClick}
                      style={{ cursor: 'default', touchAction: 'none' }}
                    >
                      <rect
                        x={viewOffset.x}
                        y={viewOffset.y}
                        width={vbSize}
                        height={vbSize}
                        fill="#0F0F13"
                      />
                      <rect
                        x={P}
                        y={P}
                        width={S}
                        height={S}
                        fill="#18181D"
                        rx={6 * ns}
                        ry={6 * ns}
                      />
                      {gridLines}
                      <rect
                        x={P}
                        y={P}
                        width={S}
                        height={S}
                        fill="none"
                        stroke="#2A2A30"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                        rx={6 * ns}
                        ry={6 * ns}
                      />
                      <line
                        x1={P}
                        y1={P + S}
                        x2={P + S}
                        y2={P}
                        stroke="#34343D"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={startW.x}
                        y1={startW.y}
                        x2={p1w.x}
                        y2={p1w.y}
                        stroke="#505058"
                        strokeWidth="1.2"
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1={endW.x}
                        y1={endW.y}
                        x2={p2w.x}
                        y2={p2w.y}
                        stroke="#505058"
                        strokeWidth="1.2"
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        d={`M ${startW.x} ${startW.y} C ${p1w.x} ${p1w.y}, ${p2w.x} ${p2w.y}, ${endW.x} ${endW.y}`}
                        fill="none"
                        stroke="#459BF8"
                        strokeWidth="1.8"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={p1w.x}
                        cy={p1w.y}
                        r={HANDLE_HIT_RADIUS * ns}
                        fill="transparent"
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => handlePointPointerDown(e, 'p1')}
                      />
                      <circle
                        cx={p1w.x}
                        cy={p1w.y}
                        r={HANDLE_RADIUS * ns}
                        fill="#1A191E"
                        stroke="#459BF8"
                        strokeWidth={2 * ns}
                        style={{ pointerEvents: 'none' }}
                      />
                      <circle
                        cx={p2w.x}
                        cy={p2w.y}
                        r={HANDLE_HIT_RADIUS * ns}
                        fill="transparent"
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => handlePointPointerDown(e, 'p2')}
                      />
                      <circle
                        cx={p2w.x}
                        cy={p2w.y}
                        r={HANDLE_RADIUS * ns}
                        fill="#1A191E"
                        stroke="#FFB400"
                        strokeWidth={2 * ns}
                        style={{ pointerEvents: 'none' }}
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-[12px] justify-start pt-[2px]">
                <div className="flex flex-col gap-[6px] [&>div]:w-full [&_button]:w-full">
                  <label className="text-caption font-medium text-fg-muted">
                    Preset
                  </label>
                  <Dropdown
                    options={presetOptions}
                    value={selectedPreset}
                    onChange={(val) => handlePresetChange(String(val))}
                    fullWidth
                  />
                </div>

                <div className="flex flex-col gap-[6px]">
                  <label className="text-caption font-medium text-fg-muted">
                    Cubic Bezier
                  </label>
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
                        setBezierInput(
                          formatBezierInput(localBezierRef.current),
                        );
                        return;
                      }
                      localBezierRef.current = parsed;
                      setLocalBezier(parsed);
                      setBezierInput(formatBezierInput(parsed));
                    }}
                    placeholder="0.25, 0.46, 0.45, 0.94"
                    width="100%"
                  />
                </div>

                <div className="flex gap-[12px]">
                  <div className="flex-1 flex flex-col gap-[6px]">
                    <label className="text-caption font-medium text-fg-muted">
                      {t('counterSetting.scale') || '스케일'}
                    </label>
                    <NumberInput
                      value={parsedScale}
                      onChange={(val) => setScaleInput(String(val))}
                      onBlur={() => {
                        const parsed = parseNumber(scaleInput);
                        const normalized = normalizeScale(parsed ?? 1.1);
                        setScaleInput(
                          String(Math.round(normalized * 100) / 100),
                        );
                      }}
                      allowDecimal={true}
                      decimalScale={2}
                      width="100%"
                    />
                  </div>

                  <div className="flex-1 flex flex-col gap-[6px]">
                    <label className="text-caption font-medium text-fg-muted">
                      {t('counterSetting.duration') || '지속 시간'}
                    </label>
                    <NumberInput
                      value={parsedDuration}
                      onChange={(val) => setDurationInput(String(val))}
                      onBlur={() => {
                        const parsed = parseNumber(durationInput);
                        const normalized = clampDuration(parsed ?? 300);
                        setDurationInput(String(normalized));
                      }}
                      width="100%"
                      min={100}
                      max={5000}
                    />
                  </div>
                </div>
              </div>
            </div>

            {errorText ? (
              <p className="text-caption leading-[14px] text-danger-fg mt-[-8px] ml-[2px]">
                {errorText}
              </p>
            ) : null}
          </div>

          <div className="flex-1 flex flex-col min-w-0 bg-app rounded-[10px] overflow-hidden shadow-inner relative">
            <div
              className="flex-1 min-h-0 flex items-center justify-center relative bg-inset rounded-[10px] cursor-pointer select-none"
              onPointerDown={handlePreviewPointerDown}
            >
              {previewCss && (
                <style dangerouslySetInnerHTML={{ __html: previewCss }} />
              )}
              <div
                className="absolute inset-0 opacity-[0.15] pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(#2A2A30 1px, transparent 1px), linear-gradient(90deg, #2A2A30 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
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
                  const gap = counterSettings?.gap ?? 6;
                  const isInside = placement === 'inside';
                  const isHorizontal = align === 'left' || align === 'right';
                  const isBetween = alignMode === 'between';

                  const keyW = keyVisual?.width ?? 60;
                  const keyH = keyVisual?.height ?? 60;
                  const counterExtra = (counterSettings?.fontSize ?? 16) + gap;

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

                  const keyLabelDecorations: string[] = [];
                  if (keyVisual?.fontUnderline)
                    keyLabelDecorations.push('underline');
                  if (keyVisual?.fontStrikethrough)
                    keyLabelDecorations.push('line-through');

                  const labelEl = (
                    <span
                      className="pointer-events-none select-none leading-none"
                      style={{
                        fontSize: `${keyVisual?.fontSize ?? 14}px`,
                        fontFamily: keyVisual?.fontFamily
                          ? `"${keyVisual.fontFamily}", "Pretendard Variable", sans-serif`
                          : undefined,
                        fontWeight: keyVisual?.fontWeight ?? 700,
                        fontStyle: keyVisual?.fontItalic ? 'italic' : 'normal',
                        textDecoration:
                          keyLabelDecorations.length > 0
                            ? keyLabelDecorations.join(' ')
                            : 'none',
                      }}
                    >
                      {keyVisual?.displayText || keyVisual?.displayName || 'A'}
                    </span>
                  );

                  const counterEl = (
                    <CountDisplay
                      count={previewCount}
                      fillColor={
                        previewActive
                          ? counterSettings?.fill.active ?? '#FFFFFF'
                          : counterSettings?.fill.idle ??
                            'rgba(121, 121, 121, 0.9)'
                      }
                      strokeColor={
                        previewActive
                          ? counterSettings?.stroke.active ?? 'transparent'
                          : counterSettings?.stroke.idle ?? 'transparent'
                      }
                      globalKey="preview"
                      active={previewActive}
                      fontSize={counterSettings?.fontSize ?? 16}
                      fontFamily={counterSettings?.fontFamily ?? null}
                      fontWeight={counterSettings?.fontWeight ?? 700}
                      fontItalic={counterSettings?.fontItalic ?? false}
                      fontUnderline={counterSettings?.fontUnderline ?? false}
                      fontStrikethrough={
                        counterSettings?.fontStrikethrough ?? false
                      }
                      animationEnabled={true}
                      animationBezier={localBezier}
                      animationScale={parsedScale}
                      animationDurationMs={parsedDuration}
                    />
                  );

                  // Key.jsx 스타일 로직 재현 (CSS 변수 호환용)
                  // 통계항목은 키 비주얼에 active 상태 변화를 주지 않음
                  const useInline = keyVisual?.useInlineStyles === true;
                  const keyActive = previewActive && !keyVisual?.isStat;
                  const stateBackgroundColor = keyActive
                    ? keyVisual?.activeBackgroundColor ??
                      keyVisual?.backgroundColor
                    : keyVisual?.backgroundColor;
                  const stateBorderColor = keyActive
                    ? keyVisual?.activeBorderColor ?? keyVisual?.borderColor
                    : keyVisual?.borderColor;
                  const stateFontColor = keyActive
                    ? keyVisual?.activeFontColor ?? keyVisual?.fontColor
                    : keyVisual?.fontColor;
                  const defaultBgColor = keyActive
                    ? 'rgba(121, 121, 121, 0.9)'
                    : 'rgba(46, 46, 47, 0.9)';
                  const defaultBorderColor = keyActive
                    ? 'rgba(255, 255, 255, 0.9)'
                    : 'rgba(113, 113, 113, 0.9)';
                  const defaultTextColor = keyActive
                    ? '#FFFFFF'
                    : 'rgba(121, 121, 121, 0.9)';
                  const bw = keyVisual?.borderWidth ?? 3;
                  const br = keyVisual?.borderRadius ?? 10;

                  const keyBoxStyle: React.CSSProperties = {
                    width: `${keyW}px`,
                    height: `${keyH}px`,
                    backgroundColor:
                      useInline && stateBackgroundColor
                        ? stateBackgroundColor
                        : `var(--key-bg, ${
                            stateBackgroundColor || defaultBgColor
                          })`,
                    borderRadius: useInline
                      ? `${br}px`
                      : `var(--key-radius, ${br}px)`,
                    border: useInline
                      ? `${bw}px solid ${
                          stateBorderColor || defaultBorderColor
                        }`
                      : `var(--key-border, ${bw}px solid ${
                          stateBorderColor || defaultBorderColor
                        })`,
                    color:
                      useInline && stateFontColor
                        ? stateFontColor
                        : `var(--key-text-color, ${
                            stateFontColor || defaultTextColor
                          })`,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
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
                        className={`flex items-center justify-center shadow-2xl ${
                          keyVisual?.className || ''
                        }`}
                        style={keyBoxStyle}
                        data-state={keyActive ? 'active' : 'inactive'}
                        data-key-element="true"
                      >
                        {isInside ? (
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
                        <div style={outsideStyle}>{counterEl}</div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="absolute bottom-0 left-0 right-0 flex justify-center items-end h-12 bg-gradient-to-t from-black/50 to-transparent pointer-events-none">
                <span className="mb-2.5 text-white/70 text-body font-medium tracking-wide">
                  {t('counterSetting.pressToPreview') || '눌러서 미리보기'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/[0.04] px-[12px] py-[10px] flex items-center gap-[8px]">
          <div className="flex items-center gap-1.5 mr-auto">
            <svg
              className="w-3.5 h-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="#8A8D99"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </svg>
            <span className="text-caption text-fg-muted tracking-wide">
              {t('counterSetting.motionPerformanceNotice') ||
                '모션 효과는 시스템 리소스를 추가로 사용합니다'}
            </span>
          </div>
          <button
            type="button"
            className={`w-[120px] h-[30px] rounded-lg text-label transition-colors duration-fast ${
              canSave
                ? 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active'
                : 'bg-white/[0.04] text-fg-disabled cursor-not-allowed'
            }`}
            disabled={!canSave}
            onClick={() => {
              void handleSave();
            }}
          >
            {isSaving
              ? t('counterSetting.saving') || '저장 중...'
              : t('common.save') || '저장'}
          </button>
          <button
            type="button"
            className="px-[24px] h-[30px] bg-white/[0.05] hover:bg-white/[0.08] active:bg-white/[0.11] rounded-lg text-fg-muted hover:text-fg text-label transition-colors duration-fast"
            onClick={onClose}
          >
            {t('common.cancel') || '취소'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default CounterAnimationEditorModal;
