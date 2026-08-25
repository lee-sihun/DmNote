import type React from 'react';
import { z } from 'zod';

/**
 * GradientSpec — 그라데이션 색 값 (api-contract v2.3)
 * 기존 색 문자열 필드의 optional 형제로만 존재하며, 있으면 렌더에서 우선.
 * canonical: angle 존재(0-360), stops 2-8개 pos 오름차순
 */

export const GRADIENT_STOPS_MIN = 2;
export const GRADIENT_STOPS_MAX = 8;
export const GRADIENT_DEFAULT_ANGLE = 90;

export interface GradientStop {
  color: string;
  pos: number; // 0-1
}

export interface GradientSpec {
  angle: number;
  stops: GradientStop[];
}

const gradientStopSchema = z.object({
  color: z.string(),
  pos: z.number().finite(),
});

// 관용 입력 → canonical 변환 (Rust Deserialize 경계 정규화와 동일 규칙)
export function toCanonicalGradient(input: {
  angle?: number;
  stops: GradientStop[];
}): GradientSpec {
  const rawAngle = input.angle ?? GRADIENT_DEFAULT_ANGLE;
  // 이미 [0,360)이면 원값 유지 - Rust rem_euclid와 부동소수 바이트 일치.
  // -0은 0으로 통일 (Rust normalize 미러) - strict 검증이 -0을 거부한다
  const wrapped =
    rawAngle >= 0 && rawAngle < 360 ? rawAngle : ((rawAngle % 360) + 360) % 360;
  const angle = wrapped === 0 ? 0 : wrapped;
  const stops = input.stops
    .map((s) => ({ color: s.color, pos: Math.min(1, Math.max(0, s.pos)) }))
    .sort((a, b) => a.pos - b.pos)
    .slice(0, GRADIENT_STOPS_MAX);
  return { angle, stops };
}

// 관용 입력을 받아 canonical GradientSpec을 출력하는 스키마
export const gradientSpecSchema = z
  .object({
    angle: z.number().finite().optional(),
    stops: z.array(gradientStopSchema).min(GRADIENT_STOPS_MIN),
  })
  .transform(toCanonicalGradient);

export function gradientToCss(spec: GradientSpec): string {
  // 드래그 프리뷰 spec은 선택 안정성을 위해 배열을 정렬하지 않는다.
  // CSS는 역순 스톱을 클램프해 경계가 날카로워지므로, 렌더 시점에만
  // canonical과 같은 규칙(pos 클램프 + 안정 정렬)으로 정렬해 커밋과
  // 드래그 중 화면이 갈라지지 않게 한다
  const stops = spec.stops
    .map((s) => ({ color: s.color, pos: Math.min(1, Math.max(0, s.pos)) }))
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${s.color} ${+(s.pos * 100).toFixed(2)}%`)
    .join(', ');
  return `linear-gradient(${spec.angle}deg, ${stops})`;
}

/**
 * compact canonical rgba — 소문자·무공백·알파 명시 (`rgba(r,g,b,a)`)
 * gradient 형제가 있는 값의 대표색 표기. 구버전 마이그레이션 스냅샷 리터럴
 * (대문자 hex 또는 공백 포함 rgba)과 구성상 바이트 일치가 불가능하다.
 * 파싱 불가한 색(named color 등)은 원문 유지 — Rust 경계 repair가 최종 권위
 */
export function toCompactRgba(color: string): string {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3)
      h = h
        .split('')
        .map((ch) => ch + ch)
        .join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a =
      h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(4) : 1;
    return `rgba(${r},${g},${b},${formatAlpha(a)})`;
  }
  const fn = c.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  );
  if (fn) {
    const r = Number(fn[1]);
    const g = Number(fn[2]);
    const b = Number(fn[3]);
    const a = fn[4] === undefined ? 1 : Number(fn[4]);
    // 다중 소수점 등 비정상 채널은 원문 유지 — Rust parse 실패 동작과 일치
    if (![r, g, b, a].every(Number.isFinite)) return c;
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(
      b,
    )},${formatAlpha(a)})`;
  }
  return c;
}

