/**
 * key/stat/graph/plugin 공통 캔버스 아이템 연산
 * Store/React 의존 없음
 */

/** 캔버스 아이템 공통 인터페이스 */
export interface CanvasItem {
  type: 'key' | 'stat' | 'graph' | 'plugin';
  id: string;
  index?: number;
  zIndex: number;
  hidden: boolean;
  groupId?: string;
}

/** 가시성 토글 후 새 배열 반환 */
export function toggleItemVisibility<T extends { hidden?: boolean }>(
  items: T[],
  index: number,
): T[] {
  return items.map((item, i) =>
    i === index ? { ...item, hidden: !item.hidden } : item,
  );
}

/** zIndex 기준 정렬 순서 재정렬 (0부터 연속 번호 부여) */
export function reindexZOrder<T extends { zIndex?: number }>(
  items: T[],
): T[] {
  const indexed = items
    .map((item, i) => ({ item, originalIndex: i, z: item.zIndex ?? i }))
    .sort((a, b) => a.z - b.z);

  const result = [...items];
  indexed.forEach(({ originalIndex }, newOrder) => {
    result[originalIndex] = { ...result[originalIndex], zIndex: newOrder };
  });

  return result;
}
