import type { GradientAnchorBounds } from '@stores/grid/useGradientEditStore';
import { borderBoxSize } from '@utils/dom/borderBoxSize';

// 마커 transform 행렬의 스케일 - 줌·팬 콘텐츠 루트는 회전이 없어 a·b로 충분
const markerScaleOf = (marker: HTMLElement): number | null => {
  const transform = getComputedStyle(marker).transform;
  if (!transform || transform === 'none') return 1;
  const matrix = new DOMMatrixReadOnly(transform);
  const scale = Math.hypot(matrix.a, matrix.b);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
};

/**
 * 요소의 그리드 좌표 박스 - data-dmn-grid-space 마커(줌·팬 변환 콘텐츠 루트)
 * 기준 rect 차이로 계산한다. transform 배치(키 translate 등)도 rect에는
 * 반영되므로 offset 체인과 달리 누락이 없다. 스케일은 마커 행렬에서 직접
 * 읽는다 - rect 폭 대비 offsetWidth로 구하면 정수 반올림 오차가 스케일에
 * 섞여 원점에서 먼 좌표를 크게 틀어놓는다 (작은 카운터일수록 심함)
 */
export const gridAnchorBoundsFor = (
  element: HTMLElement,
  rotation = 0,
): GradientAnchorBounds | null => {
  const marker = element.closest<HTMLElement>('[data-dmn-grid-space]');
  if (!marker) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scale = markerScaleOf(marker);
  if (scale === null) return null;
  const markerRect = marker.getBoundingClientRect();
  if (rotation !== 0) {
    const { width, height } = borderBoxSize(element, getComputedStyle(element));
    if (width <= 0 || height <= 0) return null;
    // AABB의 중심은 보존하고 치수는 회전 전 페인트 박스에서 읽는다
    return {
      x: (rect.left + rect.width / 2 - markerRect.left) / scale - width / 2,
      y: (rect.top + rect.height / 2 - markerRect.top) / scale - height / 2,
      width,
      height,
      rotation,
    };
  }
  return {
    x: (rect.left - markerRect.left) / scale,
    y: (rect.top - markerRect.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
};
