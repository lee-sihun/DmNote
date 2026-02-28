import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CounterAnimationBezier, KeyCounterSettings } from "@src/types/keys";
import type { CounterAnimationPreset } from "@src/types/counterAnimation";
import Modal from "@components/main/Modal/Modal";
import Dropdown from "@components/main/common/Dropdown";
import CountDisplay from "@components/overlay/CountDisplay";
import {
  COUNTER_BEZIER_PRESETS,
  clampCounterBezier,
  findBezierPresetId,
} from "@utils/cubicBezier";

type EditorMode = "create" | "edit";

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

type DragTarget = "p1" | "p2" | null;

const EDITOR_SIZE = 140;
const EDITOR_PADDING = 20;
const TOTAL_SIZE = EDITOR_SIZE + EDITOR_PADDING * 2;
const GRID_SUB = EDITOR_SIZE / 4;
const GRID_EXTENT = 24;
const HANDLE_RADIUS = 6;
const HANDLE_HIT_RADIUS = 10;
const PAN_MARGIN = 14;
const MAX_DURATION = 5000;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_SENSITIVITY = 0.002;

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

const toInitialState = (
  preset: CounterAnimationPreset | null | undefined,
  t: (key: string) => string,
) => {
  const fallbackName =
    t("counterSetting.newAnimationDefaultName") || "새 애니메이션";

  if (!preset) {
    return {
      name: fallbackName,
      bezier: [0.25, 0.46, 0.45, 0.94] as CounterAnimationBezier,
      scale: 1.1,
      durationMs: 300,
    };
  }

  return {
    name: preset.name || fallbackName,
    bezier: clampCounterBezier(preset.bezier),
    scale: normalizeScale(preset.scale),
    durationMs: clampDuration(preset.durationMs),
  };
};

