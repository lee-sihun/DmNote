import type { ElementBounds, SizeMatchGuide, SizeSnapResult } from './types';

// 크기 일치 스냅 임계값 (픽셀)
const SIZE_MATCH_THRESHOLD = 4;

/**
 * 크기 일치 스냅 계산 (리사이즈용)
 * 다른 요소와 동일한 width/height로 스냅
 * 여러 요소가 비슷한 크기일 경우, 가장 가까운 크기를 가진 요소에 스냅
 */
export function calculateSizeSnap(
  currentWidth: number,
  currentHeight: number,
  otherElements: ElementBounds[],
  draggedId: string = '',
): SizeSnapResult {
  const sizeMatchGuides: SizeMatchGuide[] = [];
  let snappedWidth = currentWidth;
  let snappedHeight = currentHeight;
  let didSnapWidth = false;
  let didSnapHeight = false;

  const others = otherElements.filter((el) => el.id !== draggedId);

  // 가장 가까운 매치를 추적하기 위한 변수
  let closestWidthDiff = Infinity;
  let closestHeightDiff = Infinity;
  let closestWidthMatch: ElementBounds | null = null;
  let closestHeightMatch: ElementBounds | null = null;

  // 첫 번째 패스: 임계값 내에서 가장 가까운 크기를 찾음
  for (const other of others) {
    // width 일치 체크 - 가장 가까운 것 선택
    const widthDiff = Math.abs(currentWidth - other.width);
    if (widthDiff <= SIZE_MATCH_THRESHOLD && widthDiff < closestWidthDiff) {
      closestWidthDiff = widthDiff;
      closestWidthMatch = other;
    }

    // height 일치 체크 - 가장 가까운 것 선택
    const heightDiff = Math.abs(currentHeight - other.height);
    if (heightDiff <= SIZE_MATCH_THRESHOLD && heightDiff < closestHeightDiff) {
      closestHeightDiff = heightDiff;
      closestHeightMatch = other;
    }
  }

  // 두 번째 패스: 가장 가까운 매치에 대한 스냅 적용
  if (closestWidthMatch) {
    snappedWidth = closestWidthMatch.width;
    didSnapWidth = true;
    sizeMatchGuides.push({
      type: 'size-match',
      dimension: 'width',
      value: closestWidthMatch.width,
      position: { x: closestWidthMatch.centerX, y: closestWidthMatch.top - 15 },
      matchedElementId: closestWidthMatch.id,
      matchedElementBounds: {
        left: closestWidthMatch.left,
        top: closestWidthMatch.top,
        width: closestWidthMatch.width,
        height: closestWidthMatch.height,
      },
    });
  }

  if (closestHeightMatch) {
    snappedHeight = closestHeightMatch.height;
    didSnapHeight = true;
    sizeMatchGuides.push({
      type: 'size-match',
      dimension: 'height',
      value: closestHeightMatch.height,
      position: {
        x: closestHeightMatch.right + 15,
        y: closestHeightMatch.centerY,
      },
      matchedElementId: closestHeightMatch.id,
      matchedElementBounds: {
        left: closestHeightMatch.left,
        top: closestHeightMatch.top,
        width: closestHeightMatch.width,
        height: closestHeightMatch.height,
      },
    });
  }

  return {
    snappedWidth,
    snappedHeight,
    sizeMatchGuides,
    didSnapWidth,
    didSnapHeight,
  };
}
