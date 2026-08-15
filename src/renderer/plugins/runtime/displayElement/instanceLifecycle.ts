export type PluginRestoreReadiness = 'pending' | 'ready' | 'failed';

export interface PersistedPluginInstance {
  tabId?: string;
}

interface RuntimePluginInstance {
  fullId: string;
  tabId?: string;
}

interface PluginInstanceLifecycleDependencies<
  Instance extends PersistedPluginInstance,
> {
  isBootstrapped: () => boolean;
  subscribeBootstrap: (listener: () => void) => () => void;
  loadInstances: () => Promise<Instance[] | null>;
  persistInstances: (instances: Instance[]) => Promise<void>;
  /** 탭 정리 persist - 큐 실행 시점에 유효 탭과 canonical을 모두 재파생 */
  reconcilePersist: () => Promise<void>;
  getMemoryInstances: () => RuntimePluginInstance[];
  releaseMemoryInstances: (fullIds: readonly string[]) => void;
  timeoutMs?: number;
}

const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 10_000;

export const normalizePluginInstanceTabId = (tabId?: string) => tabId || '4key';

export const createPluginInstanceSaveBarrier = (
  onPendingExternalChange: () => void = () => undefined,
) => {
  let isRestoring = true;
  let restoreFailed = false;
  let isApplyingRestore = false;
  let hasPendingExternalChanges = false;

  const shouldSave = () => {
    if (restoreFailed) return false;
    if (!isRestoring) return true;
    if (!isApplyingRestore && !hasPendingExternalChanges) {
      hasPendingExternalChanges = true;
      onPendingExternalChange();
    }
    return false;
  };

  const runRestoreMutation = <Result>(mutation: () => Result): Result => {
    const wasApplyingRestore = isApplyingRestore;
    isApplyingRestore = true;
    try {
      return mutation();
    } finally {
      isApplyingRestore = wasApplyingRestore;
    }
  };

  const finishRestoration = () => {
    isRestoring = false;
    const shouldFlush = hasPendingExternalChanges;
    hasPendingExternalChanges = false;
    return shouldFlush;
  };

  const cancelRestoration = () => {
    isRestoring = false;
    const shouldFlush = hasPendingExternalChanges;
    hasPendingExternalChanges = false;
    return shouldFlush;
  };

  const failRestoration = () => {
    isRestoring = false;
    restoreFailed = true;
    hasPendingExternalChanges = false;
  };

  return {
    cancelRestoration,
    failRestoration,
    finishRestoration,
    isRestoring: () => isRestoring,
    runRestoreMutation,
    shouldSave,
  };
};

const normalizeInstances = <Instance extends PersistedPluginInstance>(
  instances: readonly Instance[],
): Instance[] =>
  instances.map((instance) => ({
    ...instance,
    tabId: normalizePluginInstanceTabId(instance.tabId),
  }));

export const createPluginInstanceLifecycle = <
  Instance extends PersistedPluginInstance,
