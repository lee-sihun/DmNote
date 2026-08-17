import type { KeyPosition } from './keys';

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

export type NotePaintPropertyPatchV1 =
  | { property: 'notePaint'; value: NotePaintValuePatchV1 }
  | { property: 'noteGlowPaint'; value: NotePaintValuePatchV1 }
  | { property: 'noteBorderPaint'; value: NoteBorderPaintValueV1 };

const cloneNoteColor = (color: StrictNoteColorV1): StrictNoteColorV1 =>
  typeof color === 'string' ? color : { ...color };

export const projectNotePaintPatch = (
  patch: NotePaintPropertyPatchV1,
): Partial<KeyPosition> => {
  if (patch.property === 'noteBorderPaint') {
    return {
      noteBorderColor: patch.value.color,
      noteBorderOpacity: patch.value.opacity,
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
    isNoteBorderPaintValueV1(value.value)
  );
};
