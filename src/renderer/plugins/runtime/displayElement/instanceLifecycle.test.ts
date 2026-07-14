import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPluginInstanceLifecycle,
  createPluginInstanceSaveBarrier,
} from './instanceLifecycle';

interface TestInstance {
  id: string;
  tabId?: string;
}

const cloneInstances = (instances: TestInstance[]) =>
  instances.map((instance) => ({ ...instance }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('plugin instance lifecycle', () => {
  it('복원 중 외부 변경만 완료 직후 1회 저장 대상으로 남긴다', () => {
    const barrier = createPluginInstanceSaveBarrier();

    barrier.runRestoreMutation(() => {
      expect(barrier.shouldSave()).toBe(false);
    });
    expect(barrier.finishRestoration()).toBe(false);

    const barrierWithExternalChange = createPluginInstanceSaveBarrier();
    expect(barrierWithExternalChange.shouldSave()).toBe(false);
    expect(barrierWithExternalChange.finishRestoration()).toBe(true);
    expect(barrierWithExternalChange.finishRestoration()).toBe(false);
    expect(barrierWithExternalChange.shouldSave()).toBe(true);
  });

  it('bootstrap 완료까지 복원을 대기한 뒤 죽은 탭을 정리해 저장한다', async () => {
    let bootstrapped = false;
    const bootstrapListeners = new Set<() => void>();
    let stored: TestInstance[] = [
      { id: 'legacy' },
      { id: 'dead', tabId: 'deleted-tab' },
    ];
    const restored: TestInstance[][] = [];
    const persisted: TestInstance[][] = [];
    const loadInstances = vi.fn(async () => cloneInstances(stored));

    const lifecycle = createPluginInstanceLifecycle<TestInstance>({
      isBootstrapped: () => bootstrapped,
      subscribeBootstrap: (listener) => {
        bootstrapListeners.add(listener);
        return () => bootstrapListeners.delete(listener);
      },
      loadInstances,
      persistInstances: async (instances) => {
        stored = cloneInstances(instances);
        persisted.push(cloneInstances(instances));
      },
      getMemoryInstances: () => [],
      releaseMemoryInstances: () => undefined,
    });

    const restorePromise = lifecycle.startRestore(
      () => new Set(['4key']),
      (instances) => restored.push(cloneInstances(instances)),
    );

    await Promise.resolve();
    expect(loadInstances).not.toHaveBeenCalled();
    expect(restored).toEqual([]);

    bootstrapped = true;
    bootstrapListeners.forEach((listener) => listener());
    await restorePromise;

    expect(lifecycle.getReadiness()).toBe('ready');
    expect(restored).toEqual([[{ id: 'legacy', tabId: '4key' }]]);
    expect(persisted).toEqual([[{ id: 'legacy', tabId: '4key' }]]);
    expect(stored).toEqual([{ id: 'legacy', tabId: '4key' }]);
    expect(bootstrapListeners.size).toBe(0);
  });

  it('복원 정리 저장 실패와 pending 외부 변경 flush를 분리한다', async () => {
    const cleanupError = new Error('injected cleanup persist failure');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const persisted: TestInstance[][] = [];
    const persistInstances = vi.fn(async (instances: TestInstance[]) => {
      persisted.push(cloneInstances(instances));
      if (persisted.length === 1) throw cleanupError;
    });
    const restored: TestInstance[][] = [];
    const barrier = createPluginInstanceSaveBarrier();
    const lifecycle = createPluginInstanceLifecycle<TestInstance>({
      isBootstrapped: () => true,
      subscribeBootstrap: () => () => undefined,
      loadInstances: async () => [
        { id: 'live', tabId: '4key' },
        { id: 'dead', tabId: 'deleted-tab' },
      ],
      persistInstances,
      getMemoryInstances: () => [],
      releaseMemoryInstances: () => undefined,
    });

    expect(barrier.shouldSave()).toBe(false);
    await expect(
      lifecycle.startRestore(
        () => new Set(['4key']),
        (instances) =>
          barrier.runRestoreMutation(() => {
            restored.push(cloneInstances(instances));
          }),
      ),
    ).resolves.toBe('ready');

    expect(restored).toEqual([[{ id: 'live', tabId: '4key' }]]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[Plugin] Failed to persist restored instance cleanup:',
      cleanupError,
    );
    expect(barrier.finishRestoration()).toBe(true);

    await lifecycle.saveInstances([{ id: 'external', tabId: '4key' }]);

    expect(persisted).toEqual([
      [{ id: 'live', tabId: '4key' }],
      [{ id: 'external', tabId: '4key' }],
    ]);
    expect(persistInstances).toHaveBeenCalledTimes(2);
  });

  it('bootstrap 타임아웃 시 필터 없이 모든 인스턴스를 복원한다', async () => {
    vi.useFakeTimers();
    const bootstrapListeners = new Set<() => void>();
    const stored: TestInstance[] = [
      { id: 'live', tabId: '4key' },
      { id: 'dead', tabId: 'deleted-tab' },
    ];
    const restored: TestInstance[][] = [];
    const persistInstances = vi.fn(async () => undefined);

    const lifecycle = createPluginInstanceLifecycle<TestInstance>({
      isBootstrapped: () => false,
      subscribeBootstrap: (listener) => {
        bootstrapListeners.add(listener);
        return () => bootstrapListeners.delete(listener);
      },
      loadInstances: async () => cloneInstances(stored),
      persistInstances,
      getMemoryInstances: () => [],
      releaseMemoryInstances: () => undefined,
    });

    const restorePromise = lifecycle.startRestore(
      () => new Set(['4key']),
      (instances) => restored.push(cloneInstances(instances)),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await restorePromise;

    expect(lifecycle.getReadiness()).toBe('failed');
    expect(restored).toEqual([stored]);
    expect(persistInstances).not.toHaveBeenCalled();
    expect(bootstrapListeners.size).toBe(0);
  });

  it('실행 중 탭 삭제를 메모리와 storage에서 멱등 정리한다', async () => {
    let memory = [
      { fullId: 'plugin::live', tabId: '4key' },
      { fullId: 'plugin::dead', tabId: 'deleted-tab' },
    ];
    let stored: TestInstance[] = [
      { id: 'live', tabId: '4key' },
      { id: 'dead', tabId: 'deleted-tab' },
    ];
    const releasedResources: string[] = [];
    const persistInstances = vi.fn(async (instances: TestInstance[]) => {
      stored = cloneInstances(instances);
    });

    const lifecycle = createPluginInstanceLifecycle<TestInstance>({
      isBootstrapped: () => true,
      subscribeBootstrap: () => () => undefined,
      loadInstances: async () => cloneInstances(stored),
      persistInstances,
      getMemoryInstances: () => memory,
      releaseMemoryInstances: (fullIds) => {
        releasedResources.push(...fullIds);
        const staleIds = new Set(fullIds);
        memory = memory.filter((instance) => !staleIds.has(instance.fullId));
      },
    });

    const validTabIds = new Set(['4key']);
    const firstReconcile = lifecycle.reconcile(validTabIds);
    expect(memory).toEqual([{ fullId: 'plugin::live', tabId: '4key' }]);
    expect(releasedResources).toEqual(['plugin::dead']);
    memory.push({ fullId: 'plugin::restored-dead', tabId: 'deleted-tab' });
    await firstReconcile;
    await lifecycle.reconcile(validTabIds);

    expect(memory).toEqual([{ fullId: 'plugin::live', tabId: '4key' }]);
    expect(stored).toEqual([{ id: 'live', tabId: '4key' }]);
    expect(releasedResources).toEqual([
      'plugin::dead',
      'plugin::restored-dead',
    ]);
    expect(persistInstances).toHaveBeenCalledTimes(1);
  });

  it('saveInstances storage 쓰기를 직렬 실행한다', async () => {
    const pendingWrites: Array<() => void> = [];
    const startedWrites: string[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;

    const lifecycle = createPluginInstanceLifecycle<TestInstance>({
      isBootstrapped: () => true,
      subscribeBootstrap: () => () => undefined,
      loadInstances: async () => [],
      persistInstances: async (instances) => {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        startedWrites.push(instances[0].id);
        await new Promise<void>((resolve) => pendingWrites.push(resolve));
        activeWrites -= 1;
      },
      getMemoryInstances: () => [],
      releaseMemoryInstances: () => undefined,
    });

    const firstWrite = lifecycle.saveInstances([{ id: 'first' }]);
    const secondWrite = lifecycle.saveInstances([{ id: 'second' }]);

    await vi.waitFor(() => expect(startedWrites).toEqual(['first']));
    pendingWrites.shift()?.();
    await firstWrite;
    await vi.waitFor(() => expect(startedWrites).toEqual(['first', 'second']));
    pendingWrites.shift()?.();
    await secondWrite;

    expect(maxActiveWrites).toBe(1);
  });

  it('dispose 후 큐에 남은 saveInstances 저장을 실행하지 않는다', async () => {
    const persistInstances = vi.fn(async () => undefined);
    const lifecycle = createPluginInstanceLifecycle<TestInstance>({
      isBootstrapped: () => true,
      subscribeBootstrap: () => () => undefined,
      loadInstances: async () => [],
      persistInstances,
      getMemoryInstances: () => [],
      releaseMemoryInstances: () => undefined,
    });

    const queuedSave = lifecycle.saveInstances([{ id: 'stale' }]);
    lifecycle.dispose();
    await queuedSave;

    expect(persistInstances).not.toHaveBeenCalled();
  });
});