function formatAlpha(a: number): string {
  const clamped = Math.min(1, Math.max(0, a));
  // Rust (a*10000).round()/10000과 동일 양자화 — toFixed는 절반값에서 발산
  return String(Math.round(clamped * 10_000) / 10_000);
}

/**
 * canonical GradientSpec 엄격 검증 - wire 경계(에디터 op·프리셋)에서 사용.
 * 관용 입력을 받는 canonicalGradientOrNull과 달리 이미 canonical인 값만 통과
 */
export const isStrictGradientSpec = (value: unknown): value is GradientSpec => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !('angle' in record) || !('stops' in record)) {
    return false;
  }
  if (
    typeof record.angle !== 'number' ||
    !Number.isFinite(record.angle) ||
    Object.is(record.angle, -0) ||
    record.angle < 0 ||
    record.angle >= 360 ||
    !Array.isArray(record.stops) ||
    record.stops.length < GRADIENT_STOPS_MIN ||
    record.stops.length > GRADIENT_STOPS_MAX
  ) {
    return false;
  }
  let previous = -Infinity;
  for (const stop of record.stops) {
    if (!stop || typeof stop !== 'object' || Array.isArray(stop)) return false;
    const stopRecord = stop as Record<string, unknown>;
    const stopKeys = Object.keys(stopRecord);
    if (
      stopKeys.length !== 2 ||
      !('color' in stopRecord) ||
      !('pos' in stopRecord) ||
      typeof stopRecord.color !== 'string' ||
      typeof stopRecord.pos !== 'number' ||
      !Number.isFinite(stopRecord.pos) ||
      Object.is(stopRecord.pos, -0) ||
      stopRecord.pos < 0 ||
      stopRecord.pos > 1 ||
      stopRecord.pos < previous
    ) {
      return false;
    }
    previous = stopRecord.pos;
  }
  return true;
};

/**
 * 노트 테두리 그라데이션 스톱 색 문법 (api-contract v2 §2A) - Rust 경계와
 * 공유 fixture(tests/fixtures/note-border-stop-colors.json)로 parity 고정
 */
export const isStrictStopColor = (value: string): boolean => {
  const color = value.trim();
  if (
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
      color,
    )
  ) {
    return true;
  }
  const fn = color.match(
    /^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9]*\.?[0-9]+)\s*)?\)$/i,
  );
  if (!fn) return false;
  const hasAlpha = fn[5] !== undefined;
  if ((fn[1].toLowerCase() === 'rgba') !== hasAlpha) return false;
  if (Number(fn[2]) > 255 || Number(fn[3]) > 255 || Number(fn[4]) > 255) {
    return false;
  }
  if (hasAlpha) {
    const alpha = Number(fn[5]);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return false;
  }
  return true;
};

/**
 * 관용 CSS 색을 §2A 문법으로 강제 - 이미 적합하면 원문 유지, 변환 가능하면
 * compact rgba로, 불가(named color 등)면 null. 팔레트처럼 표면 공용인 spec을
 * 노트 테두리 계약에 맞출 때 사용
 */
export const toStrictStopColor = (color: string): string | null => {
  if (isStrictStopColor(color)) return color;
  const compact = toCompactRgba(color);
  return isStrictStopColor(compact) ? compact : null;
};

/**
 * §2A 스톱 색 파싱 - 검증·대표색·LUT 래스터라이즈가 이 파서 하나를 공유해
 * "검증은 통과하는데 렌더는 못 읽는" 도메인 분열을 차단한다. 문법 밖은 null
 */
