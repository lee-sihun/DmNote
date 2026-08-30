import type { CounterAnimationBezier } from '@src/types/key/keys';
import type { CounterAnimationPreset } from '@src/types/key/counterAnimation';
import { clampCounterBezier } from '@utils/cubicBezier';

export const COUNTER_EDITOR_SIZE = 110;
export const COUNTER_EDITOR_PADDING = 20;
export const COUNTER_EDITOR_TOTAL_SIZE =
  COUNTER_EDITOR_SIZE + COUNTER_EDITOR_PADDING * 2;

const GRID_SUB = COUNTER_EDITOR_SIZE / 4;
const GRID_EXTENT = 40;
const MAX_DURATION = 5000;

const buildGridPath = (major: boolean) => {
  const far = GRID_EXTENT * GRID_SUB;
  const start = COUNTER_EDITOR_PADDING - far;
  const end = COUNTER_EDITOR_PADDING + far;
  const segments: string[] = [];
  for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i += 1) {
    if ((i % 4 === 0) !== major) continue;
    const position = COUNTER_EDITOR_PADDING + i * GRID_SUB;
    segments.push(`M ${position} ${start} V ${end}`);
    segments.push(`M ${start} ${position} H ${end}`);
  }
  return segments.join(' ');
};

export const COUNTER_GRID_PATH_MAJOR = buildGridPath(true);
export const COUNTER_GRID_PATH_MINOR = buildGridPath(false);

export const resolveCounterEditorViewDimensions = (
  scale: number,
  aspect: number,
) => {
  const base = COUNTER_EDITOR_TOTAL_SIZE / scale;
  const safeAspect = Math.max(aspect, 0.01);
  return {
    base,
    vbW: base * Math.max(safeAspect, 1),
    vbH: base * Math.max(1 / safeAspect, 1),
  };
};

export const normalizeCounterScale = (value: number): number =>
  Number.isFinite(value) ? value : 1.1;

export const clampCounterDuration = (value: number): number => {
  if (!Number.isFinite(value)) return 300;
  return Math.min(Math.max(Math.round(value), 1), MAX_DURATION);
};

export const parseCounterNumber = (raw: string): number | null => {
  if (!raw || raw === '-' || raw === '.' || raw === '-.') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatCounterBezierInput = (
  bezier: CounterAnimationBezier,
): string => bezier.map((value) => Number(Number(value).toFixed(2))).join(', ');

export const parseCounterBezierInput = (
  raw: string,
): CounterAnimationBezier | null => {
  const values = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (values.length !== 4) return null;

  const numbers = values.map((value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
  });
  if (numbers.some((value) => !Number.isFinite(value))) return null;

  const clamped = clampCounterBezier(numbers);
  return [clamped[0], clamped[1], clamped[2], clamped[3]];
};

export const createCounterAnimationEditorState = (
  preset: CounterAnimationPreset | null | undefined,
) => {
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
    scale: normalizeCounterScale(preset.scale),
    durationMs: clampCounterDuration(preset.durationMs),
  };
};
