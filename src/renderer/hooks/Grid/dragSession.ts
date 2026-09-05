// 그리드 전역 드래그 세션 소유권 — 훅 인스턴스·종류를 넘어 동시 1세션만 허용.
// 터치 입력에서 두 포인터가 서로 다른 요소를 잡아 같은 선택 집합을
// 이중으로 끌고 히스토리를 중복 저장하는 것을 차단한다
import { isHistoryEditorFlushLocked } from '@src/renderer/editor/runtime/historyEditorFlushLock';

let activeDragSession = false;

export const tryAcquireDragSession = (): boolean => {
  if (activeDragSession || isHistoryEditorFlushLocked()) return false;
  activeDragSession = true;
  return true;
};

export const releaseDragSession = (): void => {
  activeDragSession = false;
};
