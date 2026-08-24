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

const hsvToRgb = (
  h: number,
  s: number,
  v: number,
  a: number = 1,
): { r: number; g: number; b: number; a: number } => {
  const sn = s / 100;
  const vn = v / 100;
  const sector = Math.floor((h % 360) / 60);
  const f = (h % 360) / 60 - sector;
  const p = vn * (1 - sn);
  const q = vn * (1 - sn * f);
  const t = vn * (1 - sn * (1 - f));

  const index = ((sector % 6) + 6) % 6;
  const r = [vn, q, p, p, t, vn][index] * 255;
  const g = [t, vn, vn, q, p, p][index] * 255;
  const b = [p, p, t, vn, vn, q][index] * 255;

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
};

// HSV 값으로 ColorObject 생성 — 전달된 hsv를 그대로 보존해
// 드래그 중 s=0/v=0에서 hue가 소실되지 않음
const hsvToColorObject = (hsv: {
  h: number;
  s: number;
  v: number;
  a: number;
}): ColorObject => {
  const h = clamp(hsv.h, 0, 360);
  const s = clamp(hsv.s, 0, 100);
  const v = clamp(hsv.v, 0, 100);
  const a = clamp(hsv.a, 0, 1);
  const rgb = hsvToRgb(h, s, v, a);
  const hex = `#${[rgb.r, rgb.g, rgb.b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
  return { hex, rgb, hsv: { h, s, v, a } };
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

// rgba(...)/8자리 hex에서 알파를 0~100 정수 퍼센트로 추출. 없으면 fallback
const parseAlphaPercent = (
  value: string | null | undefined,
  fallback = 100,
): number => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const rgba = parseRgbaString(trimmed);
  if (rgba) return Math.round(rgba.a * 100);
  const hex8 = trimmed.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  if (hex8) return Math.round((parseInt(hex8[2], 16) / 255) * 100);
  return fallback;
};

// #RRGGBB + 퍼센트 알파 → rgba(...) 문자열 (ColorPicker solidOnly 입력용)
const hexWithAlphaPercent = (hex: string, percent: number): string => {
  const parsed = parseHexColor(hex);
  const a = clamp(percent / 100, 0, 1);
  if (!parsed) return `rgba(255, 255, 255, ${a})`;
  return `rgba(${parsed.rgb.r}, ${parsed.rgb.g}, ${parsed.rgb.b}, ${a})`;
};

// hex 외 CSS 색 문자열(named, hsl, rgb 등)을 캔버스 fillStyle 정규화로 해석
let cssColorCtx: CanvasRenderingContext2D | null | undefined;

const parseCssColor = (value: string): ColorObject | null => {
  if (!(window.CSS?.supports?.('color', value) ?? false)) {
    return null;
  }
  if (cssColorCtx === undefined) {
    cssColorCtx = document.createElement('canvas').getContext('2d');
  }
  if (!cssColorCtx) return null;

  cssColorCtx.fillStyle = value;
  const normalized = cssColorCtx.fillStyle;
  if (normalized.startsWith('#')) {
    return parseHexColor(normalized);
  }
  const rgba = parseRgbaString(normalized);
  if (!rgba) return null;
  const hex = `#${[rgba.r, rgba.g, rgba.b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
  return { hex, rgb: rgba, hsv: rgbToHsv(rgba.r, rgba.g, rgba.b, rgba.a) };
};

const toColorObject = (
  value: string | Partial<ColorObject> | null | undefined,
): ColorObject | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return parseHexColor(value) ?? parseCssColor(value);
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

// 브라우저가 허용하는 CSS 색을 compact rgba로 정규화
const toCanonicalCssRgba = (value: string): string | null => {
  const parsed = toColorObject(value);
  if (!parsed) return null;
  const { r, g, b, a } = parsed.rgb;
  const alpha = Math.round(a * 10_000) / 10_000;
  return `rgba(${r},${g},${b},${alpha})`;
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
  hsvToRgb,
  hsvToColorObject,
  toColorObject,
  toCanonicalCssRgba,
  toCssRgba,
  parseAlphaPercent,
  hexWithAlphaPercent,
};
