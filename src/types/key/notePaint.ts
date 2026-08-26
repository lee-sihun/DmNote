import type { KeyPosition } from './keys';
import type { GradientSpec } from '../color';
import {
  isStrictGradientSpec,
  isStrictStopColor,
  hexRepresentative,
  notePaintShadowColor,
  notePaintShadowOpacity,
  parseStrictStopColor,
  toCanonicalGradient,
  toStrictStopColor,
} from '../color';

// §9-3 shadow 공식은 color.ts가 단일 소유 (canonicalize 경로와 공유)
export { notePaintShadowColor, notePaintShadowOpacity };

export type StrictNoteColorV1 =
  | string
  | { type: 'gradient'; top: string; bottom: string };

/**
 * 신형 full descriptor (계약 §9-5) - 전환·배율·shadow를 한 op으로.
 * gradient 객체면 color는 첫/끝 스톱으로 만든 정확한 shadow 객체,
 * gradient null이면 color는 문자열(단색 확정)
 */
export interface NotePaintDescriptorValueV1 {
  color: StrictNoteColorV1;
  opacity: number;
  gradient: GradientSpec | null;
}

export type NotePaintValuePatchV1 =
  | {
      color: StrictNoteColorV1;
      opacity?: never;
      opacityTop?: never;
      opacityBottom?: never;
      gradient?: never;
    }
  | {
      color?: never;
      opacity: number;
      opacityTop?: never;
      opacityBottom?: never;
      gradient?: never;
    }
  | {
      color?: never;
      opacity: number;
      opacityTop: number;
      opacityBottom: number;
      gradient?: never;
    }
  | (NotePaintDescriptorValueV1 & {
      opacityTop?: never;
      opacityBottom?: never;
    });

const composeStopColor = (
  base: string,
  alphaPercent: number,
): string | null => {
  // 구형 색은 관용 표기가 섞여 있을 수 있어 §2A로 먼저 강제
  const strict = toStrictStopColor(base);
  if (strict === null) return null;
  const parsed = parseStrictStopColor(strict);
  if (parsed === null) return null;
  const alpha =
    Math.round(Math.min(Math.max(alphaPercent / 100, 0), 1) * 10_000) / 10_000;
  if (alpha === 1) return hexRepresentative(strict);
  return `rgba(${parsed.r},${parsed.g},${parsed.b},${alpha})`;
};

/**
 * 구형 top/bottom + 끝단 투명도를 신형 spec으로 제시 (§9-6 전환 매핑).
 * 저장을 바꾸지 않는 표시용 변환 - 커밋 시점에 신형 필드로 기록된다.
 * 색이 §2A로 환원 불가하면 null (그 상태는 단색으로 제시)
 */
export const legacyNoteColorToSpec = (
  color: StrictNoteColorV1 | undefined | null,
  opacityTop: number,
  opacityBottom: number,
): GradientSpec | null => {
  if (!color || typeof color === 'string' || color.type !== 'gradient') {
    return null;
  }
  const top = composeStopColor(color.top, opacityTop);
  const bottom = composeStopColor(color.bottom, opacityBottom);
  if (top === null || bottom === null) return null;
  return toCanonicalGradient({
    angle: 180,
    stops: [
      { color: top, pos: 0 },
      { color: bottom, pos: 1 },
    ],
  });
};

/**
 * 글로우가 신형 본체를 상속하는 상태의 제시 spec (§9-4 렌더 규칙과 대칭).
 * 렌더는 본체 스톱 색만 빌리고(알파 1) 프로파일은 글로우 끝단 투명도가
 * 맡으므로, 각 스톱 위치에 보간한 프로파일 알파를 실어 제시한다.
 * 색·각도·스톱 수를 보존해 한 번의 커밋이 상속 형태를 축약하지 않는다.
 *
 * 근사 한계: 렌더의 프로파일은 노트 세로축 기준이고 spec 알파는 그라데이션
 * 축을 따르므로 각도 180이 아닌 본체(플러그인·프리셋 경로)에서는 커밋 후
 * 프로파일 방향이 바뀐다. 세로 프로파일을 spec과 별도로 담으려면 계약 확장 필요
 */
