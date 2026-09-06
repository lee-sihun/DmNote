import { describe, expect, it } from 'vitest';
import { resolveZIndexFallback } from './zIndexFallback';

// 백엔드는 미설정 zIndex를 null로 직렬화한다. undefined만 결측으로 보면
// 폴백이 한 번도 걸리지 않고 Key 쪽 기본값 0으로 떨어져 쌓임 순서가 사라진다
describe('오버레이 키 zIndex 폴백', () => {
  it('null은 결측으로 보고 인덱스를 채운다', () => {
    const base = { zIndex: null } as unknown as { zIndex?: number };

    expect(resolveZIndexFallback(base, 3).zIndex).toBe(3);
  });

  it('undefined도 결측으로 보고 인덱스를 채운다', () => {
    const base: { zIndex?: number } = {};

    expect(resolveZIndexFallback(base, 2).zIndex).toBe(2);
  });

  it('설정된 zIndex는 그대로 두고 원본 참조를 유지한다', () => {
    const base = { zIndex: 7 };

    expect(resolveZIndexFallback(base, 1)).toBe(base);
  });

  it('0은 유효한 값이라 인덱스로 덮지 않는다', () => {
    const base = { zIndex: 0 };

    expect(resolveZIndexFallback(base, 5)).toBe(base);
  });

  it('같은 원본과 같은 인덱스면 같은 객체를 돌려준다', () => {
    const base: { zIndex?: number } = {};

    expect(resolveZIndexFallback(base, 4)).toBe(resolveZIndexFallback(base, 4));
  });

  it('인덱스가 바뀌면 새 값으로 다시 채운다', () => {
    const base: { zIndex?: number } = {};
    resolveZIndexFallback(base, 4);

    expect(resolveZIndexFallback(base, 9).zIndex).toBe(9);
  });
});
