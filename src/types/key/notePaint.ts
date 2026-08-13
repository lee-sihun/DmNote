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
  | {
      notePaint: NotePaintValuePatchV1;
      noteGlowPaint?: never;
      noteBorderPaint?: never;
    }
  | {
      notePaint?: never;
      noteGlowPaint: NotePaintValuePatchV1;
      noteBorderPaint?: never;
    }
  | {
      notePaint?: never;
      noteGlowPaint?: never;
      noteBorderPaint: NoteBorderPaintValueV1;
    };

const cloneNoteColor = (color: StrictNoteColorV1): StrictNoteColorV1 =>
  typeof color === 'string' ? color : { ...color };

export const projectNotePaintPatch = (
  patch: NotePaintPropertyPatchV1,
): Partial<KeyPosition> => {
  if ('noteBorderPaint' in patch) {
    return {
      noteBorderColor: patch.noteBorderPaint.color,
      noteBorderOpacity: patch.noteBorderPaint.opacity,
    };
  }
  const glow = 'noteGlowPaint' in patch;
  const value = glow ? patch.noteGlowPaint : patch.notePaint;
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

const isNotePaintValuePatchV1 = (
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

export const isNotePaintPropertyPatchV1 = (
  value: unknown,
): value is NotePaintPropertyPatchV1 => {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  if ('notePaint' in value) return isNotePaintValuePatchV1(value.notePaint);
  if ('noteGlowPaint' in value) {
    return isNotePaintValuePatchV1(value.noteGlowPaint);
  }
  return (
    'noteBorderPaint' in value &&
    isRecord(value.noteBorderPaint) &&
    hasExactKeys(value.noteBorderPaint, ['color', 'opacity']) &&
    typeof value.noteBorderPaint.color === 'string' &&
    /^#[0-9A-Fa-f]{6}$/.test(value.noteBorderPaint.color) &&
    isOpacity(value.noteBorderPaint.opacity)
  );
};
