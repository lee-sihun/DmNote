/**
 * plugin instance canonical commit의 플러그인별 직렬화 큐 (main 전용)
 * defineElement debounce 저장과 패널 RPC commit이 서로 다른 시점의 full snapshot으로
 * 상대를 덮지 않도록 일반 저장은 큐 실행 시점 상태를 캡처하고,
 * 제스처 경계 flush는 다음 mutation 전 상태를 고정한다
 */

import { trackEditorWrite } from '@src/renderer/editor/runtime/editorWriteBarrier';

const queues = new Map<string, Promise<unknown>>();

const EDIT_SESSION_TTL_MS = 1200;

interface PluginEditSession {
  id: string;
  active: boolean;
  expiresAt: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const editSessions = new Map<string, PluginEditSession>();
const editSessionFlushers = new Map<string, Set<() => void>>();
const stagedGestures = new Map<string, string>();
const stagedReleaseListeners = new Map<string, Set<() => void>>();

const schedulePluginInstancesEditSessionCleanup = (
  pluginId: string,
  session: PluginEditSession,
): void => {
  session.active = false;
  session.expiresAt = Date.now() + EDIT_SESSION_TTL_MS;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  const sessionId = session.id;
  session.cleanupTimer = setTimeout(() => {
    const current = editSessions.get(pluginId);
    if (current?.id === sessionId && !current.active) {
      editSessions.delete(pluginId);
    }
  }, EDIT_SESSION_TTL_MS);
};

export const touchPluginInstancesEditSession = (
  pluginId: string,
  preferredGestureId?: string,
): string => {
  const now = Date.now();
  let session = editSessions.get(pluginId);
  if (session?.active) return session.id;
  if (
    !session ||
    now > session.expiresAt ||
    (preferredGestureId !== undefined && session.id !== preferredGestureId)
  ) {
    if (session?.cleanupTimer) clearTimeout(session.cleanupTimer);
    session = {
      id: preferredGestureId ?? crypto.randomUUID(),
      active: false,
      expiresAt: 0,
      cleanupTimer: null,
    };
    editSessions.set(pluginId, session);
  }
  schedulePluginInstancesEditSessionCleanup(pluginId, session);
  return session.id;
};

export const registerPluginInstancesEditSessionFlush = (
  pluginId: string,
  flush: () => void,
): (() => void) => {
  const flushers = editSessionFlushers.get(pluginId) ?? new Set<() => void>();
  flushers.add(flush);
  editSessionFlushers.set(pluginId, flushers);

  return () => {
    const current = editSessionFlushers.get(pluginId);
    if (!current) return;
    current.delete(flush);
    if (current.size === 0) editSessionFlushers.delete(pluginId);
  };
};

export const registerPluginInstancesStagedRelease = (
  pluginId: string,
  listener: () => void,
): (() => void) => {
  const listeners =
    stagedReleaseListeners.get(pluginId) ?? new Set<() => void>();
  listeners.add(listener);
  stagedReleaseListeners.set(pluginId, listeners);

  return () => {
    const current = stagedReleaseListeners.get(pluginId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) stagedReleaseListeners.delete(pluginId);
  };
};

export const rotatePluginInstancesEditSession = (
  pluginId: string,
  preferredGestureId?: string,
): string => {
  const current = editSessions.get(pluginId);
  if (preferredGestureId !== undefined && current?.id === preferredGestureId) {
    return touchPluginInstancesEditSession(pluginId, preferredGestureId);
  }
  editSessionFlushers.get(pluginId)?.forEach((flush) => flush());

  const previous = editSessions.get(pluginId);
  if (previous?.cleanupTimer) clearTimeout(previous.cleanupTimer);
  editSessions.delete(pluginId);
  return touchPluginInstancesEditSession(pluginId, preferredGestureId);
};

export const beginPluginInstancesEditSession = (
  pluginId: string,
  gestureId: string = crypto.randomUUID(),
): string => {
  editSessionFlushers.get(pluginId)?.forEach((flush) => flush());

  const previous = editSessions.get(pluginId);
  if (previous?.cleanupTimer) clearTimeout(previous.cleanupTimer);
  const session = {
    id: gestureId,
    active: true,
    expiresAt: Number.POSITIVE_INFINITY,
    cleanupTimer: null,
  };
  editSessions.set(pluginId, session);
  return session.id;
};

export const endPluginInstancesEditSession = (
  pluginId: string,
  token: string,
): void => {
  const session = editSessions.get(pluginId);
  if (!session?.active || session.id !== token) return;
  editSessionFlushers.get(pluginId)?.forEach((flush) => flush());
  const current = editSessions.get(pluginId);
  if (!current?.active || current.id !== token) return;
  if (current.cleanupTimer) clearTimeout(current.cleanupTimer);
  editSessions.delete(pluginId);
};

export const clearPluginInstancesEditSessions = (): void => {
  editSessions.forEach((session) => {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  });
  editSessions.clear();
  stagedGestures.clear();
};

export const stagePluginInstancesGesture = (
  pluginId: string,
  gestureId: string,
): void => {
  stagedGestures.set(pluginId, gestureId);
};

export const getStagedPluginInstancesGestureId = (
  pluginId: string,
): string | undefined => stagedGestures.get(pluginId);

export const unstagePluginInstancesGesture = (
  pluginId: string,
  gestureId: string,
): void => {
  if (stagedGestures.get(pluginId) === gestureId) {
    stagedGestures.delete(pluginId);
    stagedReleaseListeners.get(pluginId)?.forEach((listener) => listener());
  }
};

export const isPluginInstancesGestureStaged = (
  pluginId: string,
  gestureId?: string,
): boolean => {
  const staged = stagedGestures.get(pluginId);
  return (
    staged !== undefined && (gestureId === undefined || staged === gestureId)
  );
};

export const hasConflictingPluginInstancesGesture = (
  pluginId: string,
  gestureId: string,
): boolean => {
  const stagedGestureId = stagedGestures.get(pluginId);
  if (stagedGestureId !== undefined && stagedGestureId !== gestureId) {
    return true;
  }
  const session = editSessions.get(pluginId);
  return session !== undefined && session.id !== gestureId;
};

export const enqueuePluginInstancesCommit = <T>(
  pluginId: string,
  task: () => Promise<T>,
): Promise<T> => {
  const tail = queues.get(pluginId) ?? Promise.resolve();
  const run = tail.then(task, task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(pluginId, settled);
  void settled.then(() => {
    if (queues.get(pluginId) === settled) queues.delete(pluginId);
  });
  return run;
};

export const getPendingPluginInstancesCommitCount = (): number => queues.size;

export const drainPluginInstancesCommitQueues = async (
  pluginIds: readonly string[],
): Promise<void> => {
  const uniquePluginIds = [...new Set(pluginIds)];
  while (true) {
    const tails = uniquePluginIds
      .map((pluginId) => queues.get(pluginId))
      .filter((tail): tail is Promise<unknown> => tail !== undefined);
    if (tails.length === 0) return;
    await Promise.all(tails);
  }
};

interface PluginInstancesSaveRequest {
  gestureId?: string;
  captureCurrentSnapshot: boolean;
}

interface PluginInstancesSaveDebounceOptions {
  delayMs: number;
  save: (request: PluginInstancesSaveRequest) => Promise<void>;
  onError: (error: unknown) => void;
}

export const createPluginInstancesSaveDebounce = ({
  delayMs,
  save,
  onError,
}: PluginInstancesSaveDebounceOptions) => {
  let scheduled:
    | {
        gestureId?: string;
        timer: ReturnType<typeof setTimeout>;
        resolve: () => void;
        reject: (error: unknown) => void;
      }
    | undefined;

  const cancel = () => {
    if (!scheduled) return;
    clearTimeout(scheduled.timer);
    scheduled.resolve();
    scheduled = undefined;
  };

  const runScheduledSave = (captureCurrentSnapshot: boolean): boolean => {
    const pending = scheduled;
    if (!pending) return false;

    clearTimeout(pending.timer);
    scheduled = undefined;
    let savePromise: Promise<void>;
    try {
      savePromise = save({
        gestureId: pending.gestureId,
        captureCurrentSnapshot,
      });
    } catch (error) {
      onError(error);
      pending.reject(error);
      return true;
    }
    void savePromise.then(pending.resolve, (error) => {
      onError(error);
      pending.reject(error);
    });
    return true;
  };

  const schedule = (gestureId?: string) => {
    cancel();

    let resolveWrite!: () => void;
    let rejectWrite!: (error: unknown) => void;
    const pendingWrite = new Promise<void>((resolve, reject) => {
      resolveWrite = resolve;
      rejectWrite = reject;
    });
    trackEditorWrite(pendingWrite);

    scheduled = {
      gestureId,
      resolve: resolveWrite,
      reject: rejectWrite,
      timer: setTimeout(() => {
        runScheduledSave(false);
      }, delayMs),
    };
  };

  const flush = () => runScheduledSave(true);

  return { cancel, flush, schedule };
};
