import { describe, expect, it } from 'vitest';
import type { CounterAnimationPreset } from '@src/types/key/counterAnimation';
import {
  COUNTER_GRID_PATH_MAJOR,
  COUNTER_GRID_PATH_MINOR,
  clampCounterDuration,
  createCounterAnimationEditorState,
  formatCounterBezierInput,
  normalizeCounterScale,
  parseCounterBezierInput,
  parseCounterNumber,
  resolveCounterEditorViewDimensions,
} from './counterAnimationEditorModel';

describe('counterAnimationEditorModel', () => {
  it('베지어 입력을 소수 둘째 자리로 정규화하고 x축 범위를 제한한다', () => {
    expect(formatCounterBezierInput([0.123, -1, 0.999, 2])).toBe(
      '0.12, -1, 1, 2',
    );
    expect(parseCounterBezierInput('-1, 2.345, 2, -3')).toEqual([
      0, 2.35, 1, -3,
    ]);
    expect(parseCounterBezierInput('0, 1, 2')).toBeNull();
    expect(parseCounterBezierInput('0, nope, 1, 1')).toBeNull();
  });

  it('숫자 draft와 duration·scale fallback 계약을 유지한다', () => {
    expect(parseCounterNumber('-.')).toBeNull();
    expect(parseCounterNumber('1.25')).toBe(1.25);
    expect(clampCounterDuration(5_999.6)).toBe(5_000);
    expect(clampCounterDuration(Number.NaN)).toBe(300);
    expect(normalizeCounterScale(Number.POSITIVE_INFINITY)).toBe(1.1);
  });

  it('프리셋 초기 상태와 종횡비별 viewBox를 계산한다', () => {
    const preset: CounterAnimationPreset = {
      id: 'preset',
      name: 'pop',
      source: 'user',
      bezier: [-1, 0, 2, 1],
      scale: Number.NaN,
      durationMs: 0,
    };
    expect(createCounterAnimationEditorState(preset)).toEqual({
      name: 'pop',
      bezier: [0, 0, 1, 1],
      scale: 1.1,
      durationMs: 1,
    });
    expect(resolveCounterEditorViewDimensions(1, 2)).toEqual({
      base: 150,
      vbW: 300,
      vbH: 150,
    });
    expect(COUNTER_GRID_PATH_MAJOR).not.toBe(COUNTER_GRID_PATH_MINOR);
  });
});
