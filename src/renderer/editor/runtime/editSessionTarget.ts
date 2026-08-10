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

// 비동기 완료 콜백만 쓰는 좁은 지문.
//
// 완료 콜백은 시작 시점 클로저의 index를 들고 돌아온다. 단순 선택 변경만 있었다면
// 그 index가 편집을 시작한 그 요소를 그대로 가리키므로 적용하는 것이 맞다.
// 모드가 갈리면 다르다 - 키 저장기가 실행 시점 모드를 다시 읽어(useKeyManager.ts:544)
// 옛 index를 새 모드의 엉뚱한 요소에 얹는다. 배열 교체 없이도 오염된다.
//
// 같은 모드 안에서 배열이 재정렬되면 이 지문으로는 못 잡는다. canonical 리비전을
// 비교하면 무관한 속성 변경에도 정상 연결을 버리므로 넣지 않았다
export const getEditSessionMode = (): string =>
  useKeyStore.getState().selectedKeyType;

export const getEditSessionTarget = (): string =>
  formatEditSessionTarget(
    useKeyStore.getState().selectedKeyType,
    useGridSelectionStore.getState().selectedElements,
  );
