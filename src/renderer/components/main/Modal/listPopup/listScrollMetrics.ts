import { POPUP_EDGE_PADDING } from '@utils/ui/popupGeometry';

// 아이템 26 + 갭 4 리듬 공용 스크롤 계산 — 메인 메뉴·서브메뉴가 함께 사용
export const ITEM_HEIGHT = 26;
export const ITEM_GAP = 4;
// 묶음을 가르는 선은 항목이 아니라 1px 획이다 - 항목으로 세면 목록 길이를 과대평가해
// 들어갈 목록에 스크롤이 붙는다
export const SEPARATOR_HEIGHT = 1;
export const SCROLL_EDGE_PADDING = 6;
// 표면이 위아래로 두르는 패딩(p-[5px], 갭 4 + 링 1 보정) - 예산은 안쪽 div에 붙으므로 미리 뺀다
const SURFACE_PADDING = 5;

// 창보다 긴 목록은 잘리는 대신 스크롤한다. 팝업은 배치가 자유로우므로
// 앵커 주변 여유가 아니라 화면 높이 전체가 예산이다
export const getListScrollMetrics = (
  itemCount: number,
  viewportHeight: number,
  separatorCount = 0,
): { needsScroll: boolean; maxHeight: number | undefined } => {
  if (viewportHeight <= 0) return { needsScroll: false, maxHeight: undefined };

  const budget = Math.max(
    ITEM_HEIGHT,
    viewportHeight - POPUP_EDGE_PADDING * 2 - SURFACE_PADDING * 2,
  );
  const contentHeight =
    (itemCount - separatorCount) * (ITEM_HEIGHT + ITEM_GAP) +
    separatorCount * (SEPARATOR_HEIGHT + ITEM_GAP) +
    SCROLL_EDGE_PADDING;

  return contentHeight <= budget
    ? { needsScroll: false, maxHeight: undefined }
    : { needsScroll: true, maxHeight: budget };
};
