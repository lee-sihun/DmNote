import { getUndoRedoInProgress } from '@api/pluginDisplayElements';
import {
  applyCounterCacheSnapshot,
  setCachedKeyCounter,
} from '@stores/signals/keyCounterCache';
import {
  applyCounterSnapshot,
  setKeyCounter,
} from '@stores/signals/keyCounterSignals';
import { useKeyStore } from '@stores/data/useKeyStore';
import {
  useSettingsStore,
  type SettingsStateSnapshot,
} from '@stores/useSettingsStore';
import type { CanonicalBootstrapPayload } from '@src/types/app';
import type { KeyCounters } from '@src/types/key/keys';
import type { KeyCounterUpdate } from '@src/types/plugin/api';
import { mergeNoteSettings } from '@src/types/settings/noteSettings';

type CounterDelayTimerHandle = ReturnType<typeof setTimeout>;

interface DelayedCounterUpdate extends KeyCounterUpdate {
  apply: () => void;
}

interface CounterStateSnapshot {
  sessionId: string;
  revision: number;
  counters: KeyCounters;
}

export interface CounterResyncContext {
  latestUpdates: Map<string, KeyCounterUpdate>;
  latestSnapshot: { sessionId: string; revision: number } | null;
}

interface RunCounterResyncOptions {
  loadBootstrap: () => Promise<CanonicalBootstrapPayload>;
  applySnapshot: (
    bootstrap: CanonicalBootstrapPayload,
    context: CounterResyncContext,
  ) => void;
  syncEditor: () => Promise<unknown>;
}

export const resolveCounterDelayMs = (
  noteSettings: SettingsStateSnapshot['noteSettings'],
  tabNoteOverrides: SettingsStateSnapshot['tabNoteOverrides'],
  selectedKeyType: string,
) => {
  const effectiveSettings = mergeNoteSettings(
    noteSettings,
    tabNoteOverrides?.[selectedKeyType],
  );
  const delay = Number(effectiveSettings.keyDisplayDelayMs ?? 0);
  return delay > 0 ? delay : 0;
};

const createCounterResyncContext = (): CounterResyncContext => ({
  latestUpdates: new Map(),
  latestSnapshot: null,
});

