const MODES = Object.freeze({
  solid: 'solid',
  gradient: 'gradient',
});

const isGradientColor = (value) =>
  value && typeof value === 'object' && value.type === 'gradient';

const normalizeColorInput = (value) => {
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

const buildGradient = (topHex, bottomHex) => ({
  type: 'gradient',
  top: topHex,
  bottom: bottomHex,
});

const HEX_LENGTHS = [3, 4, 6, 8];

const rgbToHsv = (r, g, b, a = 1) => {
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

const parseHexColor = (value) => {
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
          .map((char) => char + char)
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

const RGBA_REGEX =
  /^rgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*([0-9]*\.?[0-9]+)\)$/i;

const clamp = (value, min, max) => {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const parseRgbaString = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.match(RGBA_REGEX);
  if (!match) return null;

  const r = clamp(parseInt(match[1], 10), 0, 255);
  const g = clamp(parseInt(match[2], 10), 0, 255);
  const b = clamp(parseInt(match[3], 10), 0, 255);
  const a = clamp(parseFloat(match[4]), 0, 1);

  return { r, g, b, a };
};

const toColorObject = (value) => {
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

const toCssRgba = (value, fallback = '#000000') => {
  let candidate = value;
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
  buildGradient,
  parseHexColor,
  rgbToHsv,
  toColorObject,
  toCssRgba,
};
