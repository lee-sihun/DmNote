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
