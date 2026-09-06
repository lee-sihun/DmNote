import type { Point } from '@utils/element/rotation';

export const ROTATE_CORNER_OUTER_REACH = 26;
export const ROTATE_CORNER_INNER_REACH = 14;

// 화면 좌표를 받아 줌과 무관하게 크기 조절 영역 바깥에 배치
export const rotateCornerGeometry = (corners: readonly Point[]) => {
  const topX = corners[1].x - corners[0].x;
  const topY = corners[1].y - corners[0].y;
  const angle =
    Math.hypot(topX, topY) > 1e-6
      ? Math.atan2(topY, topX)
      : Math.atan2(corners[3].y - corners[0].y, corners[3].x - corners[0].x) -
        Math.PI / 2;
  return corners.map((corner, index) => ({
    x: corner.x,
    y: corner.y,
    rotation: (angle * 180) / Math.PI + index * 90,
  }));
};
