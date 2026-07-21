/**
 * plugin instance canonical commit의 플러그인별 직렬화 큐 (main 전용)
 * defineElement debounce 저장과 패널 RPC commit이 서로 다른 시점의 full snapshot으로
 * 상대를 덮지 않도록, 모든 commit은 이 큐 안에서 실행 시점 상태를 캡처해야 한다
 */

import { trackEditorWrite } from '@src/renderer/editor/runtime/editorWriteBarrier';

const queues = new Map<string, Promise<unknown>>();

const EDIT_SESSION_TTL_MS = 1200;

interface PluginEditSession {
  id: string;
  expiresAt: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const editSessions = new Map<string, PluginEditSession>();

export const touchPluginInstancesEditSession = (pluginId: string): string => {
  const now = Date.now();
  let session = editSessions.get(pluginId);
  if (!session || now > session.expiresAt) {
    if (session?.cleanupTimer) clearTimeout(session.cleanupTimer);
    session = {
      id: crypto.randomUUID(),
      expiresAt: 0,
      cleanupTimer: null,
    };
    editSessions.set(pluginId, session);
  }
  session.expiresAt = now + EDIT_SESSION_TTL_MS;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  const sessionId = session.id;
  session.cleanupTimer = setTimeout(() => {
    const current = editSessions.get(pluginId);
    if (current?.id === sessionId) editSessions.delete(pluginId);
  }, EDIT_SESSION_TTL_MS);
  return sessionId;
};

export const clearPluginInstancesEditSessions = (): void => {
  editSessions.forEach((session) => {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  });
  editSessions.clear();
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

interface PluginInstancesSaveDebounceOptions {
  delayMs: number;
  save: () => Promise<void>;
  onError: (error: unknown) => void;
}

export const createPluginInstancesSaveDebounce = ({
  delayMs,
  save,
  onError,
}: PluginInstancesSaveDebounceOptions) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settleScheduledWrite: (() => void) | null = null;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    settleScheduledWrite?.();
    settleScheduledWrite = null;
  };

  const schedule = () => {
    cancel();

    let resolveWrite!: () => void;
    let rejectWrite!: (error: unknown) => void;
    const pendingWrite = new Promise<void>((resolve, reject) => {
      resolveWrite = resolve;
      rejectWrite = reject;
    });
    trackEditorWrite(pendingWrite);
    settleScheduledWrite = resolveWrite;

    timer = setTimeout(() => {
      timer = null;
      settleScheduledWrite = null;
      void save().then(resolveWrite, (error) => {
        onError(error);
        rejectWrite(error);
      });
    }, delayMs);
  };

  return { cancel, schedule };
};