export const parseStrictStopColor = (
  value: string,
): { r: number; g: number; b: number; a: number } | null => {
  if (!isStrictStopColor(value)) return null;
  const color = value.trim();
  const hex = color.match(
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
  );
  if (hex) {
    let body = hex[1];
    if (body.length === 3 || body.length === 4) {
      body = body
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
      a: body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = color.match(
    /^(?:rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9]*\.?[0-9]+)\s*)?\)$/i,
  );
  if (!fn) return null;
  return {
    r: Number(fn[1]),
    g: Number(fn[2]),
    b: Number(fn[3]),
    a: fn[4] === undefined ? 1 : Number(fn[4]),
  };
};

/**
 * §2A 스톱 색 → #RRGGBB 대문자 대표색 (알파 버림). 문법 밖이면 null -
 * noteBorderColor의 hex 전용 계약과 rgba→hex 마이그레이션 형식에 맞춘다
 */
export const hexRepresentative = (value: string): string | null => {
  const parsed = parseStrictStopColor(value);
  if (parsed === null) return null;
  const channel = (raw: number) =>
    raw.toString(16).padStart(2, '0').toUpperCase();
  return `#${channel(parsed.r)}${channel(parsed.g)}${channel(parsed.b)}`;
};

/** 스펙에서 §9-3 규칙으로 만든 구형 shadow 객체 (첫/끝 스톱 대문자 hex) */
export const notePaintShadowColor = (
  spec: GradientSpec,
): { type: 'gradient'; top: string; bottom: string } | null => {
  const top = hexRepresentative(spec.stops[0]?.color ?? '');
  const bottom = hexRepresentative(
    spec.stops[spec.stops.length - 1]?.color ?? '',
  );
  if (top === null || bottom === null) return null;
  return { type: 'gradient', top, bottom };
};

/** §9-3 shadow Top/Bottom - round(끝 스톱 알파 × 배율) */
export const notePaintShadowOpacity = (
  spec: GradientSpec,
  multiplier: number,
): { top: number; bottom: number } => {
  const firstAlpha =
    parseStrictStopColor(spec.stops[0]?.color ?? '#FFFFFF')?.a ?? 1;
  const lastAlpha =
    parseStrictStopColor(spec.stops[spec.stops.length - 1]?.color ?? '#FFFFFF')
      ?.a ?? 1;
  return {
    top: clampPercent(firstAlpha * multiplier),
    bottom: clampPercent(lastAlpha * multiplier),
  };
};

/** gradient 형제 쌍 필드 이름 매핑 */
export const GRADIENT_SIBLING: Record<string, string> = {
  backgroundColor: 'backgroundGradient',
  activeBackgroundColor: 'activeBackgroundGradient',
  borderColor: 'borderGradient',
  activeBorderColor: 'activeBorderGradient',
  fontColor: 'fontGradient',
  activeFontColor: 'activeFontGradient',
};

const KEY_PAIR_FIELDS = Object.entries(GRADIENT_SIBLING);
const COUNTER_FILL_PAIRS: Array<['idle' | 'active', string]> = [
  ['idle', 'fillIdleGradient'],
  ['active', 'fillActiveGradient'],
];

/** 본체·글로우의 신형 sibling과 구형 shadow 필드 매핑 (계약 §9-3) */
const NOTE_PAINT_SHADOW_PAIRS = [
  {
    gradientField: 'noteGradient',
    colorField: 'noteColor',
    multiplierField: 'noteOpacity',
    topField: 'noteOpacityTop',
    bottomField: 'noteOpacityBottom',
  },
  {
    gradientField: 'noteGlowGradient',
    colorField: 'noteGlowColor',
    multiplierField: 'noteGlowOpacity',
    topField: 'noteGlowOpacityTop',
    bottomField: 'noteGlowOpacityBottom',
  },
] as const;

const clampPercent = (value: number): number =>
  Math.min(Math.max(Math.round(value), 0), 100);

/**
 * §2A 스톱 검사(절단 전 원본 기준) + canonical 변환 - 위반·구조 불량은 null.
 * Rust가 역직렬화 시점 원본 배열을 보는 것과 일치시킨다
 */
