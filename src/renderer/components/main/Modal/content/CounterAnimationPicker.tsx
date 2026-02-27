import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CounterAnimationBezier,
  KeyCounterAnimationSettings,
} from "@src/types/keys";
import Dropdown from "@components/main/common/Dropdown";
import FloatingPopup from "../FloatingPopup";
import {
  COUNTER_BEZIER_PRESETS,
  clampCounterBezier,
  findBezierPresetId,
} from "@utils/cubicBezier";

interface CounterAnimationPickerProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLElement>;
  panelElement?: HTMLElement | null;
  animation: KeyCounterAnimationSettings;
  onAnimationChange: (next: KeyCounterAnimationSettings) => void;
  onClose: () => void;
  t: (key: string) => string;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
}

type DragTarget = "p1" | "p2" | null;

const EDITOR_SIZE = 112;
const EDITOR_PADDING = 18;
const TOTAL_SIZE = EDITOR_SIZE + EDITOR_PADDING * 2;
const MAX_DURATION = 5000;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_SENSITIVITY = 0.002;
const GRID_SUB = EDITOR_SIZE / 4;
const GRID_EXTENT = 24;
const HANDLE_RADIUS = 6;
const HANDLE_HIT_RADIUS = 10;
const PAN_MARGIN = 14;
const RESET_DURATION = 300;

const normalizeScale = (value: number) => {
  if (!Number.isFinite(value)) return 1.1;
  return value;
};

const clampDuration = (value: number) => {
  if (!Number.isFinite(value)) return 300;
  return Math.min(Math.max(Math.round(value), 1), MAX_DURATION);
};

