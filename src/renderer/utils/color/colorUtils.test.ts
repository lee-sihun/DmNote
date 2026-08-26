import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  isGradientColor,
  normalizeColorInput,
  parseHexColor,
  rgbToHsv,
  hsvToRgb,
  hsvToColorObject,
  toColorObject,
  toCanonicalCssRgba,
  toCssRgba,
  toRgbHexColor,
} from './colorUtils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isGradientColor', () => {
  it('gradient 객체를 감지', () => {
    expect(
      isGradientColor({ type: 'gradient', top: '#fff', bottom: '#000' }),
    ).toBe(true);
  });

  it('일반 문자열은 false', () => {
    expect(isGradientColor('#ff0000')).toBe(false);
  });

  it('null/undefined는 false', () => {
    expect(isGradientColor(null)).toBe(false);
    expect(isGradientColor(undefined)).toBe(false);
  });
});

describe('normalizeColorInput', () => {
  it('null/undefined는 기본 색상 반환', () => {
    expect(normalizeColorInput(null)).toBe('#561ecb');
    expect(normalizeColorInput(undefined)).toBe('#561ecb');
  });

  it('일반 hex 문자열은 그대로 반환', () => {
    expect(normalizeColorInput('#ff0000')).toBe('#ff0000');
  });

  it('rgba 문자열을 hex로 변환', () => {
    const result = normalizeColorInput('rgba(255, 0, 0, 1)');
    expect(result).toBe('#FF0000FF');
  });

  it('gradient 객체에서 top 색상 추출', () => {
    expect(
      normalizeColorInput({ type: 'gradient', top: '#abc', bottom: '#def' }),
    ).toBe('#abc');
  });
});

describe('parseHexColor', () => {
  it('6자리 hex 파싱', () => {
    const result = parseHexColor('#FF0000');
    expect(result).not.toBeNull();
    expect(result!.rgb).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(result!.hex).toBe('#FF0000');
  });

  it('3자리 hex를 6자리로 확장', () => {
    const result = parseHexColor('#F00');
    expect(result).not.toBeNull();
    expect(result!.rgb.r).toBe(255);
    expect(result!.rgb.g).toBe(0);
    expect(result!.rgb.b).toBe(0);
  });

  it('8자리 hex (알파 포함) 파싱', () => {
    const result = parseHexColor('#FF000080');
    expect(result).not.toBeNull();
    expect(result!.rgb.a).toBeCloseTo(128 / 255, 2);
  });

  it('# 없는 hex도 파싱', () => {
    const result = parseHexColor('00FF00');
    expect(result).not.toBeNull();
    expect(result!.rgb.g).toBe(255);
  });

  it('유효하지 않은 길이는 null 반환', () => {
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#1')).toBeNull();
  });

  it('유효하지 않은 문자는 null 반환', () => {
    expect(parseHexColor('#GGGGGG')).toBeNull();
  });
});

describe('rgbToHsv', () => {
  it('빨간색 변환', () => {
    const hsv = rgbToHsv(255, 0, 0);
    expect(hsv.h).toBeCloseTo(0);
    expect(hsv.s).toBeCloseTo(100);
    expect(hsv.v).toBeCloseTo(100);
  });

  it('검은색 변환', () => {
    const hsv = rgbToHsv(0, 0, 0);
    expect(hsv.h).toBe(0);
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBe(0);
  });

  it('흰색 변환', () => {
    const hsv = rgbToHsv(255, 255, 255);
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBeCloseTo(100);
  });

  it('알파값 전달', () => {
    const hsv = rgbToHsv(255, 0, 0, 0.5);
    expect(hsv.a).toBe(0.5);
  });
});