const strictCanonicalOrNull = (stored: unknown): GradientSpec | null => {
  const rawStops =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>).stops
      : null;
  const hasUnsupportedRawStop =
    Array.isArray(rawStops) &&
    rawStops.some(
      (stop) =>
        stop &&
        typeof stop === 'object' &&
        typeof (stop as Record<string, unknown>).color === 'string' &&
        !isStrictStopColor((stop as Record<string, unknown>).color as string),
    );
  if (hasUnsupportedRawStop) return null;
  const canonical = canonicalGradientOrNull(stored);
  if (
    canonical === null ||
    canonical.stops.some((stop) => !isStrictStopColor(stop.color))
  ) {
    return null;
  }
  return canonical;
};

/**
 * 관용 입력을 canonical spec으로, 구조가 깨진 값은 null로 —
 * Rust Deserialize 경계의 drop/repair 규칙과 동일 (타입 불일치 = 필드 drop,
 * 범위 밖 pos·angle = canonical repair)
 */
export function canonicalGradientOrNull(value: unknown): GradientSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.angle !== undefined &&
    !(typeof raw.angle === 'number' && Number.isFinite(raw.angle))
  ) {
    return null;
  }
  if (!Array.isArray(raw.stops) || raw.stops.length < GRADIENT_STOPS_MIN) {
    return null;
  }
  const stops: GradientStop[] = [];
  for (const stop of raw.stops) {
    if (!stop || typeof stop !== 'object') return null;
    const { color, pos } = stop as Record<string, unknown>;
    if (typeof color !== 'string' || !Number.isFinite(pos as number)) {
      return null;
    }
    stops.push({ color, pos: pos as number });
  }
  return toCanonicalGradient({
    angle: raw.angle as number | undefined,
    stops,
  });
}

/**
 * position 한 개의 gradient 형제 필드(+ counter fill gradient)를 canonical로.
 * Rust 경계 repair를 그대로 미러링:
 * - 깨진 spec은 필드 drop, 관용 spec은 canonical 정규화
 * - gradient Some ⇒ base = 첫 스톱 색 (KeyPosition 쌍은 원문, counter fill은 compact rgba)
 * 변경이 없으면 동일 참조를 반환해 diff·리렌더 안정성 유지
 */
export function canonicalizePositionGradients<
  T extends Record<string, unknown>,