export default function CounterAnimationEditorModal({
  isOpen,
  mode,
  initialPreset,
  counterSettings,
  keyVisual,
  onClose,
  onSaved,
  t,
}: CounterAnimationEditorModalProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragTargetRef = useRef<DragTarget>(null);
  const localBezierRef = useRef<CounterAnimationBezier>([0.25, 0.46, 0.45, 0.94]);
  const draggedBezierRef = useRef<CounterAnimationBezier | null>(null);
  const viewOffsetRef = useRef({ x: 0, y: 0 });
  const viewScaleRef = useRef(1);

  const [nameInput, setNameInput] = useState("");
  const [localBezier, setLocalBezier] = useState<CounterAnimationBezier>(
    [0.25, 0.46, 0.45, 0.94],
  );
  const [bezierInput, setBezierInput] = useState("0.25, 0.46, 0.45, 0.94");
  const [scaleInput, setScaleInput] = useState("1.1");
  const [durationInput, setDurationInput] = useState("300");
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [viewScale, setViewScale] = useState(1);

  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");

  const [previewCount, setPreviewCount] = useState(0);
  const [previewActive, setPreviewActive] = useState(false);
  const previewTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const initial = toInitialState(initialPreset, t);
    localBezierRef.current = initial.bezier;
    setNameInput(initial.name);
    setLocalBezier(initial.bezier);
    setBezierInput(formatBezierInput(initial.bezier));
    setScaleInput(String(Math.round(initial.scale * 100) / 100));
    setDurationInput(String(initial.durationMs));
    setErrorText("");
    setViewOffset({ x: 0, y: 0 });
    setViewScale(1);
    viewOffsetRef.current = { x: 0, y: 0 };
    viewScaleRef.current = 1;
    setPreviewCount(0);
    setPreviewActive(false);
  }, [initialPreset, isOpen, t]);

  useEffect(() => {
    if (isOpen) return;
    if (previewTimeoutRef.current) {
      window.clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
  }, [isOpen]);

  const triggerPreview = useCallback(() => {
    const parsedDuration = parseNumber(durationInput);
    const durationMs = clampDuration(parsedDuration ?? 300);

    if (previewTimeoutRef.current) {
      window.clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }

    setPreviewActive(true);
    setPreviewCount((prev) => prev + 1);

    previewTimeoutRef.current = window.setTimeout(() => {
      setPreviewActive(false);
      previewTimeoutRef.current = null;
    }, Math.max(200, durationMs));
  }, [durationInput]);

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
          ? [
              Math.min(Math.max(bezierX, 0), 1),
              Math.min(Math.max(bezierY, -2), 2),
              current[2],
              current[3],
            ]
          : [
              current[0],
              current[1],
              Math.min(Math.max(bezierX, 0), 1),
              Math.min(Math.max(bezierY, -2), 2),
            ];

      const clamped = clampCounterBezier(nextBezier);
      localBezierRef.current = clamped;
      setLocalBezier(clamped);
      setBezierInput(formatBezierInput(clamped));
      draggedBezierRef.current = clamped;

      const hx =
        EDITOR_PADDING + (target === "p1" ? clamped[0] : clamped[2]) * EDITOR_SIZE;
      const hy =
        EDITOR_PADDING + (1 - (target === "p1" ? clamped[1] : clamped[3])) * EDITOR_SIZE;

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

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerMove = (event: PointerEvent) => {
      updateBezierFromClient(event.clientX, event.clientY, dragTargetRef.current);
    };

    const handlePointerUp = () => {
      draggedBezierRef.current = null;
      dragTargetRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isOpen, updateBezierFromClient]);

  const handlePointPointerDown = useCallback(
    (event: React.PointerEvent<SVGCircleElement>, target: DragTarget) => {
      event.preventDefault();
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

  const selectedPreset = useMemo(() => findBezierPresetId(localBezier), [localBezier]);

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

  const handlePresetChange = useCallback((value: string) => {
    if (value === "custom") return;
    const preset = COUNTER_BEZIER_PRESETS.find((item) => item.id === value);
    if (!preset) return;
    const nextBezier = clampCounterBezier(preset.bezier);
    localBezierRef.current = nextBezier;
    setLocalBezier(nextBezier);
    setBezierInput(formatBezierInput(nextBezier));
  }, []);

  const gridLines = useMemo(() => {
    const lines: React.ReactElement[] = [];
    const far = GRID_EXTENT * GRID_SUB;
    for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
      const pos = EDITOR_PADDING + i * GRID_SUB;
      const isMajor = i % 4 === 0;
      const color = isMajor ? "#3A3943" : "#2D2D35";
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
  }, []);

  const parsedScale = useMemo(() => {
    const parsed = parseNumber(scaleInput);
    const normalized = normalizeScale(parsed ?? 1.1);
    return Math.round(normalized * 100) / 100;
  }, [scaleInput]);

  const parsedDuration = useMemo(() => {
    const parsed = parseNumber(durationInput);
    return clampDuration(parsed ?? 300);
  }, [durationInput]);

  const canSave = useMemo(
    () => !isSaving && nameInput.trim().length > 0,
    [isSaving, nameInput],
  );

  const handleSave = useCallback(async () => {
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

    setErrorText("");
    setIsSaving(true);
    try {
      const response =
        mode === "edit" && initialPreset
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
      console.error("Failed to save counter animation preset", error);
      setErrorText(
        t("counterSetting.saveAnimationFailed") || "애니메이션 저장에 실패했습니다.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    canSave,
    initialPreset,
    mode,
    nameInput,
    onClose,
    onSaved,
    parsedDuration,
    parsedScale,
    t,
  ]);

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
    mode === "edit"
      ? t("counterSetting.editAnimationTitle") || "애니메이션 편집"
      : t("counterSetting.createAnimationTitle") || "애니메이션 추가";

  return (
    <Modal onClick={onClose}>
      <div
        className="w-[760px] max-w-[calc(100vw-80px)] h-[355px] flex flex-col bg-[#1A191E] rounded-[10px] border border-[#2A2A30] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[37px] bg-[#2A2A30] border-b border-[#3A3943] px-[12px] flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-[8px]">
            <span className="px-[6px] h-[18px] rounded-[4px] border border-[#3A3943] bg-[#1A191E] text-[10px] leading-[18px] font-semibold tracking-[0.2px] text-[#8CC2FF]">
              Animation
            </span>
            <span className="truncate text-[12px] leading-[16px] text-[#DBDEE8]">
              {headerTitle}
            </span>
          </div>
          <button
            type="button"
            className="text-[11px] leading-[14px] text-[#8A8D99] hover:text-[#DBDEE8] transition-colors"
            onClick={triggerPreview}
          >
            {t("counterSetting.previewPlay") || "미리보기 재생"}
          </button>
        </div>

        <div className="flex-1 p-[12px] grid grid-cols-[1.35fr_1fr] gap-[12px] min-h-0">
          <div className="min-h-0 flex flex-col gap-[8px]">
            <div>
              <label className="block text-[11px] leading-[14px] text-[#8A8D99] mb-[4px]">
                {t("counterSetting.animationName") || "애니메이션 이름"}
              </label>
              <input
                type="text"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder={
                  t("counterSetting.animationNamePlaceholder") || "이름 입력"
                }
                className="w-full h-[30px] px-[10px] rounded-[7px] border border-[#3A3943] bg-[#1E1E1E] text-[12px] leading-[16px] text-[#DBDEE8] placeholder-[#6F6E7A] outline-none focus:border-[#459BF8] transition-colors"
              />
            </div>

            <div className="flex items-start gap-[8px]">
              <div
                className="rounded-[9px] border border-[#2A2A30] bg-[#17161A] overflow-hidden"
                style={{
                  width: `${TOTAL_SIZE + 14}px`,
                  height: `${TOTAL_SIZE + 14}px`,
                  padding: "7px",
                }}
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
                    <rect
                      x={viewOffset.x}
                      y={viewOffset.y}
                      width={vbSize}
                      height={vbSize}
                      fill="#17161A"
                    />
                    <rect x={P} y={P} width={S} height={S} fill="#1F1E23" rx={7 * ns} ry={7 * ns} />
                    {gridLines}
                    <rect
                      x={P}
                      y={P}
                      width={S}
                      height={S}
                      fill="none"
                      stroke="#3A3943"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                      rx={7 * ns}
                      ry={7 * ns}
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
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => handlePointPointerDown(e, "p1")}
                    />
                    <circle
                      cx={p1w.x}
                      cy={p1w.y}
                      r={HANDLE_RADIUS * ns}
                      fill="#1A191E"
                      stroke="#459BF8"
                      strokeWidth={2 * ns}
                      style={{ pointerEvents: "none" }}
                    />
                    <circle
                      cx={p2w.x}
                      cy={p2w.y}
                      r={HANDLE_HIT_RADIUS * ns}
                      fill="transparent"
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => handlePointPointerDown(e, "p2")}
                    />
                    <circle
                      cx={p2w.x}
                      cy={p2w.y}
                      r={HANDLE_RADIUS * ns}
                      fill="#1A191E"
                      stroke="#FFB400"
                      strokeWidth={2 * ns}
                      style={{ pointerEvents: "none" }}
                    />
                  </svg>
                </div>
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-[6px]">
                <label className="text-[11px] leading-[14px] text-[#8A8D99]">
                  {t("counterSetting.curvePreset") || "곡선 프리셋"}
                </label>
                <Dropdown
                  options={presetOptions}
                  value={selectedPreset}
                  onChange={handlePresetChange}
                  fullWidth
                />

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
                  }}
                  className="w-full h-[26px] rounded-[7px] border border-[#3A3943] bg-[#2A2A30] px-[7px] text-[#DBDEE8] text-style-4 text-center outline-none focus:border-[#459BF8]"
                  placeholder="0.25, 0.46, 0.45, 0.94"
                />

                <div>
                  <label className="text-[11px] leading-[14px] text-[#8A8D99] block mb-[3px]">
                    {t("counterSetting.scale") || "스케일"}
                  </label>
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
                      const normalized = normalizeScale(parsed ?? 1.1);
                      setScaleInput(String(Math.round(normalized * 100) / 100));
                    }}
                    className="w-full h-[26px] rounded-[7px] border border-[#3A3943] bg-[#2A2A30] text-[#DBDEE8] text-style-4 text-center outline-none focus:border-[#459BF8]"
                  />
                </div>

                <div>
                  <label className="text-[11px] leading-[14px] text-[#8A8D99] block mb-[3px]">
                    {t("counterSetting.duration") || "지속 시간 (ms)"}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={durationInput}
                    onChange={(event) => {
                      const raw = event.target.value.replace(/[^0-9]/g, "");
                      setDurationInput(raw);
                    }}
                    onBlur={() => {
                      const parsed = parseNumber(durationInput);
                      const normalized = clampDuration(parsed ?? 300);
                      setDurationInput(String(normalized));
                    }}
                    className="w-full h-[26px] rounded-[7px] border border-[#3A3943] bg-[#2A2A30] text-[#DBDEE8] text-style-4 text-center outline-none focus:border-[#459BF8]"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex flex-col gap-[8px]">
            <div className="rounded-[8px] border border-[#3A3943] bg-[#141419] flex-1 min-h-0 p-[10px]">
              <div className="h-full flex flex-col gap-[8px]">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] leading-[14px] text-[#8A8D99]">
                    {t("counterSetting.preview") || "미리보기"}
                  </p>
                  <button
                    type="button"
                    className="px-[10px] h-[22px] rounded-[6px] bg-[#2A2A30] hover:bg-[#34343c] text-[11px] leading-[14px] text-[#DBDEE8] transition-colors"
                    onClick={triggerPreview}
                  >
                    {t("counterSetting.play") || "재생"}
                  </button>
                </div>

                <div className="flex-1 min-h-0 flex items-center justify-center">
                  {(() => {
                    const PREVIEW_MAX_W = 200;
                    const PREVIEW_MAX_H = 160;

                    const placement = counterSettings?.placement ?? "inside";
                    const align = counterSettings?.align ?? "top";
                    const alignMode = counterSettings?.alignMode ?? "center";
                    const gap = counterSettings?.gap ?? 6;
                    const isInside = placement === "inside";
                    const isHorizontal = align === "left" || align === "right";
                    const isBetween = alignMode === "between";

                    const keyW = keyVisual?.width ?? 60;
                    const keyH = keyVisual?.height ?? 60;
                    const counterExtra = (counterSettings?.fontSize ?? 16) + gap;

                    let totalW = keyW;
                    let totalH = keyH;
                    if (!isInside) {
                      if (align === "left" || align === "right") totalW += counterExtra;
                      else totalH += counterExtra;
                    }

                    const fitScale = Math.min(
                      PREVIEW_MAX_W / totalW,
                      PREVIEW_MAX_H / totalH,
                      1,
                    );

                    const keyLabelDecorations: string[] = [];
                    if (keyVisual?.fontUnderline) keyLabelDecorations.push("underline");
                    if (keyVisual?.fontStrikethrough) keyLabelDecorations.push("line-through");

                    const labelEl = (
                      <span
                        className="pointer-events-none select-none leading-none"
                        style={{
                          fontSize: `${keyVisual?.fontSize ?? 14}px`,
                          fontFamily: keyVisual?.fontFamily
                            ? `"${keyVisual.fontFamily}", "SUIT-Regular", sans-serif`
                            : undefined,
                          fontWeight: keyVisual?.fontWeight ?? 700,
                          fontStyle: keyVisual?.fontItalic ? "italic" : "normal",
                          textDecoration: keyLabelDecorations.length > 0
                            ? keyLabelDecorations.join(" ")
                            : "none",
                          color: keyVisual?.fontColor ?? "rgba(121, 121, 121, 0.9)",
                        }}
                      >
                        {keyVisual?.displayText || "A"}
                      </span>
                    );

                    const counterEl = (
                      <CountDisplay
                        count={previewCount}
                        fillColor={
                          previewActive
                            ? (counterSettings?.fill.active ?? "#FFFFFF")
                            : (counterSettings?.fill.idle ?? "rgba(121, 121, 121, 0.9)")
                        }
                        strokeColor={
                          previewActive
                            ? (counterSettings?.stroke.active ?? "transparent")
                            : (counterSettings?.stroke.idle ?? "transparent")
                        }
                        globalKey="preview"
                        active={previewActive}
                        fontSize={counterSettings?.fontSize ?? 16}
                        fontFamily={counterSettings?.fontFamily ?? null}
                        fontWeight={counterSettings?.fontWeight ?? 700}
                        fontItalic={counterSettings?.fontItalic ?? false}
                        fontUnderline={counterSettings?.fontUnderline ?? false}
                        fontStrikethrough={counterSettings?.fontStrikethrough ?? false}
                        animationEnabled={true}
                        animationBezier={localBezier}
                        animationScale={parsedScale}
                        animationDurationMs={parsedDuration}
                      />
                    );

                    const keyBoxStyle: React.CSSProperties = {
                      width: `${keyW}px`,
                      height: `${keyH}px`,
                      backgroundColor: keyVisual?.backgroundColor ?? "rgba(46, 46, 47, 0.9)",
                      border: `${keyVisual?.borderWidth ?? 3}px solid ${keyVisual?.borderColor ?? "rgba(113, 113, 113, 0.9)"}`,
                      borderRadius: `${keyVisual?.borderRadius ?? 10}px`,
                      boxSizing: "border-box",
                      overflow: "hidden",
                    };

                    const outsideStyle: React.CSSProperties | undefined = !isInside
                      ? {
                          position: "absolute",
                          pointerEvents: "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          ...(align === "top" && {
                            bottom: "100%",
                            left: "50%",
                            transform: "translateX(-50%)",
                            paddingBottom: `${gap}px`,
                          }),
                          ...(align === "bottom" && {
                            top: "100%",
                            left: "50%",
                            transform: "translateX(-50%)",
                            paddingTop: `${gap}px`,
                          }),
                          ...(align === "left" && {
                            right: "100%",
                            top: "50%",
                            transform: "translateY(-50%)",
                            paddingRight: `${gap}px`,
                          }),
                          ...(align === "right" && {
                            left: "100%",
                            top: "50%",
                            transform: "translateY(-50%)",
                            paddingLeft: `${gap}px`,
                          }),
                        }
                      : undefined;

                    return (
                      <div
                        className="relative"
                        style={fitScale < 1 ? { transform: `scale(${fitScale})`, transformOrigin: "center" } : undefined}
                      >
                        <div
                          className="flex items-center justify-center"
                          style={keyBoxStyle}
                        >
                          {isInside ? (
                            <div
                              className={`flex ${isHorizontal ? "" : "flex-col"} w-full h-full items-center pointer-events-none select-none`}
                              style={{
                                justifyContent: isBetween ? "space-between" : "center",
                                padding: isBetween
                                  ? isHorizontal
                                    ? `0 ${gap}px`
                                    : `${gap}px 0`
                                  : "0",
                                gap: isBetween ? undefined : `${gap}px`,
                              }}
                            >
                              {(align === "top" || align === "left") && counterEl}
                              {labelEl}
                              {(align === "bottom" || align === "right") && counterEl}
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
              </div>
            </div>

            {errorText ? (
              <p className="text-[11px] leading-[14px] text-[#E6A7A7]">{errorText}</p>
            ) : null}
          </div>
        </div>

        <div className="bg-[#1A191E] border-t border-[#2A2A30] px-[12px] py-[10px] flex items-center justify-end gap-[10.5px]">
          <button
            type="button"
            className={`w-[120px] h-[30px] rounded-[7px] text-style-3 transition-colors ${
              canSave
                ? "bg-[#2A2A30] text-[#DCDEE7] hover:bg-[#34343c]"
                : "bg-[#222228] text-[#777986] cursor-not-allowed"
            }`}
            disabled={!canSave}
            onClick={() => {
              void handleSave();
            }}
          >
            {isSaving
              ? t("counterSetting.saving") || "저장 중..."
              : t("common.save") || "저장"}
          </button>
          <button
            type="button"
            className="px-[24px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3 transition-colors"
            onClick={onClose}
          >
            {t("common.cancel") || "취소"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
