/**
 * 색상 팔레트 저장 유틸리티
 * 최근 사용한 색상을 localStorage에 저장/관리하는 유틸리티
 */

import {
  toCanonicalGradient,
  type GradientSpec,
  type GradientStop,
} from '@src/types/color';

type PaletteType = 'solid' | 'gradient';
type GradientColor = { type: 'gradient'; top: string; bottom: string };
/** 각도·스톱 위치까지 담는 신형 그라데이션 항목 — 구형(top/bottom)과 같은 팔레트에 공존 */
export type GradientSpecColor = {
  type: 'gradient-spec';
  angle: number;
  stops: GradientStop[];
};
type SolidColor = string;
type PaletteColor = SolidColor | GradientColor | GradientSpecColor;

export const isGradientSpecColor = (
  value: unknown,
): value is GradientSpecColor =>
  !!value &&
  typeof value === 'object' &&
  (value as GradientSpecColor).type === 'gradient-spec' &&
  Array.isArray((value as GradientSpecColor).stops);

export const gradientSpecPaletteEntry = (
  spec: GradientSpec,
): GradientSpecColor => {
  const canonical = toCanonicalGradient(spec);
  return {
    type: 'gradient-spec',
    angle: canonical.angle,
    stops: canonical.stops,
  };
};

const STORAGE_KEYS: Record<PaletteType, string> = {
  solid: 'dmnote-color-palette-solid',
  gradient: 'dmnote-color-palette-gradient',
};

const MAX_PALETTE_SIZE = 7;

export const loadPalette = (type: PaletteType): PaletteColor[] => {
  try {
    const key = STORAGE_KEYS[type];
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const addToPalette = (type: PaletteType, color: PaletteColor): void => {
  if (!color) return;

  const key = STORAGE_KEYS[type];
  const current = loadPalette(type);

  // 중복 체크를 위한 비교 함수
  const isSameColor = (a: PaletteColor, b: PaletteColor): boolean => {
    if (type === 'solid') {
      return (
        normalizeForComparison(a as string) ===
        normalizeForComparison(b as string)
      );
    }
    // gradient-spec 비교 — canonical 직렬화 일치
    if (isGradientSpecColor(a) && isGradientSpecColor(b)) {
      return (
        JSON.stringify(toCanonicalGradient(a)) ===
        JSON.stringify(toCanonicalGradient(b))
      );
    }
    // gradient 비교
    if (
      a &&
      b &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      a.type === 'gradient' &&
      b.type === 'gradient'
    ) {
      return (
        normalizeForComparison(a.top) === normalizeForComparison(b.top) &&
        normalizeForComparison(a.bottom) === normalizeForComparison(b.bottom)
      );
    }
    return false;
  };

  // 기존에 동일 색상이 있으면 제거
  const filtered = current.filter((c) => !isSameColor(c, color));

  // 맨 앞에 추가
  const updated = [color, ...filtered].slice(0, MAX_PALETTE_SIZE);

  try {
    localStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // localStorage 오류 무시
  }
};

const normalizeForComparison = (color: string): string => {
  if (!color || typeof color !== 'string') return '';

  // RGBA 형식 변환 처리
  if (color.startsWith('rgba(')) {
    const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (match) {
      const [, r, g, b, a] = match;
      // RGBA → 8자리 hex 변환
      return `${parseInt(r).toString(16).padStart(2, '0')}${parseInt(g)
        .toString(16)
        .padStart(2, '0')}${parseInt(b)
        .toString(16)
        .padStart(2, '0')}${Math.round(parseFloat(a) * 255)
        .toString(16)
        .padStart(2, '0')}`.toUpperCase();
    }
  }

  // # 제거하고 대문자로
  return color.replace(/^#/, '').toUpperCase();
};

export const clearPalette = (type: PaletteType): void => {
  try {
    const key = STORAGE_KEYS[type];
    localStorage.removeItem(key);
  } catch {
    // localStorage 오류 무시
  }
};
