import { describe, expect, it } from 'vitest';
import { composeInkSpan, scanAlphaBounds } from './counterGlyphMetrics';

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

describe('scanAlphaBounds', () => {
  const bitmap = (
    width: number,
    height: number,
    points: Array<[number, number]>,
  ) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of points) {
      data[(y * width + x) * 4 + 3] = 255;
    }
    return data;
  };

  it('알파가 전혀 없으면 null', () => {
    expect(scanAlphaBounds(bitmap(4, 4, []), 4, 4)).toBeNull();
  });

  it('단일 픽셀은 자기 자신이 경계', () => {
    expect(scanAlphaBounds(bitmap(5, 5, [[2, 3]]), 5, 5)).toEqual({
      minX: 2,
      minY: 3,
      maxX: 2,
      maxY: 3,
    });
  });

  it('흩어진 픽셀은 최소·최대 좌표 봉투로 잡는다', () => {
    const data = bitmap(8, 8, [
      [1, 2],
      [6, 5],
      [3, 7],
    ]);
    expect(scanAlphaBounds(data, 8, 8)).toEqual({
      minX: 1,
      minY: 2,
      maxX: 6,
      maxY: 7,
    });
  });
});
