/**
 * Color Palette Storage Utility
 * 최근 사용한 색상을 localStorage에 저장/관리하는 유틸리티
 */

const STORAGE_KEYS = {
  solid: 'dmnote-color-palette-solid',
  gradient: 'dmnote-color-palette-gradient',
};

const MAX_PALETTE_SIZE = 5;

/**
 * localStorage에서 팔레트 데이터 로드
 * @param {'solid' | 'gradient'} type
 * @returns {Array} 저장된 색상 배열 (최신이 왼쪽)
 */
export const loadPalette = (type) => {
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

/**
 * 팔레트에 색상 추가 (최신이 왼쪽, 중복 시 맨 앞으로 이동)
 * @param {'solid' | 'gradient'} type
 * @param {string | {type: 'gradient', top: string, bottom: string}} color
 */
export const addToPalette = (type, color) => {
  if (!color) return;

  const key = STORAGE_KEYS[type];
  const current = loadPalette(type);

  // 중복 체크를 위한 비교 함수
  const isSameColor = (a, b) => {
    if (type === 'solid') {
      return normalizeForComparison(a) === normalizeForComparison(b);
    }
    // gradient
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

/**
 * 비교를 위해 색상 문자열 정규화
 * @param {string} color
 * @returns {string}
 */
const normalizeForComparison = (color) => {
  if (!color || typeof color !== 'string') return '';

  // RGBA 형식 처리
  if (color.startsWith('rgba(')) {
    const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (match) {
      const [, r, g, b, a] = match;
      // RGBA를 8자리 hex로 변환
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

/**
 * 팔레트 초기화
 * @param {'solid' | 'gradient'} type
 */
export const clearPalette = (type) => {
  try {
    const key = STORAGE_KEYS[type];
    localStorage.removeItem(key);
  } catch {
    // localStorage 오류 무시
  }
};
