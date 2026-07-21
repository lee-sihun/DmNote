import { editGestureController } from './editGestureController';
import { finalizeEditorDraftForLifecycle } from './lifecycleEditorDraft';
import { beginEditorWriteBarrier } from './editorWriteBarrier';

const yieldToRender = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

export const flushFocusedEditorForLifecycle = async (): Promise<boolean> => {
  const drainBlurWrites = beginEditorWriteBarrier();
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.matches('input, textarea, [contenteditable="true"]')
  ) {
    active.blur();
  }

  const draftCommitted = finalizeEditorDraftForLifecycle();
  // OS 종료가 먼저 만든 focus 변경과 React 로컬 draft를 같은 turn에서 정산
  await yieldToRender();
  const [gestureCommitted, blurWritesCommitted] = await Promise.all([
    editGestureController.commitPendingAsync(),
    drainBlurWrites(),
  ]);
  return draftCommitted && gestureCommitted && blurWritesCommitted;
};