>(position: T): T {
  let next: Record<string, unknown> | null = null;
  const ensure = (): Record<string, unknown> => (next ??= { ...position });

  for (const [baseField, siblingField] of KEY_PAIR_FIELDS) {
    if (!(siblingField in position)) continue;
    if (position[siblingField] == null) {
      // null은 canonical 'None' — Rust 직렬화(필드 생략)와 동일 표현으로 수렴
      delete ensure()[siblingField];
      continue;
    }
    const canonical = canonicalGradientOrNull(position[siblingField]);
    if (canonical === null) {
      delete ensure()[siblingField];
      continue;
    }
    if (JSON.stringify(canonical) !== JSON.stringify(position[siblingField])) {
      ensure()[siblingField] = canonical;
    }
    const repairedBase = canonical.stops[0]?.color;
    if (
      typeof repairedBase === 'string' &&
      position[baseField] !== repairedBase
    ) {
      ensure()[baseField] = repairedBase;
    }
  }

  // note border 쌍 - 대표색은 hex 전용(마이그레이션 계약), §2A 밖 스톱은
  // 필드 drop + base 유지 (Rust store 경계 미러). 스톱 검사는 canonical
  // 절단(8개) 이전의 원본 배열 기준 - Rust가 역직렬화 시점 원본을 보는 것과 일치
  if ('noteBorderGradient' in position) {
    const stored = (next ?? position).noteBorderGradient;
    if (stored == null) {
      delete ensure().noteBorderGradient;
    } else {
      const canonical = strictCanonicalOrNull(stored);
      if (canonical === null) {
        delete ensure().noteBorderGradient;
      } else {
        if (JSON.stringify(canonical) !== JSON.stringify(stored)) {
          ensure().noteBorderGradient = canonical;
        }
        const repairedBase = hexRepresentative(
          canonical.stops[0]?.color ?? '#FFFFFF',
        );
        if (
          repairedBase !== null &&
          (next ?? position).noteBorderColor !== repairedBase
        ) {
          ensure().noteBorderColor = repairedBase;
        }
      }
    }
  }

  // 본체·글로우 쌍 - 신형(sibling 존재)일 때 구형 shadow 4필드를 atomic 동기
  // (계약 §9-3, Rust 미러): noteColor는 첫/끝 스톱 대문자 hex의 구형 gradient
  // 객체, Top/Bottom은 round(스톱 알파 × 배율). 배율 부재 = 100
  const syncNotePaintShadow = (
    pair: (typeof NOTE_PAINT_SHADOW_PAIRS)[number],
  ): void => {
    if (!(pair.gradientField in (next ?? position))) return;
    const stored = (next ?? position)[pair.gradientField];
    if (stored == null) {
      delete ensure()[pair.gradientField];
      return;
    }
    const canonical = strictCanonicalOrNull(stored);
    if (canonical === null) {
      delete ensure()[pair.gradientField];
      return;
    }
    if (JSON.stringify(canonical) !== JSON.stringify(stored)) {
      ensure()[pair.gradientField] = canonical;
    }
    const shadowColor = notePaintShadowColor(canonical);
    if (shadowColor === null) return;
    const current = next ?? position;
    if (
      JSON.stringify(current[pair.colorField]) !== JSON.stringify(shadowColor)
    ) {
      ensure()[pair.colorField] = shadowColor;
    }
    const rawMultiplier = current[pair.multiplierField];
    const multiplier =
      typeof rawMultiplier === 'number' && Number.isFinite(rawMultiplier)
        ? rawMultiplier
        : 100;
    // 배율 부재는 100으로 실체화 (Rust default_missing_note_gradient_multipliers 미러)
    if (multiplier === 100 && rawMultiplier !== 100) {
      ensure()[pair.multiplierField] = 100;
    }
    const { top: topShadow, bottom: bottomShadow } = notePaintShadowOpacity(
      canonical,
      multiplier,
    );
    if (current[pair.topField] !== topShadow) {
      ensure()[pair.topField] = topShadow;
    }
    if (current[pair.bottomField] !== bottomShadow) {
      ensure()[pair.bottomField] = bottomShadow;
    }
  };

  // 글로우 따라가기(noteGlowSyncPaint)면 본체 정규화 뒤에 본체 5필드를 글로우로
  // 복사 (Rust canonicalize_gradient_pairs 미러). 이어지는 글로우 정규화는 no-op
  const mirrorNoteBodyToGlow = (): void => {
    const current = next ?? position;
    const copy = (from: string, to: string): void => {
      const value = current[from];
      if (value === undefined) {
        if (to in current) delete ensure()[to];
        return;
      }
      if (JSON.stringify(current[to]) === JSON.stringify(value)) return;
      ensure()[to] =
        typeof value === 'object' && value !== null
          ? structuredClone(value)
          : value;
    };
    copy('noteGradient', 'noteGlowGradient');
    copy('noteColor', 'noteGlowColor');
    copy('noteOpacity', 'noteGlowOpacity');
    copy('noteOpacityTop', 'noteGlowOpacityTop');
    copy('noteOpacityBottom', 'noteGlowOpacityBottom');
  };

  const [bodyPair, glowPair] = NOTE_PAINT_SHADOW_PAIRS;
  syncNotePaintShadow(bodyPair);
  if ((next ?? position).noteGlowSyncPaint === true) {
    mirrorNoteBodyToGlow();
  }
  syncNotePaintShadow(glowPair);

  const counterSource = (next ?? position).counter;
  if (
    counterSource &&
    typeof counterSource === 'object' &&
    !Array.isArray(counterSource)
  ) {
    const counter = counterSource as Record<string, unknown>;
    let counterNext: Record<string, unknown> | null = null;
    const ensureCounter = (): Record<string, unknown> =>
      (counterNext ??= { ...counter });

    for (const [stateKey, siblingField] of COUNTER_FILL_PAIRS) {
      if (!(siblingField in counter)) continue;
      if (counter[siblingField] == null) {
        // null은 canonical 'None' — Rust 직렬화(필드 생략)와 동일 표현으로 수렴
        delete ensureCounter()[siblingField];
        continue;
      }
      const canonical = canonicalGradientOrNull(counter[siblingField]);
      if (canonical === null) {
        delete ensureCounter()[siblingField];
        continue;
      }
      if (JSON.stringify(canonical) !== JSON.stringify(counter[siblingField])) {
        ensureCounter()[siblingField] = canonical;
      }
      const fill = (counterNext ?? counter).fill;
      if (fill && typeof fill === 'object' && !Array.isArray(fill)) {
        const repaired = toCompactRgba(canonical.stops[0]?.color ?? '#ffffff');
        if ((fill as Record<string, unknown>)[stateKey] !== repaired) {
          ensureCounter().fill = {
            ...(fill as Record<string, unknown>),
            [stateKey]: repaired,
          };
        }
      }
    }

    if (counterNext) {
      ensure().counter = counterNext;
    }
  }

  return (next as T) ?? position;
}

