import { describe, it, expect } from 'vitest';
import {
  isGradientColor,
  normalizeColorInput,
  parseHexColor,
  rgbToHsv,
  toColorObject,
  toCssRgba,
} from './colorUtils';

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