describe('hsvToRgb', () => {
  it('빨간색 변환', () => {
    const rgb = hsvToRgb(0, 100, 100);
    expect(rgb).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('h=360은 h=0과 동일', () => {
    expect(hsvToRgb(360, 100, 100)).toEqual(hsvToRgb(0, 100, 100));
  });

  it('무채색은 s=0', () => {
    const rgb = hsvToRgb(210, 0, 50);
    expect(rgb.r).toBe(rgb.g);
    expect(rgb.g).toBe(rgb.b);
  });

  it('rgbToHsv 왕복 보존', () => {
    const cases: [number, number, number][] = [
      [255, 0, 0],
      [0, 128, 255],
      [12, 200, 89],
      [183, 150, 255],
    ];
    for (const [r, g, b] of cases) {
      const hsv = rgbToHsv(r, g, b);
      const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(rgb.r).toBe(r);
      expect(rgb.g).toBe(g);
      expect(rgb.b).toBe(b);
    }
  });

  it('알파값 전달', () => {
    expect(hsvToRgb(0, 100, 100, 0.5).a).toBe(0.5);
  });
});

describe('hsvToColorObject', () => {
  it('hex는 대문자 6자리, hsv는 그대로 보존', () => {
    const color = hsvToColorObject({ h: 270, s: 0, v: 100, a: 1 });
    expect(color.hex).toBe('#FFFFFF');
    // s=0이어도 hue 소실 없음
    expect(color.hsv.h).toBe(270);
  });

  it('범위 밖 값은 클램프', () => {
    const color = hsvToColorObject({ h: 400, s: 120, v: -5, a: 2 });
    expect(color.hsv.h).toBe(360);
    expect(color.hsv.s).toBe(100);
    expect(color.hsv.v).toBe(0);
    expect(color.hsv.a).toBe(1);
  });
});

describe('toColorObject', () => {
  it('hex 문자열에서 ColorObject 생성', () => {
    const result = toColorObject('#00FF00');
    expect(result).not.toBeNull();
    expect(result!.rgb.g).toBe(255);
  });

  it('null은 null 반환', () => {
    expect(toColorObject(null)).toBeNull();
  });

  it('부분 ColorObject를 보완', () => {
    const result = toColorObject({ hex: '#FF0000' });
    expect(result).not.toBeNull();
    expect(result!.rgb.r).toBe(255);
    expect(result!.hsv).toBeDefined();
  });
});

describe('toCanonicalCssRgba', () => {
  it('브라우저가 허용하는 named color를 strict rgba로 정규화', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    let fillStyle = '#000000';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        fillStyle = value === 'rebeccapurple' ? '#663399' : value;
      },
    } as CanvasRenderingContext2D);

    expect(toCanonicalCssRgba('rebeccapurple')).toBe('rgba(102,51,153,1)');
  });
});

describe('toCssRgba', () => {
  it('hex를 rgba CSS 문자열로 변환', () => {
    const result = toCssRgba('#FF0000');
    expect(result.css).toBe('rgba(255, 0, 0, 1)');
    expect(result.alpha).toBe(1);
    expect(result.rgb).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('null이면 fallback 사용', () => {
    const result = toCssRgba(null, '#00FF00');
    expect(result.rgb.g).toBe(255);
  });

  it('transparent 처리', () => {
    const result = toCssRgba('transparent');
    expect(result.css).toBe('rgba(0, 0, 0, 0)');
    expect(result.alpha).toBe(0);
  });

  it('rgba 문자열 직접 파싱', () => {
    const result = toCssRgba('rgba(100, 200, 50, 0.8)');
    expect(result.css).toBe('rgba(100, 200, 50, 0.8)');
    expect(result.alpha).toBe(0.8);
  });
});

describe('toRgbHexColor', () => {
  // 이슈 #73 회귀: rgba 문자열이 초록색으로 깨지지 않아야 함
  it('rgba 문자열을 알파 버리고 #RRGGBB로 변환', () => {
    expect(toRgbHexColor('rgba(255, 0, 167, 1)')).toBe('#FF00A7');
    expect(toRgbHexColor('rgba(100, 200, 50, 0.8)')).toBe('#64C832');
  });

  it('알파 0이어도 RGB 유지', () => {
    expect(toRgbHexColor('rgba(18, 52, 86, 0)')).toBe('#123456');
  });

  it('알파 없는 rgb()도 변환', () => {
    expect(toRgbHexColor('rgb(255, 0, 167)')).toBe('#FF00A7');
  });

  it('#RRGGBB는 대문자로 그대로', () => {
    expect(toRgbHexColor('#ff00a7')).toBe('#FF00A7');
    expect(toRgbHexColor('#FF00A7')).toBe('#FF00A7');
  });

  it('3자리/8자리 hex도 #RRGGBB로 정규화 (알파 제거)', () => {
    expect(toRgbHexColor('#f0a')).toBe('#FF00AA');
    expect(toRgbHexColor('#FF00A7CC')).toBe('#FF00A7');
  });

  it('잘못된 입력/빈값/null은 fallback', () => {
    expect(toRgbHexColor(null)).toBe('#FFFFFF');
    expect(toRgbHexColor(undefined)).toBe('#FFFFFF');
    expect(toRgbHexColor('')).toBe('#FFFFFF');
    expect(toRgbHexColor('garbage')).toBe('#FFFFFF');
  });

  it('커스텀 fallback 지원', () => {
    expect(toRgbHexColor(null, '#000000')).toBe('#000000');
  });
});
