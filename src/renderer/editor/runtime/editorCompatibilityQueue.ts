import { trackEditorWrite } from './editorWriteBarrier';

let compatibilityWriteQueue: Promise<void> = Promise.resolve();

export const enqueueEditorCompatibilityWrite = <T>(
  write: () => Promise<unknown>,
  result: () => T,
): Promise<T> => {
  const operation = compatibilityWriteQueue.then(write);
  compatibilityWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return trackEditorWrite(operation.then(result));
};

// 작업의 실제 반환값을 보존하는 variant. 큐 합류와 write barrier 추적은
// 동일하고, 실패는 원 오류 그대로 전파되며 큐는 계속 진행된다
export const enqueueEditorCompatibilityOperation = <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  const run = compatibilityWriteQueue.then(operation);
  compatibilityWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return trackEditorWrite(run);
};
