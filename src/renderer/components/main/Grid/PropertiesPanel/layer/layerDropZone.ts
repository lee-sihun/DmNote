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

// 표식 판정에 필요한 행 정보만 - DisplayItem의 부분 집합
export type LayerDropRow =
  | { displayType: 'group-header' }
  | { displayType: 'layer'; item: { id: string; groupId?: string | null } };

/**
 * 삽입 드롭이 아무것도 바꾸지 않는 자리인지 판정 - 무변경이면 표식을 생략한다
 * 끌던 행들이 헤더나 다른 행 없이 이어져 있고, 슬롯이 그 블록의 안쪽·양끝이며,
 * 목표 소속이 끌던 행들의 소속과 같을 때만 무변경이다. 자기 행 위에 놓아도
 * 소속이 바뀌면(그룹 바로 아래 행을 마지막 멤버 하단으로) 실제 이동이다
 */
export const isNoopLayerDrop = (
  display: readonly LayerDropRow[],
  draggingIds: ReadonlySet<string>,
  slotDisplayIndex: number,
  targetGroupId: string | null | undefined,
): boolean => {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 0; i < display.length; i++) {
    const row = display[i];
    if (row.displayType !== 'layer' || !draggingIds.has(row.item.id)) continue;
    if ((row.item.groupId ?? null) !== (targetGroupId ?? null)) return false;
    if (first === -1) first = i;
    last = i;
    count += 1;
  }
  if (count === 0) return false;
  const contiguous = last - first + 1 === count;
  return (
    contiguous && slotDisplayIndex >= first && slotDisplayIndex <= last + 1
  );
};
