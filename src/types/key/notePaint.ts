import type { KeyPosition } from './keys';
import type { GradientSpec } from '../color';
import {
  isStrictGradientSpec,
  isStrictStopColor,
  hexRepresentative,
} from '../color';

export type StrictNoteColorV1 =
  | string
  | { type: 'gradient'; top: string; bottom: string };

export type NotePaintValuePatchV1 =
  | {
      color: StrictNoteColorV1;
      opacity?: never;
      opacityTop?: never;
      opacityBottom?: never;
    }
  | {
      color?: never;
      opacity: number;
      opacityTop?: never;
      opacityBottom?: never;
    }
  | {
      color?: never;
      opacity: number;
      opacityTop: number;
      opacityBottom: number;
    };

export interface NoteBorderPaintValueV1 {
  color: string;
  opacity: number;
}

// gradient 확장 형태 — null은 단색 확정(형제 필드 제거)과 동일 (api-contract v2 §4)
export interface NoteBorderPaintGradientValueV1 {
  color: string;
  opacity: number;
  gradient: GradientSpec | null;
}

export type NoteBorderPaintPatchValueV1 =
  | NoteBorderPaintValueV1
  | NoteBorderPaintGradientValueV1;

export type NotePaintPropertyPatchV1 =
  | { property: 'notePaint'; value: NotePaintValuePatchV1 }
  | { property: 'noteGlowPaint'; value: NotePaintValuePatchV1 }
  | { property: 'noteBorderPaint'; value: NoteBorderPaintPatchValueV1 };

const cloneNoteColor = (color: StrictNoteColorV1): StrictNoteColorV1 =>
  typeof color === 'string' ? color : { ...color };

export const projectNotePaintPatch = (
  patch: NotePaintPropertyPatchV1,
): Partial<KeyPosition> => {
  if (patch.property === 'noteBorderPaint') {
    // 2키 형태·gradient null = 단색 확정(형제 필드 제거) — 전이 표는 atomic
    const gradient =
      'gradient' in patch.value && patch.value.gradient
        ? structuredClone(patch.value.gradient)
        : undefined;
    return {
      noteBorderColor: patch.value.color,
      noteBorderOpacity: patch.value.opacity,
      noteBorderGradient: gradient,
    };
  }
  const glow = patch.property === 'noteGlowPaint';
  const value = patch.value;
  if ('color' in value) {
    return glow
      ? { noteGlowColor: cloneNoteColor(value.color) }
      : { noteColor: cloneNoteColor(value.color) };
  }
  if ('opacityTop' in value) {
    return glow
      ? {
          noteGlowOpacity: value.opacity,
          noteGlowOpacityTop: value.opacityTop,
          noteGlowOpacityBottom: value.opacityBottom,
        }
      : {
          noteOpacity: value.opacity,
          noteOpacityTop: value.opacityTop,
          noteOpacityBottom: value.opacityBottom,
        };
  }
  return glow
    ? { noteGlowOpacity: value.opacity }
    : { noteOpacity: value.opacity };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);

const isOpacity = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 100;

export const isStrictNoteColorV1 = (
  value: unknown,
): value is StrictNoteColorV1 => {
  if (typeof value === 'string') return true;
  return (
    isRecord(value) &&
    hasExactKeys(value, ['type', 'top', 'bottom']) &&
    value.type === 'gradient' &&
    typeof value.top === 'string' &&
    typeof value.bottom === 'string'
  );
};

export const isNotePaintValuePatchV1 = (
  value: unknown,
): value is NotePaintValuePatchV1 => {
  if (!isRecord(value)) return false;
  if (hasExactKeys(value, ['color'])) return isStrictNoteColorV1(value.color);
  if (hasExactKeys(value, ['opacity'])) return isOpacity(value.opacity);
  return (
    hasExactKeys(value, ['opacity', 'opacityTop', 'opacityBottom']) &&
    isOpacity(value.opacity) &&
    isOpacity(value.opacityTop) &&
    isOpacity(value.opacityBottom)
  );
};

export const isNoteBorderPaintValueV1 = (
  value: unknown,
): value is NoteBorderPaintValueV1 =>
  isRecord(value) &&
  hasExactKeys(value, ['color', 'opacity']) &&
  typeof value.color === 'string' &&
  /^#[0-9A-Fa-f]{6}$/.test(value.color) &&
  isOpacity(value.opacity);

/**
 * 확장 형태 검증 (api-contract v2 §4): 2키 또는 3키 exact-keys.
 * gradient 객체는 canonical spec + §2A 스톱 문법 + 대표색 일치까지 요구
 */
export const isNoteBorderPaintPatchValueV1 = (
  value: unknown,
): value is NoteBorderPaintPatchValueV1 => {
  if (isNoteBorderPaintValueV1(value)) return true;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['color', 'opacity', 'gradient']) ||
    typeof value.color !== 'string' ||
    !/^#[0-9A-Fa-f]{6}$/.test(value.color) ||
    !isOpacity(value.opacity)
  ) {
    return false;
  }
  if (value.gradient === null) return true;
  return (
    isStrictGradientSpec(value.gradient) &&
    value.gradient.stops.every((stop) => isStrictStopColor(stop.color)) &&
    hexRepresentative(value.gradient.stops[0]?.color ?? '') === value.color
  );
};

export const isNotePaintPropertyPatchV1 = (
  value: unknown,
): value is NotePaintPropertyPatchV1 => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !('property' in value) ||
    !('value' in value)
  ) {
    return false;
  }
  if (value.property === 'notePaint' || value.property === 'noteGlowPaint') {
    return isNotePaintValuePatchV1(value.value);
  }
  return (
    value.property === 'noteBorderPaint' &&
    isNoteBorderPaintPatchValueV1(value.value)
  );
};
