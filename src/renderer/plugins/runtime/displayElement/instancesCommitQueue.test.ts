import { afterEach, describe, expect, it, vi } from 'vitest';

import { drainEditorWrites } from '@src/renderer/editor/runtime/editorWriteBarrier';
import {
  beginPluginInstancesEditSession,
  clearPluginInstancesEditSessions,
  createPluginInstancesSaveDebounce,
  endPluginInstancesEditSession,
  enqueuePluginInstancesCommit,
  getPendingPluginInstancesCommitCount,
  registerPluginInstancesEditSessionFlush,
  rotatePluginInstancesEditSession,
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
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
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

  it('서로 다른 드래그는 다른 gestureId, 한 드래그의 여러 저장은 같은 gestureId를 사용한다', async () => {
    vi.useFakeTimers();
    const committedGestureIds: Array<string | undefined> = [];
    const debounce = createPluginInstancesSaveDebounce({
      delayMs: 200,
      save: vi.fn(async ({ gestureId }) => {
        committedGestureIds.push(gestureId);
      }),
      onError: vi.fn(),
    });
    cleanups.push(
      registerPluginInstancesEditSessionFlush('plugin-drag', () => {
        debounce.flush();
      }),
    );

    const firstDrag = rotatePluginInstancesEditSession('plugin-drag');
    debounce.schedule(touchPluginInstancesEditSession('plugin-drag'));
    await vi.advanceTimersByTimeAsync(200);
    debounce.schedule(touchPluginInstancesEditSession('plugin-drag'));
    await vi.advanceTimersByTimeAsync(200);

    const secondDrag = rotatePluginInstancesEditSession('plugin-drag');
    debounce.schedule(touchPluginInstancesEditSession('plugin-drag'));
    await vi.advanceTimersByTimeAsync(200);

    expect(secondDrag).not.toBe(firstDrag);
    expect(committedGestureIds).toEqual([firstDrag, firstDrag, secondDrag]);
  });

  it('active gesture는 TTL보다 오래 멈춰도 같은 gestureId를 유지한다', async () => {
    vi.useFakeTimers();

    const token = beginPluginInstancesEditSession('plugin-long-drag');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(touchPluginInstancesEditSession('plugin-long-drag')).toBe(token);

    endPluginInstancesEditSession('plugin-long-drag', token);
    expect(touchPluginInstancesEditSession('plugin-long-drag')).not.toBe(token);
  });

  it('명시적으로 끝난 두 resize는 TTL 안에서도 서로 다른 gestureId를 쓴다', () => {
    const first = beginPluginInstancesEditSession('plugin-resize');
    endPluginInstancesEditSession('plugin-resize', first);
    const second = beginPluginInstancesEditSession('plugin-resize');
    endPluginInstancesEditSession('plugin-resize', second);

    expect(second).not.toBe(first);
  });

  it('하나의 복합 동작은 여러 plugin session에 같은 gestureId를 주입한다', () => {
    const sharedGestureId = '00000000-0000-4000-8000-0000000000f4';
    const first = beginPluginInstancesEditSession('plugin-a', sharedGestureId);
    const second = beginPluginInstancesEditSession('plugin-b', sharedGestureId);
    const flush = vi.fn();
    cleanups.push(registerPluginInstancesEditSessionFlush('plugin-a', flush));

    expect(first).toBe(sharedGestureId);
    expect(second).toBe(sharedGestureId);
    expect(rotatePluginInstancesEditSession('plugin-a', sharedGestureId)).toBe(
      sharedGestureId,
    );
    expect(flush).not.toHaveBeenCalled();
  });

  it('명시적 end는 최종 pending 저장을 같은 gestureId로 flush한다', async () => {
    const committedGestureIds: Array<string | undefined> = [];
    const debounce = createPluginInstancesSaveDebounce({
      delayMs: 200,
      save: vi.fn(async ({ gestureId }) => {
        committedGestureIds.push(gestureId);
      }),
      onError: vi.fn(),
    });
    cleanups.push(
      registerPluginInstancesEditSessionFlush('plugin-end-flush', () => {
        debounce.flush();
      }),
    );

    const token = beginPluginInstancesEditSession('plugin-end-flush');
    debounce.schedule(touchPluginInstancesEditSession('plugin-end-flush'));
    endPluginInstancesEditSession('plugin-end-flush', token);
    await Promise.resolve();

    expect(committedGestureIds).toEqual([token]);
    expect(touchPluginInstancesEditSession('plugin-end-flush')).not.toBe(token);
  });

  it('stale end는 현재 active gesture를 종료하지 않는다', async () => {
    vi.useFakeTimers();

    const stale = beginPluginInstancesEditSession('plugin-stale');
    const current = beginPluginInstancesEditSession('plugin-stale');
    endPluginInstancesEditSession('plugin-stale', stale);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(touchPluginInstancesEditSession('plugin-stale')).toBe(current);

    endPluginInstancesEditSession('plugin-stale', current);
    await vi.advanceTimersByTimeAsync(1_201);
    expect(touchPluginInstancesEditSession('plugin-stale')).not.toBe(current);
  });

  it('rotate 시 pending debounce를 이전 gestureId와 경계 직전 상태로 flush한다', async () => {
    vi.useFakeTimers();
    let snapshot = 'before';
    const commits: Array<{
      gestureId?: string;
      snapshot: string;
      captureCurrentSnapshot: boolean;
    }> = [];
    const debounce = createPluginInstancesSaveDebounce({
      delayMs: 200,
      save: vi.fn(async ({ gestureId, captureCurrentSnapshot }) => {
        commits.push({ gestureId, snapshot, captureCurrentSnapshot });
      }),
      onError: vi.fn(),
    });
    cleanups.push(
      registerPluginInstancesEditSessionFlush('plugin-pending', () => {
        debounce.flush();
      }),
    );

    const firstDrag = rotatePluginInstancesEditSession('plugin-pending');
    snapshot = 'drag-a';
    debounce.schedule(touchPluginInstancesEditSession('plugin-pending'));

    const secondDrag = rotatePluginInstancesEditSession('plugin-pending');
    snapshot = 'drag-b';
    debounce.schedule(touchPluginInstancesEditSession('plugin-pending'));
    await vi.advanceTimersByTimeAsync(200);

    expect(commits).toEqual([
      {
        gestureId: firstDrag,
        snapshot: 'drag-a',
        captureCurrentSnapshot: true,
      },
      {
        gestureId: secondDrag,
        snapshot: 'drag-b',
        captureCurrentSnapshot: false,
      },
    ]);
  });

  it('추가, 삭제, 붙여넣기 경계는 직전 세션과 각각 분리된다', () => {
    const previous = touchPluginInstancesEditSession('plugin-discrete');
    const addGesture = rotatePluginInstancesEditSession('plugin-discrete');
    const deleteGesture = rotatePluginInstancesEditSession('plugin-discrete');
    const pasteGesture = rotatePluginInstancesEditSession('plugin-discrete');

    expect(
      new Set([previous, addGesture, deleteGesture, pasteGesture]).size,
    ).toBe(4);
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
