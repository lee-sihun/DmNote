import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type React from 'react';

import type { CommitStrategy } from './useOptimisticBooleanCommit';

interface OptimisticValue<T> {
  value: T;
}

interface UseOptimisticValueCommitOptions<T> {
  canonicalValue: T;
  onCommit: (value: T) => void;
  strategy?: CommitStrategy;
  isEqual?: (left: T, right: T) => boolean;
  /**
   * 요소가 분리 패널 자식 창에 있으면 그 창의 프레임에 커밋을 싣는다.
   * 메인이 가려져 있어도 멈추지 않게
   */
  frameHostRef?: React.RefObject<Element | null>;
}

export const useOptimisticValueCommit = <T>({
  canonicalValue,
  onCommit,
  strategy = 'after-paint',
  isEqual = Object.is,
  frameHostRef,
}: UseOptimisticValueCommitOptions<T>) => {
  const [optimisticValue, setOptimisticValue] =
    useState<OptimisticValue<T> | null>(null);
  // 프레임·타이머는 예약한 창과 함께 들고 있어야 그 창에서 취소된다
  const commitFrameRef = useRef<{ win: Window; id: number } | null>(null);
  const commitTimerRef = useRef<{ win: Window; id: number } | null>(null);
  const pendingValueRef = useRef<OptimisticValue<T> | null>(null);
  const canonicalValueRef = useRef(canonicalValue);
  const onCommitRef = useRef(onCommit);
  const isEqualRef = useRef(isEqual);

  useLayoutEffect(() => {
    canonicalValueRef.current = canonicalValue;
    onCommitRef.current = onCommit;
    isEqualRef.current = isEqual;
  }, [canonicalValue, isEqual, onCommit]);

  const cancelScheduledCommit = useCallback(() => {
    const frame = commitFrameRef.current;
    if (frame !== null) {
      commitFrameRef.current = null;
      frame.win.cancelAnimationFrame(frame.id);
    }
    const timer = commitTimerRef.current;
    if (timer !== null) {
      commitTimerRef.current = null;
      timer.win.clearTimeout(timer.id);
    }
  }, []);

  useEffect(
    () => () => {
      cancelScheduledCommit();
      const pending = pendingValueRef.current;
      pendingValueRef.current = null;
      if (
        pending !== null &&
        !isEqualRef.current(pending.value, canonicalValueRef.current)
      ) {
        onCommitRef.current(pending.value);
      }
    },
    [cancelScheduledCommit],
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

    cancelScheduledCommit();

    const win = frameHostRef?.current?.ownerDocument.defaultView ?? window;
    commitFrameRef.current = {
      win,
      id: win.requestAnimationFrame(() => {
        commitFrameRef.current = null;
        commitTimerRef.current = {
          win,
          id: win.setTimeout(() => {
            commitTimerRef.current = null;
            const currentPending = pendingValueRef.current;
            pendingValueRef.current = null;
            if (currentPending === null) return;
            if (
              !isEqualRef.current(
                currentPending.value,
                canonicalValueRef.current,
              )
            ) {
              onCommitRef.current(currentPending.value);
            }
            setOptimisticValue((currentOptimistic) =>
              currentOptimistic === currentPending ? null : currentOptimistic,
            );
          }, 0),
        };
      }),
    };

    return next;
  };

  return {
    value: optimisticValue?.value ?? canonicalValue,
    select,
  };
};