export type ColorModeValue =
  | { mode: 'solid'; color: string }
  | { mode: 'gradient'; spec: GradientSpec };

export interface ColorPair {
  color?: string;
  gradient?: GradientSpec | null;
}

export interface PaintDescriptorV1 {
  color: string;
  gradient: GradientSpec | null;
}

export type PaintPropertyNameV1 =
  | 'backgroundPaint'
  | 'activeBackgroundPaint'
  | 'borderPaint'
  | 'activeBorderPaint'
  | 'fontPaint'
  | 'activeFontPaint';

export type PaintSurfaceV1 = 'background' | 'border' | 'font';

const PAINT_PROPERTY_MAP = {
  backgroundPaint: { active: false, surface: 'background' },
  activeBackgroundPaint: { active: true, surface: 'background' },
  borderPaint: { active: false, surface: 'border' },
  activeBorderPaint: { active: true, surface: 'border' },
  fontPaint: { active: false, surface: 'font' },
  activeFontPaint: { active: true, surface: 'font' },
} as const satisfies Record<
  PaintPropertyNameV1,
  { active: boolean; surface: PaintSurfaceV1 }
>;

const PAINT_SURFACE_FIELDS = {
  background: {
    color: 'backgroundColor',
    gradient: 'backgroundGradient',
    activeColor: 'activeBackgroundColor',
    activeGradient: 'activeBackgroundGradient',
  },
  border: {
    color: 'borderColor',
    gradient: 'borderGradient',
    activeColor: 'activeBorderColor',
    activeGradient: 'activeBorderGradient',
  },
  font: {
    color: 'fontColor',
    gradient: 'fontGradient',
    activeColor: 'activeFontColor',
    activeGradient: 'activeFontGradient',
  },
} as const;

export function paintPropertyFields(field: PaintPropertyNameV1) {
  const { active, surface } = PAINT_PROPERTY_MAP[field];
  const fields = PAINT_SURFACE_FIELDS[surface];
  return {
    active,
    surface,
    colorField: active ? fields.activeColor : fields.color,
    gradientField: active ? fields.activeGradient : fields.gradient,
    activeColorField: fields.activeColor,
    activeGradientField: fields.activeGradient,
  } as const;
}

