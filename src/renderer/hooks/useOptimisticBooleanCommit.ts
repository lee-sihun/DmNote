import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type BooleanCommitStrategy = 'sync' | 'after-paint';

interface UseOptimisticBooleanCommitOptions {
  canonicalValue: boolean;
  onCommit: (value: boolean) => void;
  strategy?: BooleanCommitStrategy;
}

export const useOptimisticBooleanCommit = ({
  canonicalValue,
  onCommit,
  strategy = 'after-paint',
}: UseOptimisticBooleanCommitOptions) => {
  const [optimisticValue, setOptimisticValue] = useState<boolean | null>(null);
  const commitFrameRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const pendingValueRef = useRef<boolean | null>(null);
  const canonicalValueRef = useRef(canonicalValue);
  const onCommitRef = useRef(onCommit);

  useLayoutEffect(() => {
    canonicalValueRef.current = canonicalValue;
    onCommitRef.current = onCommit;
  }, [canonicalValue, onCommit]);

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
      if (pending !== null && pending !== canonicalValueRef.current) {
        onCommitRef.current(pending);
      }
    },
    [],
  );

  const toggle = () => {
    const current = pendingValueRef.current ?? canonicalValueRef.current;
    const next = !current;

    if (strategy === 'sync') {
      onCommitRef.current(next);
      return next;
    }

    pendingValueRef.current = next;
    setOptimisticValue(next);

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
        const pending = pendingValueRef.current;
        pendingValueRef.current = null;
        if (pending === null) return;
        if (pending !== canonicalValueRef.current) {
          onCommitRef.current(pending);
        }
        setOptimisticValue((currentOptimistic) =>
          currentOptimistic === pending ? null : currentOptimistic,
        );
      }, 0);
    });

    return next;
  };

  return {
    value: optimisticValue ?? canonicalValue,
    toggle,
  };
};
