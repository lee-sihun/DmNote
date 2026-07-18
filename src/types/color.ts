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
  // 이미 [0,360)이면 원값 유지 — Rust rem_euclid와 부동소수 바이트 일치
  const angle =
    rawAngle >= 0 && rawAngle < 360 ? rawAngle : ((rawAngle % 360) + 360) % 360;
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
  const stops = spec.stops
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

/** gradient 형제 쌍 필드 이름 매핑 */
export const GRADIENT_SIBLING: Record<string, string> = {
  backgroundColor: 'backgroundGradient',
  activeBackgroundColor: 'activeBackgroundGradient',
  borderColor: 'borderGradient',
  activeBorderColor: 'activeBorderGradient',
};

const KEY_PAIR_FIELDS = Object.entries(GRADIENT_SIBLING);
const COUNTER_FILL_PAIRS: Array<['idle' | 'active', string]> = [
  ['idle', 'fillIdleGradient'],
  ['active', 'fillActiveGradient'],
];

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

/**
 * 상태별 색 쌍 해석 — active 쌍에 어떤 값이라도 있으면 active 쌍 전체를,
 * 없으면 idle 쌍 전체를 사용 (색/그라데이션이 상태 간에 섞여 새지 않도록 쌍 단위 폴백)
 */
export function resolveStatePair(
  active: boolean,
  idlePair: ColorPair,
  activePair: ColorPair,
): ColorPair {
  if (active && (activePair.color != null || activePair.gradient != null)) {
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
    background: gradientToCss(spec),
    WebkitMask:
      'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    WebkitMaskComposite: 'xor',
    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    maskComposite: 'exclude',
    pointerEvents: 'none',
  };
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
