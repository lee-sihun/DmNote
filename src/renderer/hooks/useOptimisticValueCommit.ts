import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { CommitStrategy } from './useOptimisticBooleanCommit';

interface OptimisticValue<T> {
  value: T;
}

interface UseOptimisticValueCommitOptions<T> {
  canonicalValue: T;
  onCommit: (value: T) => void;
  strategy?: CommitStrategy;
  isEqual?: (left: T, right: T) => boolean;
}

export const useOptimisticValueCommit = <T>({
  canonicalValue,
  onCommit,
  strategy = 'after-paint',
  isEqual = Object.is,
}: UseOptimisticValueCommitOptions<T>) => {
  const [optimisticValue, setOptimisticValue] =
    useState<OptimisticValue<T> | null>(null);
  const commitFrameRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const pendingValueRef = useRef<OptimisticValue<T> | null>(null);
  const canonicalValueRef = useRef(canonicalValue);
  const onCommitRef = useRef(onCommit);
  const isEqualRef = useRef(isEqual);

  useLayoutEffect(() => {
    canonicalValueRef.current = canonicalValue;
    onCommitRef.current = onCommit;
    isEqualRef.current = isEqual;
  }, [canonicalValue, isEqual, onCommit]);

  useEffect(
    () => () => {
      if (commitFrameRef.current !== null) {
        cancelAnimationFrame(commitFrameRef.current);
      }
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }
      const pending = pendingValueRef.current;
      pendingValueRef.current = null;
      if (
        pending !== null &&
        !isEqualRef.current(pending.value, canonicalValueRef.current)
      ) {
        onCommitRef.current(pending.value);
      }
    },
    [],
  );

  const select = (next: T) => {
    const current = pendingValueRef.current?.value ?? canonicalValueRef.current;
    if (isEqualRef.current(current, next)) return next;

    if (strategy === 'sync') {
      onCommitRef.current(next);
      return next;
    }

    const pending = { value: next };
    pendingValueRef.current = pending;
    setOptimisticValue(pending);

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
        const currentPending = pendingValueRef.current;
        pendingValueRef.current = null;
        if (currentPending === null) return;
        if (
          !isEqualRef.current(currentPending.value, canonicalValueRef.current)
        ) {
          onCommitRef.current(currentPending.value);
        }
        setOptimisticValue((currentOptimistic) =>
          currentOptimistic === currentPending ? null : currentOptimistic,
        );
      }, 0);
    });

    return next;
  };

  return {
    value: optimisticValue?.value ?? canonicalValue,
    select,
  };
};
