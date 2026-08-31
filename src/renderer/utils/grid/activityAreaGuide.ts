// 스프라이트 활동 영역 가이드의 시각 규격. 캔버스 아이템과 복제 고스트가 공유한다.
// 에디터 전용 크롬이라 줌과 무관하게 화면 px로 고정한다 (스마트 가이드와 같은 정책) -
// 줌 컨테이너 안에서 그려지므로 굵기·반지름을 배율의 역수로 보정한다

export const ACTIVITY_AREA_GUIDE_COLOR = 'var(--ui-guide-activity)';

const GUIDE_BORDER_WIDTH = 1;
const GUIDE_BORDER_RADIUS = 4;

/** 줌 배율에서 화면 크기가 고정되는 보정 계수 */
export const editorChromeScale = (zoom: number): number =>
  Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1;

export const activityAreaGuideMetrics = (
  zoom: number,
): { borderWidth: string; borderRadius: string } => {
  const scale = editorChromeScale(zoom);
  return {
    borderWidth: `${GUIDE_BORDER_WIDTH * scale}px`,
    borderRadius: `${GUIDE_BORDER_RADIUS * scale}px`,
  };
};
