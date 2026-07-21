import { afterEach, describe, expect, it, vi } from 'vitest';

import { drainEditorWrites } from '@src/renderer/editor/runtime/editorWriteBarrier';
import {
  clearPluginInstancesEditSessions,
  createPluginInstancesSaveDebounce,
  enqueuePluginInstancesCommit,
  getPendingPluginInstancesCommitCount,
  touchPluginInstancesEditSession,
} from './instancesCommitQueue';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe('plugin instances commit queue lifecycle', () => {
  afterEach(() => {
    clearPluginInstancesEditSessions();
    vi.useRealTimers();
  });

  it('같은 플러그인의 연속 저장은 창 경계에서도 한 편집 세션을 사용한다', async () => {
    vi.useFakeTimers();

    const first = touchPluginInstancesEditSession('plugin-a');
    expect(touchPluginInstancesEditSession('plugin-a')).toBe(first);
    expect(touchPluginInstancesEditSession('plugin-b')).not.toBe(first);

    await vi.advanceTimersByTimeAsync(1199);
    expect(touchPluginInstancesEditSession('plugin-a')).toBe(first);

    await vi.advanceTimersByTimeAsync(1201);
    expect(touchPluginInstancesEditSession('plugin-a')).not.toBe(first);
  });

  it('패널 저장 뒤 170ms에 시작한 drain은 파생 저장을 같은 세션으로 완료한다', async () => {
    vi.useFakeTimers();
    const routedGesture = touchPluginInstancesEditSession('plugin-a');
    let derivedGesture: string | null = null;
    const debounce = createPluginInstancesSaveDebounce({
      delayMs: 200,
      save: vi.fn(async () => {
        derivedGesture = touchPluginInstancesEditSession('plugin-a');
      }),
      onError: vi.fn(),
    });

    debounce.schedule();
    await vi.advanceTimersByTimeAsync(170);
    const draining = drainEditorWrites();
    await vi.advanceTimersByTimeAsync(30);
    await expect(draining).resolves.toBe(true);

    expect(derivedGesture).toBe(routedGesture);
  });

  it('최신 tail이 끝난 뒤 pluginId 항목을 제거한다', async () => {
    const first = deferred();
    const second = deferred();
    const firstRun = enqueuePluginInstancesCommit('plugin-a', () =>
      first.promise.then(() => 'first'),
    );
    const secondRun = enqueuePluginInstancesCommit('plugin-a', () =>
      second.promise.then(() => 'second'),
    );

    expect(getPendingPluginInstancesCommitCount()).toBe(1);
    first.resolve();
    await expect(firstRun).resolves.toBe('first');
    expect(getPendingPluginInstancesCommitCount()).toBe(1);

    second.resolve();
    await expect(secondRun).resolves.toBe('second');
    await Promise.resolve();
    expect(getPendingPluginInstancesCommitCount()).toBe(0);
  });

  it('실패한 마지막 tail도 제거한다', async () => {
    await expect(
      enqueuePluginInstancesCommit('plugin-fail', () =>
        Promise.reject(new Error('commit failed')),
      ),
    ).rejects.toThrow('commit failed');
    await Promise.resolve();

    expect(getPendingPluginInstancesCommitCount()).toBe(0);
  });

  it('debounce 전 drain이 실제 저장 완료까지 기다린다', async () => {
    vi.useFakeTimers();
    const write = deferred();
    const save = vi.fn(() => write.promise);
    const debounce = createPluginInstancesSaveDebounce({
      delayMs: 200,
      save,
      onError: vi.fn(),
    });

    debounce.schedule();
    let drained = false;
    const draining = drainEditorWrites().then((result) => {
      drained = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(save).not.toHaveBeenCalled();
    expect(drained).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledOnce();
    expect(drained).toBe(false);

    write.resolve();
    await expect(draining).resolves.toBe(true);
  });

  it('재예약과 취소가 이전 drain을 남기지 않는다', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const debounce = createPluginInstancesSaveDebounce({
      delayMs: 200,
      save,
      onError: vi.fn(),
    });

    debounce.schedule();
    await vi.advanceTimersByTimeAsync(100);
    debounce.schedule();
    await vi.advanceTimersByTimeAsync(199);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(drainEditorWrites()).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();

    debounce.schedule();
    debounce.cancel();
    await expect(drainEditorWrites()).resolves.toBe(true);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledOnce();
  });

  it('debounce 저장 실패를 drain 실패로 전파한다', async () => {
    vi.useFakeTimers();
    const error = new Error('save failed');
    const onError = vi.fn();
    const debounce = createPluginInstancesSaveDebounce({
      delayMs: 200,
      save: vi.fn().mockRejectedValue(error),
      onError,
    });

    debounce.schedule();
    const draining = drainEditorWrites();
    await vi.advanceTimersByTimeAsync(200);

    await expect(draining).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
