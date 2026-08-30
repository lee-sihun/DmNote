import type { ElementBounds, GuideLine } from './types';

/**
 * 요소의 bounds 정보 계산
 */
export function calculateBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  id: string = '',
): ElementBounds {
  return {
    id,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    centerX: x + width / 2,
    centerY: y + height / 2,
    width,
    height,
  };
}

/**
 * 여러 요소들의 전체 바운딩 박스 계산 (그룹 선택용)
 * @param elements 요소들의 bounds 배열
 * @returns 전체 요소를 감싸는 바운딩 박스
 */
export function calculateGroupBounds(
  elements: ElementBounds[],
): ElementBounds | null {
  if (elements.length === 0) return null;

  if (elements.length === 1) return elements[0];

  const left = Math.min(...elements.map((el) => el.left));
  const top = Math.min(...elements.map((el) => el.top));
  const right = Math.max(...elements.map((el) => el.right));
  const bottom = Math.max(...elements.map((el) => el.bottom));
  const width = right - left;
  const height = bottom - top;

  return {
    id: 'group',
    left,
    top,
    right,
    bottom,
    centerX: left + width / 2,
    centerY: top + height / 2,
    width,
    height,
  };
}

// 캔버스 중앙 좌표 (그리드 렌더링 영역 900x396 기준)
export const CANVAS_CENTER_X = 450;
export const CANVAS_CENTER_Y = 195;

/**
 * 가이드라인의 시작/끝 위치 계산 (시각화용)
 */
export function calculateGuideLineExtent(
  guide: GuideLine,
  draggedBounds: ElementBounds,
  otherElements: ElementBounds[],
): { start: number; end: number } {
  // 캔버스 중앙 가이드라인인지 확인
  const isCanvasCenterGuide =
    (guide.type === 'vertical' &&
      Math.abs(guide.position - CANVAS_CENTER_X) < 1) ||
    (guide.type === 'horizontal' &&
      Math.abs(guide.position - CANVAS_CENTER_Y) < 1);

  const relevantElements = otherElements.filter((el) => {
    if (el.id === draggedBounds.id) return false;

    if (guide.type === 'vertical') {
      // 수직 가이드라인: x 위치가 일치하는 요소
      return (
        Math.abs(el.left - guide.position) < 1 ||
        Math.abs(el.right - guide.position) < 1 ||
        Math.abs(el.centerX - guide.position) < 1
      );
    } else {
      // 수평 가이드라인: y 위치가 일치하는 요소
      return (
        Math.abs(el.top - guide.position) < 1 ||
        Math.abs(el.bottom - guide.position) < 1 ||
        Math.abs(el.centerY - guide.position) < 1
      );
    }
  });

  // 드래그 중인 요소도 포함
  relevantElements.push(draggedBounds);

  // 캔버스 중앙 가이드라인의 경우 더 긴 범위 표시
  const CANVAS_CENTER_GUIDE_EXTENSION = 500;

  if (guide.type === 'vertical') {
    const tops = relevantElements.map((el) => el.top);
    const bottoms = relevantElements.map((el) => el.bottom);
    const extension = isCanvasCenterGuide ? CANVAS_CENTER_GUIDE_EXTENSION : 20;
    return {
      start: Math.min(...tops) - extension,
      end: Math.max(...bottoms) + extension,
    };
  } else {
    const lefts = relevantElements.map((el) => el.left);
    const rights = relevantElements.map((el) => el.right);
    const extension = isCanvasCenterGuide ? CANVAS_CENTER_GUIDE_EXTENSION : 20;
    return {
      start: Math.min(...lefts) - extension,
      end: Math.max(...rights) + extension,
    };
  }
}