export const bodyInheritedGlowSpec = (
  bodyGradient: GradientSpec,
  glowOpacityTop: number,
  glowOpacityBottom: number,
): GradientSpec | null => {
  const stops: GradientSpec['stops'] = [];
  for (const stop of bodyGradient.stops) {
    const pos = Math.min(Math.max(stop.pos, 0), 1);
    const alphaPercent =
      glowOpacityTop + (glowOpacityBottom - glowOpacityTop) * pos;
    const color = composeStopColor(stop.color, alphaPercent);
    if (color === null) return null;
    stops.push({ ...stop, color });
  }
  return toCanonicalGradient({ ...bodyGradient, stops });
};

/**
 * 전역 배율을 스톱 알파에 접어 넣은 spec. 그라데이션 형식은 배율 UI가 없고
 * 저장 배율을 항상 100으로 기록하므로, 남아 있는 배율은 제시·커밋 전에
 * 여기서 흡수한다. 100이면 원본 그대로
 */
export const foldGradientOpacity = (
  spec: GradientSpec,
  opacityPercent: number,
): GradientSpec => {
  const factor = Math.min(Math.max(opacityPercent / 100, 0), 1);
  if (factor === 1) return spec;
  const stops = spec.stops.map((stop) => {
    const strict = toStrictStopColor(stop.color);
    const parsed = strict ? parseStrictStopColor(strict) : null;
    if (!strict || !parsed) return stop;
    const alpha = Math.round(parsed.a * factor * 10_000) / 10_000;
    return {
      ...stop,
      color:
        alpha === 1
          ? hexRepresentative(strict) ?? stop.color
          : `rgba(${parsed.r},${parsed.g},${parsed.b},${alpha})`,
    };
  });
  return toCanonicalGradient({ ...spec, stops });
};

export interface NoteBorderPaintValueV1 {
  color: string;
  opacity: number;
}

// gradient 확장 형태 - null은 단색 확정(형제 필드 제거)과 동일 (api-contract v2 §4)
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

type NoteBodyPaintFields = Pick<
  KeyPosition,
  'noteColor' | 'noteOpacity' | 'noteOpacityTop' | 'noteOpacityBottom'
> &
  Partial<Pick<KeyPosition, 'noteGradient'>>;

type NoteGlowPaintFields = Pick<
  KeyPosition,
  | 'noteGlowColor'
  | 'noteGlowOpacity'
  | 'noteGlowOpacityTop'
  | 'noteGlowOpacityBottom'
  | 'noteGlowGradient'
>;

/** 본체 페인트 5필드를 글로우 필드로 복사 (Rust mirror_note_body_to_glow 미러) */
export const mirrorBodyPaintToGlow = (
  position: NoteBodyPaintFields,
): NoteGlowPaintFields => ({
  noteGlowColor: cloneNoteColor(position.noteColor),
  noteGlowOpacity: position.noteOpacity,
  noteGlowOpacityTop: position.noteOpacityTop,
  noteGlowOpacityBottom: position.noteOpacityBottom,
  noteGlowGradient: position.noteGradient
    ? structuredClone(position.noteGradient)
    : undefined,
});

type NotePaintProjectionContext = Partial<
  Pick<KeyPosition, 'noteGradient' | 'noteGlowGradient' | 'noteGlowSyncPaint'>
> &
  Partial<NoteBodyPaintFields>;

export const projectNotePaintPatch = (
  patch: NotePaintPropertyPatchV1,
  // {opacity} 단독이 sibling 위 배율 갱신일 때 shadow 재계산에 필요 (§9-5).
  // 동기화 켜진 키의 notePaint는 글로우 미러까지 같이 투영한다.
  // preview 등 position 없는 호출은 배율만 투영 (저장 경로는 반드시 전달)
  position?: NotePaintProjectionContext,
): Partial<KeyPosition> => {
  const projected = projectNotePaintPatchBase(patch, position);
  if (
    patch.property !== 'notePaint' ||
    !position?.noteGlowSyncPaint ||
    position.noteColor === undefined ||
    position.noteOpacity === undefined
  ) {
    return projected;
  }
  const next = {
    noteColor: position.noteColor,
    noteOpacity: position.noteOpacity,
    noteOpacityTop: position.noteOpacityTop,
    noteOpacityBottom: position.noteOpacityBottom,
    noteGradient: position.noteGradient,
    ...projected,
  };
  return { ...projected, ...mirrorBodyPaintToGlow(next) };
};