export function inheritedPaintMaterialization(
  idlePair: ColorPair,
  activePair: ColorPair,
): { color: string | null; gradient: GradientSpec | null } | null {
  if (hasStoredPairValue(activePair)) return null;
  if (!hasStoredPairValue(idlePair)) return null;
  // 백엔드 preserve와 동일 - idle 쌍을 있는 그대로 복제 (색 합성 없음,
  // 빈 문자열도 저장돼 있으면 그대로 복제)
  return {
    color: typeof idlePair.color === 'string' ? idlePair.color : null,
    gradient: idlePair.gradient ? structuredClone(idlePair.gradient) : null,
  };
}

const hasStoredPairValue = (pair: ColorPair): boolean =>
  (typeof pair.color === 'string' && pair.color.trim().length > 0) ||
  pair.gradient != null;

/**
 * 상태별 색 쌍 해석 — active 쌍에 유효한 저장값이 있으면 active 쌍 전체를,
 * 없으면 idle 쌍 전체를 사용 (색/그라데이션이 상태 간에 섞여 새지 않도록 쌍 단위 폴백)
 */
export function resolveStatePair(
  active: boolean,
  idlePair: ColorPair,
  activePair: ColorPair,
): ColorPair {
  if (active && hasStoredPairValue(activePair)) {
    return activePair;
  }
  return idlePair;
}

/**
 * 보더 그라데이션 링 스타일 — 마스크 단일 합성 (이중 배경 금지, lessons.md AA seam)
 * 키 루트의 첫 자식 absolute 요소로 렌더
 */
export function gradientRingStyle(
  spec: GradientSpec,
  widthPx: number,
): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    padding: `${widthPx}px`,
    // 실제 background 선언은 저특이도 전역 규칙이 담당 — 일반 커스텀 CSS가
    // 링을 숨기거나 교체할 수 있고, 인라인 우선 모드만 호출부에서 승격
    '--dmn-border-gradient-image-default': gradientToCss(spec),
    WebkitMask:
      'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    WebkitMaskComposite: 'xor',
    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    maskComposite: 'exclude',
    pointerEvents: 'none',
  } as React.CSSProperties;
}

/**
 * 형제 쌍 atomic patch — 전이 표(api-contract)를 프론트에서 강제.
 * 단색 전환: base 갱신 + gradient 제거를 한 patch로.
 * 그라데이션: canonical spec + 대표색(첫 스톱 원문) 동기.
 * compact escape는 마이그레이션 스냅샷 위험이 있는 counter fill 전용 —
 * KeyPosition 색 쌍에는 적용하지 않는다 (백엔드 계약 합치).
 */
export function gradientPairPatch(
  baseField: keyof typeof GRADIENT_SIBLING,
  value: ColorModeValue,
): Record<string, unknown> {
  const siblingField = GRADIENT_SIBLING[baseField];
  if (value.mode === 'solid') {
    return { [baseField]: value.color, [siblingField]: undefined };
  }
  const spec = toCanonicalGradient(value.spec);
  return {
    [baseField]: spec.stops[0]?.color ?? '#ffffff',
    [siblingField]: spec,
  };
}

export function paintDescriptor(value: ColorModeValue): PaintDescriptorV1 {
  if (value.mode === 'solid') {
    return { color: value.color, gradient: null };
  }
  const gradient = toCanonicalGradient(value.spec);
  return {
    color: gradient.stops[0]?.color ?? '#ffffff',
    gradient,
  };
}

/**
 * counter fill 쌍 값 산출 — 대표색은 compact canonical rgba로 강제
 * (구버전 migrate_legacy_defaults 스냅샷과의 바이트 매치 차단)
 */
export function counterFillPair(value: ColorModeValue): {
  color: string;
  gradient: GradientSpec | null;
} {
  if (value.mode === 'solid') {
    return { color: value.color, gradient: null };
  }
  const spec = toCanonicalGradient(value.spec);
  return {
    color: toCompactRgba(spec.stops[0]?.color ?? '#ffffff'),
    gradient: spec,
  };
}
