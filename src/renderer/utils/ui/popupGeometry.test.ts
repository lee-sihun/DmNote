import { describe, expect, it } from 'vitest';
import { clampToViewport, POPUP_EDGE_PADDING } from './popupGeometry';

describe('팝업 경계 보정', () => {
  it('경계 안이면 그대로 둔다', () => {
    expect(clampToViewport(100, 200, 800)).toBe(100);
  });

  it('끝을 넘으면 안쪽으로 당긴다', () => {
    expect(clampToViewport(700, 200, 800)).toBe(800 - 200 - POPUP_EDGE_PADDING);
  });

  it('시작을 넘으면 최소 여백까지만 올린다', () => {
    expect(clampToViewport(-50, 200, 800)).toBe(POPUP_EDGE_PADDING);
  });

  // 팝업이 창보다 크면 두 경계가 뒤집힌다. 그때는 시작 쪽에 붙여야
  // 최소한 위쪽·왼쪽 내용이 화면에 남는다
  it('창보다 크면 시작 쪽에 붙인다', () => {
    expect(clampToViewport(100, 1000, 800)).toBe(POPUP_EDGE_PADDING);
    expect(clampToViewport(-500, 1000, 800)).toBe(POPUP_EDGE_PADDING);
  });

  it('여백은 표면마다 다를 수 있다', () => {
    // Dropdown은 8, 플러그인 드롭다운도 8을 쓴다
    expect(clampToViewport(700, 200, 800, 8)).toBe(800 - 200 - 8);
    expect(clampToViewport(-50, 200, 800, 8)).toBe(8);
  });

  it('경계에 딱 맞으면 움직이지 않는다', () => {
    const exact = 800 - 200 - POPUP_EDGE_PADDING;

    expect(clampToViewport(exact, 200, 800)).toBe(exact);
    expect(clampToViewport(POPUP_EDGE_PADDING, 200, 800)).toBe(
      POPUP_EDGE_PADDING,
    );
  });
});
