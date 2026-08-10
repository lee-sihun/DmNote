import { beginEditorWriteBarrier } from './editorWriteBarrier';
import { finalizeEditorDraftForLifecycle } from './lifecycleEditorDraft';

const yieldToRender = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// 포커스된 입력을 지금 대상에 확정한다.
//
// 순서가 계약이다. gesture 커밋을 첫 await 뒤로 미루면, 양보하는 동안 도착한
// 원격 선택이 선택 구독자를 깨워 아직 시작도 안 한 gesture를 취소한다.
// commitPendingAsync는 호출 즉시 동기로 active를 잡고 현재 mode·index로 patch를
// 만든 뒤에야 persist를 await하므로, 양보 전에 시작해야 그 구간이 닫힌다.
//
// gesture controller를 직접 부르지 않고 콜백으로 받는다. controller가 이 파일을
// 참조할 수 있어야 하는데 반대 방향까지 열면 순환이 된다
export const settleFocusedEditor = async (
  startGestureCommit: () => Promise<boolean>,
): Promise<boolean> => {
  const drainBlurWrites = beginEditorWriteBarrier();

  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.matches('input, textarea, [contenteditable="true"]')
  ) {
    active.blur();
  }

  const draftCommitted = finalizeEditorDraftForLifecycle();
  const gestureCommit = startGestureCommit();

  // blur가 만든 React state 갱신과 IME 정산을 한 turn 기다린다
  await yieldToRender();

  const [gestureCommitted, blurWritesCommitted] = await Promise.all([
    gestureCommit,
    drainBlurWrites(),
  ]);

  return draftCommitted && gestureCommitted && blurWritesCommitted;
};
