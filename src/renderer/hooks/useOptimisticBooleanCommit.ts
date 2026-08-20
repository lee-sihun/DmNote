import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type React from 'react';

export type CommitStrategy = 'sync' | 'after-paint';
export type BooleanCommitStrategy = CommitStrategy;

interface UseOptimisticBooleanCommitOptions {
  canonicalValue: boolean;
  onCommit: (value: boolean) => void;
  strategy?: BooleanCommitStrategy;
  /**
   * 요소가 분리 패널 자식 창에 있으면 그 창의 프레임에 커밋을 싣는다.
   * 메인이 가려져 있어도 멈추지 않게
   */
  frameHostRef?: React.RefObject<Element | null>;
}

export const useOptimisticBooleanCommit = ({
  canonicalValue,
  onCommit,
  strategy = 'after-paint',
  frameHostRef,
}: UseOptimisticBooleanCommitOptions) => {
  const [optimisticValue, setOptimisticValue] = useState<boolean | null>(null);
  // 프레임·타이머는 예약한 창과 함께 들고 있어야 그 창에서 취소된다
  const commitFrameRef = useRef<{ win: Window; id: number } | null>(null);
  const commitTimerRef = useRef<{ win: Window; id: number } | null>(null);
  const pendingValueRef = useRef<boolean | null>(null);
  const canonicalValueRef = useRef(canonicalValue);
  const onCommitRef = useRef(onCommit);

  useLayoutEffect(() => {
    canonicalValueRef.current = canonicalValue;
    onCommitRef.current = onCommit;
  }, [canonicalValue, onCommit]);

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
      if (pending !== null && pending !== canonicalValueRef.current) {
        onCommitRef.current(pending);
      }
    },
    [cancelScheduledCommit],
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
            const pending = pendingValueRef.current;
            pendingValueRef.current = null;
            if (pending === null) return;
            if (pending !== canonicalValueRef.current) {
              onCommitRef.current(pending);
            }
            setOptimisticValue((currentOptimistic) =>
              currentOptimistic === pending ? null : currentOptimistic,
            );
          }, 0),
        };
      }),
    };

    return next;
  };

  return {
    value: optimisticValue ?? canonicalValue,
    toggle,
  };
};
