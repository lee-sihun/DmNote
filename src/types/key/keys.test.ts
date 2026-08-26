import { describe, it, expect } from 'vitest';
import { keyPositionSchema, normalizeCounterSettings } from './keys';

describe('keyPositionSchema 시각 px 필드 소수 허용', () => {
  it('noteWidth 소수 허용', () => {
    expect(keyPositionSchema.shape.noteWidth.parse(100.5)).toBe(100.5);
    expect(keyPositionSchema.shape.noteWidth.parse(100)).toBe(100);
  });

  it('noteBorderRadius 소수 허용', () => {
    expect(keyPositionSchema.shape.noteBorderRadius.parse(8.5)).toBe(8.5);
  });

  it('noteGlowSize 소수 허용', () => {
    expect(keyPositionSchema.shape.noteGlowSize.parse(20.5)).toBe(20.5);
  });

  it('noteBorderWidth 소수 허용', () => {
    expect(keyPositionSchema.shape.noteBorderWidth.parse(2.5)).toBe(2.5);
  });

  // 정수 유지 필드는 여전히 소수를 거부해야 한다
  it('noteOpacity는 소수 거부(정수 유지)', () => {
    expect(() => keyPositionSchema.shape.noteOpacity.parse(80.5)).toThrow();
  });
});

describe('normalizeCounterSettings 손상 필드 격리', () => {
  it('잘못된 선택 gradient만 제거하고 유효한 카운터 설정은 보존', () => {
    const normalized = normalizeCounterSettings({
      enabled: true,
      placement: 'outside',
      fill: { idle: '#111111', active: '#222222' },
      fillIdleGradient: { angle: 0, stops: [] },
    });

    expect(normalized.enabled).toBe(true);
    expect(normalized.placement).toBe('outside');
    expect(normalized.fill).toEqual({
      idle: '#111111',
      active: '#222222',
    });
    expect(normalized.fillIdleGradient).toBeNull();
  });

  it('지원 종료된 stroke 필드는 통째로 버린다', () => {
    const normalized = normalizeCounterSettings({
      stroke: { idle: '#112233', active: '#445566' },
      strokeIdleGradient: {
        angle: 90,
        stops: [
          { color: '#112233', pos: 0 },
          { color: '#FFFFFF', pos: 1 },
        ],
      },
    });

    expect('stroke' in normalized).toBe(false);
    expect('strokeIdleGradient' in normalized).toBe(false);
  });
});
