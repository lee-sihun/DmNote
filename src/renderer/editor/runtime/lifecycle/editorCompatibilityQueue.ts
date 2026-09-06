import { trackEditorWrite } from './editorWriteBarrier';

let compatibilityWriteQueue: Promise<void> = Promise.resolve();

// 큐 합류와 write barrier 추적을 수행하며, 실패는 원 오류 그대로
// 전파되고 큐는 계속 진행된다
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

// 쓰기 완료 후 result()로 반환값을 사상하는 variant
export const enqueueEditorCompatibilityWrite = <T>(
  write: () => Promise<unknown>,
  result: () => T,
): Promise<T> =>
  enqueueEditorCompatibilityOperation(() => write().then(result));