const parseNumber = (raw: string): number | null => {
  if (!raw || raw === "-" || raw === "." || raw === "-.") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatBezierInput = (bezier: CounterAnimationBezier): string =>
  bezier.map((value) => Number(Number(value).toFixed(2))).join(", ");

const parseBezierInput = (raw: string): CounterAnimationBezier | null => {
  const values = raw
    .split(",")
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

export default function CounterAnimationPicker({
  open,
  referenceRef,
  panelElement = null,
  animation,
  onAnimationChange,
  onClose,
  t,
  interactiveRefs = [],
}: CounterAnimationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragTargetRef = useRef<DragTarget>(null);
  const animationSnapshotRef = useRef<KeyCounterAnimationSettings>(animation);
  const localBezierRef = useRef<CounterAnimationBezier>(animation.bezier);
  const committedScaleRef = useRef<number>(animation.scale);
  const committedDurationRef = useRef<number>(animation.durationMs);
  const draggedBezierRef = useRef<CounterAnimationBezier | null>(null);
  const viewOffsetRef = useRef({ x: 0, y: 0 });
  const viewScaleRef = useRef(1);
  const resetAnimRef = useRef<number | null>(null);

  const [fixedPosition, setFixedPosition] = useState<{ x: number; y: number } | null>(null);
  const [localBezier, setLocalBezier] = useState<CounterAnimationBezier>(
    clampCounterBezier(animation.bezier),
  );
  const [bezierInput, setBezierInput] = useState(
    formatBezierInput(clampCounterBezier(animation.bezier)),
  );
  const [scaleInput, setScaleInput] = useState(String(animation.scale));
  const [durationInput, setDurationInput] = useState(String(animation.durationMs));
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [viewScale, setViewScale] = useState(1);

  useEffect(() => {
    animationSnapshotRef.current = animation;
  }, [animation]);

  useEffect(() => {
    if (!open) return;
    const nextBezier = clampCounterBezier(animation.bezier);
    localBezierRef.current = nextBezier;
    setLocalBezier(nextBezier);
    setBezierInput(formatBezierInput(nextBezier));
    committedScaleRef.current = animation.scale;
    committedDurationRef.current = animation.durationMs;
    setScaleInput(String(animation.scale));
    setDurationInput(String(animation.durationMs));
  }, [animation.bezier, animation.durationMs, animation.scale, open]);

  useEffect(() => {
    if (!open) {
      setFixedPosition(null);
      viewOffsetRef.current = { x: 0, y: 0 };
      viewScaleRef.current = 1;
      setViewOffset({ x: 0, y: 0 });
      setViewScale(1);
      return;
    }

    if (!panelElement) {
      setFixedPosition(null);
      return;
    }

    requestAnimationFrame(() => {
      const panelRect = panelElement.getBoundingClientRect();
      const popupEl = containerRef.current;
      const popupWidth = popupEl ? popupEl.offsetWidth : 188;
      const popupHeight = popupEl ? popupEl.offsetHeight : 296;
      const gap = 5;
      const padding = 5;
      const panelBottomPadding = 20;

      let fixedX = panelRect.left - popupWidth - gap;
      if (fixedX < padding) fixedX = padding;

      let fixedY = panelRect.bottom - panelBottomPadding - popupHeight;
      if (fixedY < padding) fixedY = padding;

      setFixedPosition({ x: fixedX, y: fixedY });
    });
  }, [open, panelElement]);

  const emitAnimationUpdate = useCallback(
    (next: {
      bezier?: CounterAnimationBezier;
      scale?: number;
      durationMs?: number;
    }) => {
      const current = animationSnapshotRef.current;
      onAnimationChange({
        ...current,
        bezier: next.bezier ?? localBezierRef.current,
        scale: next.scale ?? committedScaleRef.current,
        durationMs: next.durationMs ?? committedDurationRef.current,
      });
    },
    [onAnimationChange],
  );

  const updateBezierFromClient = useCallback(
    (clientX: number, clientY: number, target: DragTarget) => {
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
        target === "p1"
          ? [Math.min(Math.max(bezierX, 0), 1), Math.min(Math.max(bezierY, -2), 2), current[2], current[3]]
          : [current[0], current[1], Math.min(Math.max(bezierX, 0), 1), Math.min(Math.max(bezierY, -2), 2)];

      const clamped = clampCounterBezier(nextBezier);
      localBezierRef.current = clamped;
      setLocalBezier(clamped);
      setBezierInput(formatBezierInput(clamped));
      draggedBezierRef.current = clamped;

      // Auto-pan: keep handle visible in viewport
      const hx = EDITOR_PADDING + (target === "p1" ? clamped[0] : clamped[2]) * EDITOR_SIZE;
      const hy = EDITOR_PADDING + (1 - (target === "p1" ? clamped[1] : clamped[3])) * EDITOR_SIZE;

      const margin = PAN_MARGIN / scale;
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
    },
    [],
  );

  const animateViewReset = useCallback(() => {
    if (resetAnimRef.current) cancelAnimationFrame(resetAnimRef.current);
    const startOffset = { ...viewOffsetRef.current };
    const startScale = viewScaleRef.current;
    const needsOffset = Math.abs(startOffset.x) >= 0.5 || Math.abs(startOffset.y) >= 0.5;
    const needsScale = Math.abs(startScale - 1) >= 0.01;
    if (!needsOffset && !needsScale) {
      viewOffsetRef.current = { x: 0, y: 0 };
      viewScaleRef.current = 1;
      setViewOffset({ x: 0, y: 0 });
      setViewScale(1);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / RESET_DURATION, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const o = { x: startOffset.x * (1 - ease), y: startOffset.y * (1 - ease) };
      const s = startScale + (1 - startScale) * ease;
      viewOffsetRef.current = o;
      viewScaleRef.current = s;
      setViewOffset(o);
      setViewScale(s);
      if (p < 1) resetAnimRef.current = requestAnimationFrame(step);
      else resetAnimRef.current = null;
    };
    resetAnimRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerMove = (event: PointerEvent) => {
      updateBezierFromClient(event.clientX, event.clientY, dragTargetRef.current);
    };

    const handlePointerUp = () => {
      if (draggedBezierRef.current) {
        emitAnimationUpdate({ bezier: draggedBezierRef.current });
        setBezierInput(formatBezierInput(draggedBezierRef.current));
      }
      draggedBezierRef.current = null;
      dragTargetRef.current = null;
      animateViewReset();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [emitAnimationUpdate, open, updateBezierFromClient, animateViewReset]);

  const handlePointPointerDown = useCallback(
    (event: React.PointerEvent<SVGCircleElement>, target: DragTarget) => {
      event.preventDefault();
      if (resetAnimRef.current) {
        cancelAnimationFrame(resetAnimRef.current);
        resetAnimRef.current = null;
      }
      draggedBezierRef.current = null;
      dragTargetRef.current = target;
    },
    [],
  );

  const handleWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const fracX = (event.clientX - rect.left) / rect.width;
    const fracY = (event.clientY - rect.top) / rect.height;

    const oldScale = viewScaleRef.current;
    const oldVB = TOTAL_SIZE / oldScale;

    const delta = -event.deltaY * ZOOM_SENSITIVITY;
    const factor = Math.exp(delta);
    const newScale = Math.min(Math.max(oldScale * factor, MIN_ZOOM), MAX_ZOOM);
    const newVB = TOTAL_SIZE / newScale;

    const off = viewOffsetRef.current;
    const worldX = off.x + fracX * oldVB;
    const worldY = off.y + fracY * oldVB;
    const newOff = { x: worldX - fracX * newVB, y: worldY - fracY * newVB };

    viewScaleRef.current = newScale;
    viewOffsetRef.current = newOff;
    setViewScale(newScale);
    setViewOffset(newOff);
  }, []);

  const selectedPreset = useMemo(
    () => findBezierPresetId(localBezier),
    [localBezier],
  );

  const presetOptions = useMemo(() => {
    return [
      {
        value: "custom",
        label: t("counterSetting.presetCustom") || "Custom",
      },
      ...COUNTER_BEZIER_PRESETS.map((preset) => ({
        value: preset.id,
        label: t(preset.labelKey) || preset.fallbackLabel,
      })),
    ];
  }, [t]);

  const handlePresetChange = useCallback(
    (value: string) => {
      if (value === "custom") return;
      const preset = COUNTER_BEZIER_PRESETS.find((item) => item.id === value);
      if (!preset) return;
      const nextBezier = clampCounterBezier(preset.bezier);
      localBezierRef.current = nextBezier;
      setLocalBezier(nextBezier);
      setBezierInput(formatBezierInput(nextBezier));
      emitAnimationUpdate({ bezier: nextBezier });
    },
    [emitAnimationUpdate],
  );

  // Grid lines (static, reused across renders)
  const gridLines = useMemo(() => {
    const lines: React.ReactElement[] = [];
    const far = GRID_EXTENT * GRID_SUB;
    for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
      const pos = EDITOR_PADDING + i * GRID_SUB;
      const isMajor = i % 4 === 0;
      const color = isMajor ? "#3A3943" : "#2D2D35";
      lines.push(
        <line key={`gv${i}`} x1={pos} y1={EDITOR_PADDING - far} x2={pos} y2={EDITOR_PADDING + far}
          stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />,
      );
      lines.push(
        <line key={`gh${i}`} x1={EDITOR_PADDING - far} y1={pos} x2={EDITOR_PADDING + far} y2={pos}
          stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />,
      );
    }
    return lines;
  }, []);

  // World positions
  const P = EDITOR_PADDING;
  const S = EDITOR_SIZE;
  const p1w = { x: P + localBezier[0] * S, y: P + (1 - localBezier[1]) * S };
  const p2w = { x: P + localBezier[2] * S, y: P + (1 - localBezier[3]) * S };
  const startW = { x: P, y: P + S };
  const endW = { x: P + S, y: P };

  const vbSize = TOTAL_SIZE / viewScale;
  const viewBoxStr = `${viewOffset.x} ${viewOffset.y} ${vbSize} ${vbSize}`;

  // Non-scaling sizes
  const ns = 1 / viewScale;

  return (
    <FloatingPopup
      open={open}
      referenceRef={referenceRef}
      fixedX={fixedPosition?.x}
      fixedY={fixedPosition?.y}
      placement="right-start"
      offset={32}
      offsetY={fixedPosition ? 0 : -93}
      className="z-50"
      onClose={onClose}
      autoClose={false}
      interactiveRefs={interactiveRefs}
    >
      <div
        ref={containerRef}
        className="w-[188px] p-[8px] rounded-[13px] border border-[#2A2A30] bg-[#1A191E] flex flex-col gap-[8px]"
      >
        {/* Graph area */}
        <div
          className="w-full rounded-[9px] border border-[#2A2A30] bg-[#17161A] overflow-hidden"
          style={{ width: `${TOTAL_SIZE + 12 + 2}px`, height: `${TOTAL_SIZE + 12 + 2}px`, padding: "6px", margin: "0 auto" }}
        >
          <div
            className="relative rounded-[7px] overflow-hidden"
            style={{ width: `${TOTAL_SIZE}px`, height: `${TOTAL_SIZE}px` }}
          >
            <svg
              ref={svgRef}
              className="absolute inset-0"
              width={TOTAL_SIZE}
              height={TOTAL_SIZE}
              viewBox={viewBoxStr}
              onWheel={handleWheel}
              style={{ cursor: "default", touchAction: "none" }}
            >
              {/* Background fill */}
              <rect
                x={viewOffset.x} y={viewOffset.y}
                width={vbSize} height={vbSize}
                fill="#17161A"
              />

              {/* Unit square background */}
              <rect x={P} y={P} width={S} height={S} fill="#1F1E23" rx={7 * ns} ry={7 * ns} />

              {/* Grid lines */}
              {gridLines}

              {/* Unit square border */}
              <rect x={P} y={P} width={S} height={S} fill="none" stroke="#3A3943"
                strokeWidth="1" vectorEffect="non-scaling-stroke" rx={7 * ns} ry={7 * ns} />

              {/* Diagonal reference (linear) */}
              <line
                x1={P} y1={P + S} x2={P + S} y2={P}
                stroke="#34343D" strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={`3 3`}
              />

              {/* Control line: start -> P1 */}
              <line
                x1={startW.x} y1={startW.y} x2={p1w.x} y2={p1w.y}
                stroke="#505058" strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              {/* Control line: end -> P2 */}
              <line
                x1={endW.x} y1={endW.y} x2={p2w.x} y2={p2w.y}
                stroke="#505058" strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />

              {/* Bezier curve */}
              <path
                d={`M ${startW.x} ${startW.y} C ${p1w.x} ${p1w.y}, ${p2w.x} ${p2w.y}, ${endW.x} ${endW.y}`}
                fill="none"
                stroke="#459BF8"
                strokeWidth="1.8"
                vectorEffect="non-scaling-stroke"
              />

              {/* Handle P1 */}
              <circle
                cx={p1w.x} cy={p1w.y} r={HANDLE_HIT_RADIUS * ns}
                fill="transparent" style={{ cursor: "grab" }}
                onPointerDown={(e) => handlePointPointerDown(e, "p1")}
              />
              <circle
                cx={p1w.x} cy={p1w.y} r={HANDLE_RADIUS * ns}
                fill="#1A191E" stroke="#459BF8"
                strokeWidth={2 * ns}
                style={{ pointerEvents: "none" }}
              />

              {/* Handle P2 */}
              <circle
                cx={p2w.x} cy={p2w.y} r={HANDLE_HIT_RADIUS * ns}
                fill="transparent" style={{ cursor: "grab" }}
                onPointerDown={(e) => handlePointPointerDown(e, "p2")}
              />
              <circle
                cx={p2w.x} cy={p2w.y} r={HANDLE_RADIUS * ns}
                fill="#1A191E" stroke="#FFB400"
                strokeWidth={2 * ns}
                style={{ pointerEvents: "none" }}
              />
            </svg>
          </div>
        </div>

        {/* Bezier value input (separated from graph) */}
        <input
          type="text"
          value={bezierInput}
          onChange={(event) => {
            const raw = event.target.value;
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
            emitAnimationUpdate({ bezier: parsed });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          className="w-full h-[23px] rounded-[7px] border border-[#3A3943] bg-[#2A2A30] px-[7px] text-[#DBDEE8] text-style-4 text-center outline-none focus:border-[#459BF8]"
          placeholder="0.25, 0.46, 0.45, 0.94"
        />

        <div className="h-[1px] bg-[#2A2A30] -mx-[8px]" />

        <div className="flex flex-col gap-[5px]">
          <p className="text-[#DBDEE8] text-style-4">
            {t("counterSetting.curvePreset") || "Curve Preset"}
          </p>
          <Dropdown
            options={presetOptions}
            value={selectedPreset}
            onChange={handlePresetChange}
            fullWidth
          />
        </div>

        <div className="h-[1px] bg-[#2A2A30] -mx-[8px]" />

        <div className="flex flex-col gap-[6px]">
          <div className="w-full">
            <p className="text-[#DBDEE8] text-style-4 mb-[4px]">
              {t("counterSetting.scale") || "Scale"}
            </p>
            <input
              type="text"
              inputMode="decimal"
              value={scaleInput}
              onChange={(event) => {
                const raw = event.target.value.replace(/[^0-9.-]/g, "");
                setScaleInput(raw);
              }}
              onBlur={() => {
                const parsed = parseNumber(scaleInput);
                const normalized = normalizeScale(parsed ?? animation.scale);
                const rounded = Math.round(normalized * 10) / 10;
                committedScaleRef.current = rounded;
                setScaleInput(String(rounded));
                emitAnimationUpdate({ scale: rounded });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              className="w-full h-[23px] rounded-[7px] border border-[#3A3943] bg-[#2A2A30] text-[#DBDEE8] text-style-4 text-center outline-none focus:border-[#459BF8]"
            />
          </div>
          <div className="w-full">
            <p className="text-[#DBDEE8] text-style-4 mb-[4px]">
              {t("counterSetting.duration") || "Duration"}
            </p>
            <input
              type="text"
              inputMode="numeric"
              value={durationInput}
              onChange={(event) => {
                const raw = event.target.value.replace(/[^0-9]/g, "");
                setDurationInput(raw);
                const parsed = parseNumber(raw);
                if (parsed === null) return;
                const normalized = clampDuration(parsed);
                committedDurationRef.current = normalized;
                emitAnimationUpdate({ durationMs: normalized });
              }}
              onBlur={() => {
                const parsed = parseNumber(durationInput);
                const normalized = clampDuration(parsed ?? animation.durationMs);
                committedDurationRef.current = normalized;
                setDurationInput(String(normalized));
                emitAnimationUpdate({ durationMs: normalized });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              className="w-full h-[23px] rounded-[7px] border border-[#3A3943] bg-[#2A2A30] text-[#DBDEE8] text-style-4 text-center outline-none focus:border-[#459BF8]"
            />
          </div>
        </div>
      </div>
    </FloatingPopup>
  );
}