>(
  dependencies: PluginInstanceLifecycleDependencies<Instance>,
) => {
  const {
    isBootstrapped,
    subscribeBootstrap,
    loadInstances,
    persistInstances,
    reconcilePersist,
    getMemoryInstances,
    releaseMemoryInstances,
    timeoutMs = DEFAULT_BOOTSTRAP_TIMEOUT_MS,
  } = dependencies;

  let readiness: PluginRestoreReadiness = 'pending';
  let disposed = false;
  let bootstrapUnsubscribe: (() => void) | null = null;
  let bootstrapTimeout: ReturnType<typeof setTimeout> | null = null;
  let storageTail: Promise<void> = Promise.resolve();
  let restorePromise: Promise<PluginRestoreReadiness> | null = null;
  let resolveRestore: ((state: PluginRestoreReadiness) => void) | null = null;
  let rejectRestore: ((reason: unknown) => void) | null = null;

  const enqueueStorageTask = <Result>(
    task: () => Promise<Result>,
  ): Promise<Result> => {
    const result = storageTail.then(
      () => task(),
      () => task(),
    );
    storageTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const clearBootstrapWait = () => {
    bootstrapUnsubscribe?.();
    bootstrapUnsubscribe = null;
    if (bootstrapTimeout !== null) {
      clearTimeout(bootstrapTimeout);
      bootstrapTimeout = null;
    }
  };

  const saveInstances = (
    instances: readonly Instance[],
    stillValid?: () => boolean,
  ) => {
    if (disposed) return Promise.resolve();
    const normalized = normalizeInstances(instances);
    return enqueueStorageTask(async () => {
      if (disposed) return;
      // undo/redo 재결합이 끼어든 뒤 실행되는 큐 잔여 스냅샷은 폐기 (barrier 승리)
      if (stillValid && !stillValid()) return;
      await persistInstances(normalized);
    });
  };

  const releaseStaleMemoryInstances = (validTabIds: ReadonlySet<string>) => {
    const staleFullIds = getMemoryInstances()
      .filter(
        (instance) =>
          !validTabIds.has(normalizePluginInstanceTabId(instance.tabId)),
      )
      .map((instance) => instance.fullId);
    if (staleFullIds.length > 0) {
      releaseMemoryInstances(staleFullIds);
    }
  };

  const reconcile = (validTabIds: ReadonlySet<string>) => {
    if (disposed) return Promise.resolve();

    releaseStaleMemoryInstances(validTabIds);

    return enqueueStorageTask(async () => {
      if (disposed) return;
      releaseStaleMemoryInstances(validTabIds);
      // 완성 스냅샷 대신 정리 변환을 위임 - dep이 commit 큐 안에서 유효 탭과
      // canonical을 모두 다시 읽어야 낡은 판단이 최신 상태를 덮지 않음
      await reconcilePersist();
    });
  };

  const startRestore = (
    validTabIds: () => ReadonlySet<string>,
    restoreInstances: (
      instances: Instance[],
      state: Exclude<PluginRestoreReadiness, 'pending'>,
    ) => void,
  ): Promise<PluginRestoreReadiness> => {
    if (restorePromise) return restorePromise;

    restorePromise = new Promise<PluginRestoreReadiness>((resolve, reject) => {
      resolveRestore = resolve;
      rejectRestore = reject;
    });

    const settle = (
      nextReadiness: Exclude<PluginRestoreReadiness, 'pending'>,
    ) => {
      if (disposed || readiness !== 'pending') return;
      readiness = nextReadiness;
      clearBootstrapWait();

      void enqueueStorageTask(async () => {
        const stored = await loadInstances();
        if (disposed || !Array.isArray(stored)) return;

        const normalized = normalizeInstances(stored);
        const instancesToRestore =
          nextReadiness === 'ready'
            ? normalized.filter((instance) =>
                validTabIds().has(normalizePluginInstanceTabId(instance.tabId)),
              )
            : normalized;

        restoreInstances(instancesToRestore, nextReadiness);

        if (
          nextReadiness === 'ready' &&
          (instancesToRestore.length !== stored.length ||
            stored.some(
              (instance, index) => instance.tabId !== normalized[index]?.tabId,
            ))
        ) {
          try {
            await reconcilePersist();
          } catch (error) {
            console.warn(
              '[Plugin] Failed to persist restored instance cleanup:',
              error,
            );
          }
        }
      }).then(
        () => resolveRestore?.(nextReadiness),
        (error) => rejectRestore?.(error),
      );
    };

    if (isBootstrapped()) {
      settle('ready');
    } else {
      bootstrapUnsubscribe = subscribeBootstrap(() => {
        if (isBootstrapped()) settle('ready');
      });

      if (isBootstrapped()) {
        settle('ready');
      } else {
        bootstrapTimeout = setTimeout(() => {
          settle('failed');
        }, timeoutMs);
      }
    }

    return restorePromise;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearBootstrapWait();
    if (readiness === 'pending') {
      resolveRestore?.('pending');
    }
  };

  return {
    dispose,
    getReadiness: () => readiness,
    reconcile,
    saveInstances,
    startRestore,
  };
};
