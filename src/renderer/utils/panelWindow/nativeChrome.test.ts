import { describe, expect, it } from 'vitest';

import { isSentinelColor, parseComputedColor } from './nativeChrome';

describe('parseComputedColor', () => {
  it('rgb 계산색을 sRGB 0~1로 정규화한다', () => {
    expect(parseComputedColor('rgb(28, 28, 30)')).toEqual([
      28 / 255,
      28 / 255,
      30 / 255,
      1,
    ]);
  });

  it('알파가 있으면 그대로 보존한다', () => {
    expect(parseComputedColor('rgba(255, 255, 255, 0.1)')).toEqual([
      1, 1, 1, 0.1,
    ]);
  });

  it('공백·슬래시 구분 표기도 읽는다', () => {
    expect(parseComputedColor('rgb(0 0 0 / 0.5)')).toEqual([0, 0, 0, 0.5]);
  });

  // 토큰이 oklch 등으로 바뀌면 파싱 실패 - 네이티브 채움을 건너뛰고 현행 동작 유지
  it('해석할 수 없는 표기는 null', () => {
    expect(parseComputedColor('oklch(0.2 0.01 280)')).toBeNull();
    expect(parseComputedColor('')).toBeNull();
    expect(parseComputedColor('rgb(28, 28)')).toBeNull();
  });
});

// color는 상속 속성이라 토큰 부재/해석 실패가 본문 글자색으로 대체된다.
// 표식을 상속시켜 그 경로를 null로 떨어뜨리는 것이 readTokenColor의 안전장치
describe('isSentinelColor', () => {
  it('표식 색을 알아본다', () => {
    expect(isSentinelColor([1 / 255, 2 / 255, 3 / 255, 1])).toBe(true);
  });

  it('실제 토큰 색은 표식이 아니다', () => {
    expect(isSentinelColor([28 / 255, 28 / 255, 30 / 255, 1])).toBe(false);
    expect(isSentinelColor([1 / 255, 2 / 255, 3 / 255, 0.5])).toBe(false);
  });
});
