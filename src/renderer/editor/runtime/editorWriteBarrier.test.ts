import { describe, expect, it } from 'vitest';

import { enqueueEditorCompatibilityWrite } from './editorCompatibilityQueue';
import {
  beginEditorWriteBarrier,
  drainEditorWrites,
  trackEditorWrite,
} from './editorWriteBarrier';

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('editor write barrier', () => {
  it('진행 중인 editor write가 끝날 때까지 drain을 대기한다', async () => {
    const write = deferred<void>();
    trackEditorWrite(write.promise);
    let drained = false;
    const draining = drainEditorWrites().then((result) => {
      drained = true;
      return result;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    write.resolve();

    await expect(draining).resolves.toBe(true);
  });

  it('대기 중 새로 등록된 write까지 모두 drain한다', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    trackEditorWrite(first.promise);
    const draining = drainEditorWrites();
    trackEditorWrite(second.promise);

    first.resolve();
    await Promise.resolve();
    let drained = false;
    void draining.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    second.resolve();
    await expect(draining).resolves.toBe(true);
  });

  it('editor write 실패를 전환 중단 신호로 반환한다', async () => {
    const write = deferred<void>();
    trackEditorWrite(write.promise);
    const draining = drainEditorWrites();

    write.reject(new Error('write failed'));

    await expect(draining).resolves.toBe(false);
  });

  it('compatibility queue의 write를 자동 등록한다', async () => {
    const write = deferred<void>();
    const operation = enqueueEditorCompatibilityWrite(
      () => write.promise,
      () => 'saved',
    );
    const draining = drainEditorWrites();
    let drained = false;
    void draining.then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    write.resolve();

    await expect(operation).resolves.toBe('saved');
    await expect(draining).resolves.toBe(true);
  });

  it('barrier 시작 뒤 빠르게 실패한 blur write도 drain에서 놓치지 않는다', async () => {
    const drainBlurWrites = beginEditorWriteBarrier();
    trackEditorWrite(Promise.reject(new Error('blur write failed')));
    await Promise.resolve();

    await expect(drainBlurWrites()).resolves.toBe(false);
  });
});