export const createAppCounterRuntime = (isOverlayWindow: boolean) => {
  const counterDelayTimers = new Map<
    string,
    Map<CounterDelayTimerHandle, DelayedCounterUpdate>
  >();
  const pendingCounterDelayTimers = new Map<
    CounterDelayTimerHandle,
    DelayedCounterUpdate
  >();
  let disposed = false;
  let initialApplied = false;
  let resyncInFlight = false;
  let resyncQueued = false;
  let latestCounterSessionId: string | null = null;
  let latestCounterRevision = 0;
  let counterResyncContext: CounterResyncContext | null = null;

  const composeCounterKey = (mode?: string, key?: string) =>
    `${mode || '__unknown_mode__'}::${key || '__unknown_key__'}`;

  const getLatestPendingCounterUpdate = (composedKey: string) => {
    const timers = counterDelayTimers.get(composedKey);
    if (!timers) return null;

    let latest: DelayedCounterUpdate | null = null;
    timers.forEach((update) => {
      if (latest === null || update.revision > latest.revision) {
        latest = update;
      }
    });
    return latest;
  };

  const clearCounterDelayTimers = (composedKey?: string) => {
    if (composedKey) {
      const timers = counterDelayTimers.get(composedKey);
      if (timers) {
        timers.forEach((_update, timer) => {
          clearTimeout(timer);
          pendingCounterDelayTimers.delete(timer);
        });
        counterDelayTimers.delete(composedKey);
      }
      return;
    }

    pendingCounterDelayTimers.forEach((_update, timer) => clearTimeout(timer));
    pendingCounterDelayTimers.clear();
    counterDelayTimers.forEach((timers) => timers.clear());
    counterDelayTimers.clear();
  };

  const discardCounterDelayTimers = (
    shouldDiscard: (update: DelayedCounterUpdate) => boolean,
  ) => {
    counterDelayTimers.forEach((timers, composedKey) => {
      timers.forEach((update, timer) => {
        if (!shouldDiscard(update)) return;
        clearTimeout(timer);
        timers.delete(timer);
        pendingCounterDelayTimers.delete(timer);
      });
      if (timers.size === 0) {
        counterDelayTimers.delete(composedKey);
      }
    });
  };

  const flushCounterDelayTimers = () => {
    const pending = [...pendingCounterDelayTimers.entries()];
    pendingCounterDelayTimers.clear();
    counterDelayTimers.forEach((timers) => timers.clear());
    counterDelayTimers.clear();

    pending.forEach(([timer, update]) => {
      clearTimeout(timer);
      update.apply();
    });
  };

  const getCounterDelayMs = () => {
    const { noteSettings, tabNoteOverrides } = useSettingsStore.getState();
    const { selectedKeyType } = useKeyStore.getState();
    return resolveCounterDelayMs(
      noteSettings,
      tabNoteOverrides,
      selectedKeyType,
    );
  };

  const scheduleCounterUpdate = (event: KeyCounterUpdate) => {
    const delayMs = getCounterDelayMs();
    const composedKey = composeCounterKey(event.mode, event.key);

    if (delayMs <= 0) {
      clearCounterDelayTimers(composedKey);
      setKeyCounter(event.mode, event.key, event.count);
      return;
    }

    const apply = () => {
      if (disposed) return;
      setKeyCounter(event.mode, event.key, event.count);
    };
    const update: DelayedCounterUpdate = {
      apply,
      mode: event.mode,
      key: event.key,
      count: event.count,
      sessionId: event.sessionId,
      revision: event.revision,
    };
    const timer = setTimeout(() => {
      const pendingUpdate = pendingCounterDelayTimers.get(timer);
      if (!pendingUpdate) return;

      pendingCounterDelayTimers.delete(timer);
      const timers = counterDelayTimers.get(composedKey);
      timers?.delete(timer);
      if (timers?.size === 0) {
        counterDelayTimers.delete(composedKey);
      }
      pendingUpdate.apply();
    }, delayMs);

    const existing = counterDelayTimers.get(composedKey);
    if (existing) {
      existing.set(timer, update);
    } else {
      counterDelayTimers.set(composedKey, new Map([[timer, update]]));
    }
    pendingCounterDelayTimers.set(timer, update);
  };

  const adoptCounterSession = (sessionId: string) => {
    if (latestCounterSessionId === sessionId) return;

    latestCounterSessionId = sessionId;
    latestCounterRevision = 0;
    clearCounterDelayTimers();
    if (counterResyncContext) {
      counterResyncContext.latestUpdates.clear();
      counterResyncContext.latestSnapshot = null;
    }
  };

  const reconcileResyncCounters = (
    counters: KeyCounters,
    sessionId: string,
    revision: number,
    context: CounterResyncContext,
  ) => {
    const reconciled = Object.fromEntries(
      Object.entries(counters).map(([mode, entries]) => [mode, { ...entries }]),
    ) as KeyCounters;

    context.latestUpdates.forEach(
      ({
        mode,
        key,
        count,
        sessionId: eventSessionId,
        revision: eventRevision,
      }) => {
        if (eventSessionId !== sessionId || eventRevision <= revision) return;
        const modeCounters = (reconciled[mode] ??= {});
        modeCounters[key] = count;
      },
    );
    return reconciled;
  };

  const applyResyncCounters = (
    counters: KeyCounters,
    sessionId: string,
    revision: number,
    context: CounterResyncContext,
  ) => {
    adoptCounterSession(sessionId);
    // bootstrap 캡처 뒤 수신한 최신 전체 스냅샷 우선권
    if (
      context.latestSnapshot?.sessionId === sessionId &&
      context.latestSnapshot.revision > revision
    ) {
      return;
    }

    const reconciled = reconcileResyncCounters(
      counters,
      sessionId,
      revision,
      context,
    );
    discardCounterDelayTimers(
      (pending) =>
        pending.sessionId !== sessionId || pending.revision <= revision,
    );

    applyCounterCacheSnapshot(reconciled);
    if (isOverlayWindow) {
      applyCounterSnapshot(reconciled, (composed) => {
        const pending = getLatestPendingCounterUpdate(composed);
        if (pending?.sessionId === sessionId && pending.revision > revision) {
          return true;
        }
        const update = context.latestUpdates.get(composed);
        return Boolean(
          update?.sessionId === sessionId && update.revision > revision,
        );
      });
    }
    latestCounterRevision = Math.max(latestCounterRevision, revision);
  };

  const handleCounterState = (event: CounterStateSnapshot) => {
    adoptCounterSession(event.sessionId);
    if (event.revision <= latestCounterRevision) return;
    latestCounterRevision = event.revision;

    const context = counterResyncContext;
    if (context) {
      if (
        context.latestSnapshot?.sessionId !== event.sessionId ||
        event.revision > context.latestSnapshot.revision
      ) {
        context.latestSnapshot = {
          sessionId: event.sessionId,
          revision: event.revision,
        };
      }
      context.latestUpdates.forEach((update, composed) => {
        if (
          update.sessionId !== event.sessionId ||
          update.revision <= event.revision
        ) {
          context.latestUpdates.delete(composed);
        }
      });
    }
    clearCounterDelayTimers();
    applyCounterCacheSnapshot(event.counters);
    if (getUndoRedoInProgress()) return;
    if (isOverlayWindow) {
      applyCounterSnapshot(event.counters);
    }
  };

  const handleCounterChanged = (event: KeyCounterUpdate) => {
    adoptCounterSession(event.sessionId);
    if (event.revision <= latestCounterRevision) return;
    latestCounterRevision = event.revision;

    setCachedKeyCounter(event.mode, event.key, event.count);
    const composed = composeCounterKey(event.mode, event.key);
    const previous = counterResyncContext?.latestUpdates.get(composed);
    if (!previous || event.revision > previous.revision) {
      counterResyncContext?.latestUpdates.set(composed, event);
    }
    if (isOverlayWindow) {
      scheduleCounterUpdate(event);
    }
  };

  const beginCounterResync = () => {
    const context = createCounterResyncContext();
    counterResyncContext = context;
    return context;
  };

  const releaseCounterResync = (context: CounterResyncContext) => {
    if (counterResyncContext === context) {
      counterResyncContext = null;
    }
  };

  // 초기 적용 및 진행 중 요청의 단일 후속 실행
  const runResync = async ({
    loadBootstrap,
    applySnapshot,
    syncEditor,
  }: RunCounterResyncOptions) => {
    if (disposed) return;
    if (!initialApplied || resyncInFlight) {
      resyncQueued = true;
      return;
    }
    resyncInFlight = true;
    do {
      resyncQueued = false;
      const counterContext = beginCounterResync();
      try {
        const bootstrap = await loadBootstrap();
        if (disposed) return;
        applySnapshot(bootstrap, counterContext);
        releaseCounterResync(counterContext);
        await syncEditor();
      } catch (error) {
        console.error('OBS 재동기화 실패', error);
      } finally {
        releaseCounterResync(counterContext);
      }
    } while (resyncQueued && !disposed);
    resyncInFlight = false;
  };

  const markInitialApplied = () => {
    initialApplied = true;
    return resyncQueued;
  };

  const markDisposed = () => {
    disposed = true;
  };

  const dispose = () => {
    markDisposed();
    clearCounterDelayTimers();
  };

  return {
    applyResyncCounters,
    beginCounterResync,
    dispose,
    flushCounterDelayTimers,
    handleCounterChanged,
    handleCounterState,
    markInitialApplied,
    markDisposed,
    releaseCounterResync,
    runResync,
  };
};
