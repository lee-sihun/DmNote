import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

interface UseOptimisticAsyncBooleanCommitOptions {
  canonicalValue: boolean;
  onCommit: (value: boolean) => Promise<void>;
  onError?: (error: unknown) => void;
}

export const useOptimisticAsyncBooleanCommit = ({
  canonicalValue,
  onCommit,
  onError,
}: UseOptimisticAsyncBooleanCommitOptions) => {
  const [optimisticValue, setOptimisticValue] = useState<boolean | null>(null);
  const optimisticValueRef = useRef<boolean | null>(null);
  const canonicalValueRef = useRef(canonicalValue);
  const onCommitRef = useRef(onCommit);
  const onErrorRef = useRef(onError);
  const pendingValueRef = useRef<boolean | null>(null);
  const commitFrameRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const runningPromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  const updateOptimisticValue = useCallback((value: boolean | null) => {
    optimisticValueRef.current = value;
    if (mountedRef.current) setOptimisticValue(value);
  }, []);

  const reconcileCanonicalValue = useCallback(() => {
    if (optimisticValueRef.current === canonicalValueRef.current) {
      updateOptimisticValue(null);
    }
  }, [updateOptimisticValue]);

  const drainPendingValue = useCallback(async () => {
    if (runningPromiseRef.current) {
      await runningPromiseRef.current;
      return;
    }
    runningRef.current = true;
    const run = (async () => {
      let attemptedCommit = false;

      try {
        while (pendingValueRef.current !== null) {
          const target = pendingValueRef.current;
          pendingValueRef.current = null;

          if (!attemptedCommit && target === canonicalValueRef.current) {
            continue;
          }

          attemptedCommit = true;
          try {
            await onCommitRef.current(target);
          } catch (error) {
            onErrorRef.current?.(error);
            if (pendingValueRef.current === null) {
              updateOptimisticValue(null);
            }
          }
        }
      } finally {
        runningRef.current = false;
        reconcileCanonicalValue();
      }
    })();
    runningPromiseRef.current = run;
    try {
      await run;
    } finally {
      if (runningPromiseRef.current === run) runningPromiseRef.current = null;
    }
  }, [reconcileCanonicalValue, updateOptimisticValue]);

  const flush = async () => {
    if (commitFrameRef.current !== null) {
      cancelAnimationFrame(commitFrameRef.current);
      commitFrameRef.current = null;
    }
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    await drainPendingValue();
  };

  useLayoutEffect(() => {
    canonicalValueRef.current = canonicalValue;
    onCommitRef.current = onCommit;
    onErrorRef.current = onError;

    if (
      !runningRef.current &&
      pendingValueRef.current === null &&
      commitFrameRef.current === null &&
      commitTimerRef.current === null
    ) {
      reconcileCanonicalValue();
    }
  }, [canonicalValue, onCommit, onError, reconcileCanonicalValue]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (commitFrameRef.current !== null) {
        cancelAnimationFrame(commitFrameRef.current);
      }
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }

      const pending = pendingValueRef.current;
      if (!runningRef.current && pending !== null) {
        void drainPendingValue();
      }
    };
  }, [drainPendingValue]);

  const toggle = () => {
    const current = optimisticValueRef.current ?? canonicalValueRef.current;
    const next = !current;
    pendingValueRef.current = next;
    updateOptimisticValue(next);

    if (runningRef.current) return next;

    if (commitFrameRef.current !== null) {
      cancelAnimationFrame(commitFrameRef.current);
    }
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
    }

    commitFrameRef.current = requestAnimationFrame(() => {
      commitFrameRef.current = null;
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        void drainPendingValue();
      }, 0);
    });

    return next;
  };

  return {
    value: optimisticValue ?? canonicalValue,
    toggle,
    flush,
    pending:
      optimisticValue !== null ||
      runningRef.current ||
      pendingValueRef.current !== null,
  };
};
