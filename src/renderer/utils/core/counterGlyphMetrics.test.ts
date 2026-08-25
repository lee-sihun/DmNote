import { describe, expect, it } from 'vitest';
import { composeInkSpan } from './counterGlyphMetrics';

describe('composeInkSpan', () => {
  it('빈 입력은 null', () => {
    expect(composeInkSpan([], 0)).toBeNull();
  });

  it('단일 글자는 원점 기준 잉크 경계를 그대로 쓴다', () => {
    // actualBoundingBoxLeft는 왼쪽 방향이 양수 - 일반 사이드 베어링은 음수
    expect(composeInkSpan([{ advance: 10, left: -2, right: 9 }], 3)).toEqual({
      left: 2,
      right: 9,
    });
  });

  it('여러 글자는 letter-spacing 포함 advance로 누적된다', () => {
    const span = composeInkSpan(
      [
        { advance: 10, left: -2, right: 9 },
        { advance: 10, left: -1, right: 11 },
      ],
      3,
    );
    // 두 번째 글자 원점 = 10 + 3, 잉크 오른끝 = 13 + 11
    expect(span).toEqual({ left: 2, right: 24 });
  });

  it('마지막 글자 뒤 letter-spacing은 잉크 범위에 들어가지 않는다', () => {
    const tight = composeInkSpan([{ advance: 10, left: 0, right: 10 }], 0);
    const spaced = composeInkSpan([{ advance: 10, left: 0, right: 10 }], 100);
    expect(spaced).toEqual(tight);
  });

  it('잉크가 없는 글자만 있으면 null', () => {
    expect(composeInkSpan([{ advance: 5, left: 0, right: 0 }], 0)).toBeNull();
  });
});
