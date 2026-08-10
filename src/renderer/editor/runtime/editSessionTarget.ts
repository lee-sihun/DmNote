import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

// 편집 세션이 붙어 있는 대상의 지문.
//
// 입력은 포커스 시점의 되돌릴 값만 기억하고 어느 대상인지는 기억하지 않는다.
// 포커스가 유지된 채 대상이 갈리면 옛 값이 새 대상에 실리므로, 세션을 끊을지
// 판단하는 기준이 필요하다.
//
// 값이 아니라 대상 id로 판정한다. 값 비교는 호출부의 정상적인 정규화
// (그래프 speed의 100 단위 스냅, 오프셋의 0 -> undefined)를 대상 전환으로 오인한다.
//
// 반드시 zustand 파생값으로만 만든다. useState나 transition으로 만들면
// 갱신이 sync lane을 벗어나 언마운트 cleanup이 예약 작업보다 늦어질 수 있다
export const formatEditSessionTarget = (
  mode: string,
  selectedElements: readonly SelectedElement[],
): string =>
  `${mode}:${selectedElements
    .map((element) => element.id)
    .sort()
    .join(',')}`;

export const getEditSessionTarget = (): string =>
  formatEditSessionTarget(
    useKeyStore.getState().selectedKeyType,
    useGridSelectionStore.getState().selectedElements,
  );
