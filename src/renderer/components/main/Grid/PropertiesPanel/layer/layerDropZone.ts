/**
 * 레이어 행 드롭 존 판정 - 순수 함수
 * 그룹 헤더 행은 상/중/하 3분할, 일반 행은 상/하 2분할
 */

export type LayerDropRowKind = 'layer' | 'group-header';

export type LayerDropZone = 'before' | 'into' | 'after';

// 헤더 행 가장자리 비율 - 34px 행 기준 위아래 8.5px 삽입, 가운데 17px 그룹 진입
export const HEADER_EDGE_RATIO = 0.25;

export const resolveLayerDropZone = (
  rowKind: LayerDropRowKind,
  rowHeight: number,
  offsetInRow: number,
): LayerDropZone => {
  if (rowKind === 'group-header') {
    const edge = rowHeight * HEADER_EDGE_RATIO;
    if (offsetInRow < edge) return 'before';
    if (offsetInRow < rowHeight - edge) return 'into';
    return 'after';
  }
  return offsetInRow < rowHeight / 2 ? 'before' : 'after';
};
