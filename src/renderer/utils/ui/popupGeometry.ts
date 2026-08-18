/**
 * 떠 있는 UI(메뉴·드롭다운·피커)가 창 밖으로 나가지 않게 하는 공용 계산.
 *
 * 같은 식이 컴포넌트마다 손으로 복사돼 있었고, 그중 하나가 고장 나도
 * 나머지가 멀쩡해서 오래 안 잡혔다. 값 자체는 표면마다 달라도 되므로
 * 여백은 인자로 받는다
 */

/** 팝업이 창 가장자리로부터 남겨두는 기본 여백 */
export const POPUP_EDGE_PADDING = 5;

/**
 * 값을 `[padding, extent - size - padding]` 안으로 밀어넣는다.
 * 팝업이 창보다 크면 두 경계가 뒤집히는데, 그때는 시작 쪽(padding)에 붙인다
 */
export const clampToViewport = (
  value: number,
  size: number,
  extent: number,
  padding = POPUP_EDGE_PADDING,
) => Math.max(padding, Math.min(value, extent - size - padding));
