import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import type { CommitStrategy } from './useOptimisticBooleanCommit';

interface PendingValue<T> {
  value: T;
}

interface UseAfterPaintValueCommitOptions<T> {
  onCommit: (value: T) => void;
  strategy?: CommitStrategy;
}

export const useAfterPaintValueCommit = <T>({
  onCommit,
  strategy = 'after-paint',
}: UseAfterPaintValueCommitOptions<T>) => {
  const commitFrameRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const pendingValueRef = useRef<PendingValue<T> | null>(null);
  const onCommitRef = useRef(onCommit);

  useLayoutEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const cancelScheduledCommit = useCallback(() => {
    if (commitFrameRef.current !== null) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const commitPendingValue = useCallback(() => {
    cancelScheduledCommit();
    const pending = pendingValueRef.current;
    pendingValueRef.current = null;
    if (pending !== null) onCommitRef.current(pending.value);
  }, [cancelScheduledCommit]);

  const scheduleCommit = useCallback(
    (value: T) => {
      if (strategy === 'sync') {
        onCommitRef.current(value);
        return;
      }

      pendingValueRef.current = { value };
      cancelScheduledCommit();
      commitFrameRef.current = requestAnimationFrame(() => {
        commitFrameRef.current = null;
        commitTimerRef.current = window.setTimeout(() => {
          commitTimerRef.current = null;
          commitPendingValue();
        }, 0);
      });
    },
    [cancelScheduledCommit, commitPendingValue, strategy],
  );

  const cancelPendingCommit = useCallback(() => {
    cancelScheduledCommit();
    pendingValueRef.current = null;
  }, [cancelScheduledCommit]);

  useEffect(
    () => () => {
      commitPendingValue();
    },
    [commitPendingValue],
  );

  return {
    scheduleCommit,
    flushPendingCommit: commitPendingValue,
    cancelPendingCommit,
  };
};