const projectNotePaintPatchBase = (
  patch: NotePaintPropertyPatchV1,
  position?: Pick<
    NotePaintProjectionContext,
    'noteGradient' | 'noteGlowGradient'
  >,
): Partial<KeyPosition> => {
  if (patch.property === 'noteBorderPaint') {
    // 2키 형태·gradient null = 단색 확정(형제 필드 제거) - 전이 표는 atomic
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
  if ('gradient' in value && value.gradient !== undefined) {
    // full descriptor (§9-5): 전환·배율·shadow를 한 patch로.
    // gradient null = 단색 확정 (sibling 제거 + 투명도 3필드 동일값)
    if (value.gradient === null) {
      return glow
        ? {
            noteGlowColor: cloneNoteColor(value.color),
            noteGlowOpacity: value.opacity,
            noteGlowOpacityTop: value.opacity,
            noteGlowOpacityBottom: value.opacity,
            noteGlowGradient: undefined,
          }
        : {
            noteColor: cloneNoteColor(value.color),
            noteOpacity: value.opacity,
            noteOpacityTop: value.opacity,
            noteOpacityBottom: value.opacity,
            noteGradient: undefined,
          };
    }
    const spec = structuredClone(value.gradient);
    const shadow = notePaintShadowOpacity(spec, value.opacity);
    return glow
      ? {
          noteGlowColor: cloneNoteColor(value.color),
          noteGlowOpacity: value.opacity,
          noteGlowOpacityTop: shadow.top,
          noteGlowOpacityBottom: shadow.bottom,
          noteGlowGradient: spec,
        }
      : {
          noteColor: cloneNoteColor(value.color),
          noteOpacity: value.opacity,
          noteOpacityTop: shadow.top,
          noteOpacityBottom: shadow.bottom,
          noteGradient: spec,
        };
  }
  if ('color' in value) {
    // 기존 {color} = 구형 적용 + sibling 제거 (§9-5 전이 표)
    return glow
      ? {
          noteGlowColor: cloneNoteColor(value.color),
          noteGlowGradient: undefined,
        }
      : { noteColor: cloneNoteColor(value.color), noteGradient: undefined };
  }
  if ('opacityTop' in value) {
    // 기존 3필드 = 구형 2-endpoint 복귀 + sibling 제거 (§9-5 전이 표)
    return glow
      ? {
          noteGlowOpacity: value.opacity,
          noteGlowOpacityTop: value.opacityTop,
          noteGlowOpacityBottom: value.opacityBottom,
          noteGlowGradient: undefined,
        }
      : {
          noteOpacity: value.opacity,
          noteOpacityTop: value.opacityTop,
          noteOpacityBottom: value.opacityBottom,
          noteGradient: undefined,
        };
  }
  // {opacity} 단독: sibling 존재 시 배율 갱신 + shadow 4필드 재계산 (Rust 미러 -
  // semantic ops 경로는 공통 canonical 정규화를 거치지 않으므로 여기서 직접)
  const sibling = glow ? position?.noteGlowGradient : position?.noteGradient;
  if (sibling) {
    const shadowColor = notePaintShadowColor(sibling);
    const shadowOpacity = notePaintShadowOpacity(sibling, value.opacity);
    if (shadowColor !== null) {
      return glow
        ? {
            noteGlowOpacity: value.opacity,
            noteGlowColor: shadowColor,
            noteGlowOpacityTop: shadowOpacity.top,
            noteGlowOpacityBottom: shadowOpacity.bottom,
          }
        : {
            noteOpacity: value.opacity,
            noteColor: shadowColor,
            noteOpacityTop: shadowOpacity.top,
            noteOpacityBottom: shadowOpacity.bottom,
          };
    }
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
  if (hasExactKeys(value, ['color', 'opacity', 'gradient'])) {
    // full descriptor (§9-5): null이면 단색 문자열, spec이면 정확한 shadow 객체
    if (!isOpacity(value.opacity)) return false;
    if (value.gradient === null) return typeof value.color === 'string';
    if (
      !isStrictGradientSpec(value.gradient) ||
      !value.gradient.stops.every((stop) => isStrictStopColor(stop.color))
    ) {
      return false;
    }
    const shadow = notePaintShadowColor(value.gradient);
    return (
      shadow !== null &&
      isRecord(value.color) &&
      hasExactKeys(value.color, ['type', 'top', 'bottom']) &&
      value.color.type === shadow.type &&
      value.color.top === shadow.top &&
      value.color.bottom === shadow.bottom
    );
  }
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
