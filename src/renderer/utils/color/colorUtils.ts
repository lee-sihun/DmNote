export interface GradientColor {
  type: 'gradient';
  top: string;
  bottom: string;
}

export interface ColorObject {
  hex: string;
  rgb: { r: number; g: number; b: number; a: number };
  hsv: { h: number; s: number; v: number; a: number };
}

export interface CssRgbaResult {
  css: string;
  alpha: number;
  rgb: { r: number; g: number; b: number };
}

const MODES = Object.freeze({
  solid: 'solid',
  gradient: 'gradient',
} as const);

const isGradientColor = (value: unknown): value is GradientColor =>
  value !== null &&
  value !== undefined &&
  typeof value === 'object' &&
  (value as GradientColor).type === 'gradient';

const normalizeColorInput = (
  value: string | GradientColor | null | undefined,
): string => {
  if (!value) return '#561ecb';
  if (typeof value === 'string') {
    // RGBA 포맷 처리
    if (value.startsWith('rgba(')) {
      const rgbaMatch = value.match(
        /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
      );
      if (rgbaMatch) {
        const [, r, g, b, a] = rgbaMatch;
        const hex = `#${parseInt(r).toString(16).padStart(2, '0')}${parseInt(g)
          .toString(16)
          .padStart(2, '0')}${parseInt(b)
          .toString(16)
          .padStart(2, '0')}${Math.round(parseFloat(a) * 255)
          .toString(16)
          .padStart(2, '0')}`.toUpperCase();
        return hex;
      }
    }
    return value;
  }
  if (isGradientColor(value)) return value.top;
  return '#561ecb';
};

// 알파를 버리고 항상 대문자 #RRGGBB 반환. noteBorderColor처럼 hex 계약이 강제된 필드용
const toRgbHexColor = (
  value: string | null | undefined,
  fallback = '#FFFFFF',
): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // rgb(...) / rgba(...) — 알파 버리고 0~255 클램프
    const rgb = trimmed.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i,
    );
    if (rgb) {
      const toHex = (n: string) =>
        Math.min(255, Number(n)).toString(16).padStart(2, '0');
      return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`.toUpperCase();
    }
    const parsed = parseHexColor(trimmed);
    if (parsed) return parsed.hex;
  }
  return fallback;
};

const buildGradient = (topHex: string, bottomHex: string): GradientColor => ({
  type: 'gradient',
  top: topHex,
  bottom: bottomHex,
});

const HEX_LENGTHS: number[] = [3, 4, 6, 8];

const rgbToHsv = (
  r: number,
  g: number,
  b: number,
  a: number = 1,
): { h: number; s: number; v: number; a: number } => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === rn) {
      h = (gn - bn) / delta;
    } else if (max === gn) {
      h = 2 + (bn - rn) / delta;
    } else {
      h = 4 + (rn - gn) / delta;
    }

    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }

  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return {
    h,
    s,
    v,
    a,
  };
};

const parseHexColor = (value: string): ColorObject | null => {
  const normalized = value.startsWith('#') ? value : `#${value}`;
  const hexBody = normalized.slice(1);

  if (!HEX_LENGTHS.includes(hexBody.length)) {
    return null;
  }

  const cleaned = hexBody.replace(/[^0-9A-Fa-f]/g, '');
  if (cleaned.length !== hexBody.length) {
    return null;
  }

  if (!(window.CSS?.supports?.('color', `#${cleaned}`) ?? true)) {
    return null;
  }

  const fullHex =
    cleaned.length === 3 || cleaned.length === 4
      ? cleaned
          .split('')
          .map((char: string) => char + char)
          .join('')
      : cleaned;

  const hasAlpha = fullHex.length === 8;

  const hex = `#${hasAlpha ? fullHex.slice(0, 6) : fullHex}`.toUpperCase();
  const alpha = hasAlpha ? fullHex.slice(6) : null;

  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);
  const a = alpha ? parseInt(alpha, 16) / 255 : 1;

  return {
    hex,
    rgb: { r, g, b, a },
    hsv: rgbToHsv(r, g, b, a),
  };
};

const RGBA_REGEX: RegExp =
  /^rgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*([0-9]*\.?[0-9]+)\)$/i;

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const parseRgbaString = (
  value: string,
): { r: number; g: number; b: number; a: number } | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(RGBA_REGEX);
  if (!match) return null;

  const r = clamp(parseInt(match[1], 10), 0, 255);
  const g = clamp(parseInt(match[2], 10), 0, 255);
  const b = clamp(parseInt(match[3], 10), 0, 255);
  const a = clamp(parseFloat(match[4]), 0, 1);

  return { r, g, b, a };
};

const toColorObject = (
  value: string | Partial<ColorObject> | null | undefined,
): ColorObject | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return parseHexColor(value);
  }

  if (typeof value === 'object' && value.hex) {
    const parsed = parseHexColor(value.hex);
    if (!parsed) {
      return null;
    }
    return {
      hex: parsed.hex,
      rgb: value.rgb ?? parsed.rgb,
      hsv: value.hsv ?? parsed.hsv,
    };
  }

  return null;
};

const toCssRgba = (
  value: string | null | undefined,
  fallback: string = '#000000',
): CssRgbaResult => {
  let candidate: string | null | undefined = value;
  if (
    !candidate ||
    (typeof candidate === 'string' && candidate.trim().length === 0)
  ) {
    candidate = fallback;
  }

  if (typeof candidate !== 'string') {
    return toCssRgba(fallback, '#000000');
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    if (fallback && fallback !== candidate) {
      return toCssRgba(fallback, '#000000');
    }
    return {
      css: 'rgba(0, 0, 0, 1)',
      alpha: 1,
      rgb: { r: 0, g: 0, b: 0 },
    };
  }

  if (trimmed.toLowerCase() === 'transparent') {
    return {
      css: 'rgba(0, 0, 0, 0)',
      alpha: 0,
      rgb: { r: 0, g: 0, b: 0 },
    };
  }

  const rgbaFromString = parseRgbaString(trimmed);
  if (rgbaFromString) {
    const { r, g, b, a } = rgbaFromString;
    return {
      css: `rgba(${r}, ${g}, ${b}, ${a})`,
      alpha: a,
      rgb: { r, g, b },
    };
  }

  const normalized = normalizeColorInput(trimmed);
  const parsed = parseHexColor(normalized);
  if (parsed) {
    const { r, g, b, a } = parsed.rgb;
    const alpha = typeof a === 'number' ? a : 1;
    return {
      css: `rgba(${r}, ${g}, ${b}, ${alpha})`,
      alpha,
      rgb: { r, g, b },
    };
  }

  if (fallback && trimmed !== fallback) {
    return toCssRgba(fallback, '#000000');
  }

  return {
    css: trimmed,
    alpha: 1,
    rgb: { r: 0, g: 0, b: 0 },
  };
};

export {
  MODES,
  isGradientColor,
  normalizeColorInput,
  toRgbHexColor,
  buildGradient,
  parseHexColor,
  rgbToHsv,
  toColorObject,
  toCssRgba,
};
