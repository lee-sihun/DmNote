import { describe, it, expect } from 'vitest';
import {
  clampCounterBezier,
  createCubicBezierEasing,
  bezierToCssString,
  findBezierPresetId,
  COUNTER_DEFAULT_BEZIER,
  COUNTER_BEZIER_PRESETS,
} from './cubicBezier';

describe('clampCounterBezier', () => {
  it('기본값 배열을 그대로 반환', () => {
    const result = clampCounterBezier(COUNTER_DEFAULT_BEZIER);
    expect(result).toEqual(COUNTER_DEFAULT_BEZIER);
  });

  it('x1, x2를 0~1 범위로 클램핑', () => {
    const result = clampCounterBezier([-0.5, 0.5, 1.5, 0.5]);
    expect(result[0]).toBe(0);
    expect(result[2]).toBe(1);
  });

  it('y1, y2를 -4~4 범위로 클램핑', () => {
    const result = clampCounterBezier([0.5, -10, 0.5, 10]);
    expect(result[1]).toBe(-4);
    expect(result[3]).toBe(4);
  });

  it('빈 배열은 기본값으로 대체', () => {
    const result = clampCounterBezier([]);
    expect(result).toEqual(COUNTER_DEFAULT_BEZIER);
  });
});

describe('createCubicBezierEasing', () => {
  it('t=0이면 0 반환', () => {
    const easing = createCubicBezierEasing([0.25, 0.1, 0.25, 1]);
    expect(easing(0)).toBe(0);
  });

  it('t=1이면 1 반환', () => {
    const easing = createCubicBezierEasing([0.25, 0.1, 0.25, 1]);
    expect(easing(1)).toBe(1);
  });

  it('linear 베지어는 입력값에 근사', () => {
    const linear = createCubicBezierEasing([0, 0, 1, 1]);
    expect(linear(0.5)).toBeCloseTo(0.5, 2);
    expect(linear(0.25)).toBeCloseTo(0.25, 2);
  });

  it('undefined 전달 시 기본 베지어 사용', () => {
    const easing = createCubicBezierEasing(undefined);
    expect(easing(0)).toBe(0);
    expect(easing(1)).toBe(1);
    // 중간값은 0~1 사이
    const mid = easing(0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('bezierToCssString', () => {
  it('CSS cubic-bezier 문자열 생성', () => {
    const result = bezierToCssString([0.25, 0.46, 0.45, 0.94]);
    expect(result).toBe('cubic-bezier(0.25, 0.46, 0.45, 0.94)');
  });

  it('범위 초과값은 클램핑 후 변환', () => {
    const result = bezierToCssString([-1, 0, 2, 1]);
    expect(result).toBe('cubic-bezier(0.00, 0.00, 1.00, 1.00)');
  });
});

describe('findBezierPresetId', () => {
  it('프리셋과 일치하면 해당 ID 반환', () => {
    expect(findBezierPresetId([0, 0, 1, 1])).toBe('linear');
    expect(findBezierPresetId([0.42, 0, 0.58, 1])).toBe('easeInOut');
  });

  it('프리셋에 없으면 custom 반환', () => {
    expect(findBezierPresetId([0.1, 0.2, 0.3, 0.4])).toBe('custom');
  });

  it('모든 프리셋이 올바르게 매칭', () => {
    COUNTER_BEZIER_PRESETS.forEach((preset) => {
      expect(findBezierPresetId(preset.bezier)).toBe(preset.id);
    });
  });
});
