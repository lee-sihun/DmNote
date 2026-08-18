import { describe, expect, it } from 'vitest';
import {
  getListScrollMetrics,
  ITEM_GAP,
  ITEM_HEIGHT,
  SCROLL_EDGE_PADDING,
} from './listScrollMetrics';

const contentHeight = (count: number) =>
  count * (ITEM_HEIGHT + ITEM_GAP) + SCROLL_EDGE_PADDING;

describe('메뉴 높이 예산', () => {
  it('화면에 들어가면 스크롤하지 않는다', () => {
    expect(getListScrollMetrics(5, 800)).toEqual({
      needsScroll: false,
      maxHeight: undefined,
    });
  });

  // 예전에는 호출부가 개수를 넘겨야만 스크롤이 켜졌는데 넘기는 곳이 없어
  // 화면보다 긴 메뉴가 그냥 잘려 나갔다
  it('화면을 넘으면 스크롤한다', () => {
    const { needsScroll, maxHeight } = getListScrollMetrics(60, 800);

    expect(needsScroll).toBe(true);
    expect(maxHeight).toBeLessThan(800);
  });

  it('예산은 표면 패딩까지 뺀 값이라 화면을 넘지 않는다', () => {
    const viewportHeight = 400;
    const { maxHeight } = getListScrollMetrics(60, viewportHeight);
    // 표면이 위아래로 두르는 패딩(4)과 화면 여백(5)을 더해도 화면 안
    const surfaceHeight = maxHeight! + 4 * 2 + 5 * 2;

    expect(surfaceHeight).toBeLessThanOrEqual(viewportHeight);
  });

  it('경계에서 한 칸 차이로 스크롤이 켜진다', () => {
    // 10개가 딱 들어가는 화면 높이를 역산
    const viewportHeight = contentHeight(10) + 5 * 2 + 4 * 2;

    expect(getListScrollMetrics(10, viewportHeight).needsScroll).toBe(false);
    expect(getListScrollMetrics(11, viewportHeight).needsScroll).toBe(true);
  });

  it('화면이 아주 좁아도 최소 한 항목은 남긴다', () => {
    const { needsScroll, maxHeight } = getListScrollMetrics(5, 20);

    expect(needsScroll).toBe(true);
    expect(maxHeight).toBe(ITEM_HEIGHT);
  });

  it('화면 높이를 못 얻으면 제한하지 않는다', () => {
    expect(getListScrollMetrics(60, 0)).toEqual({
      needsScroll: false,
      maxHeight: undefined,
    });
  });
});
