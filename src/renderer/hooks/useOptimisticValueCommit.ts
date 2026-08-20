import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type React from 'react';

import { usePanelHost } from '@contexts/PanelHostContext';
import { registerPendingOptimisticCommit } from './pendingOptimisticCommits';
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
  // 패널 호스트 창 - frameHostRef가 없어도 분리 창 안이면 그 창의 프레임에 실린다.
  // 스케줄 함수들은 렌더마다 새로 만들어져 최신 컨텍스트 값을 클로저로 잡는다
  const { window: panelHostWindow } = usePanelHost();
  const unregisterPendingRef = useRef<(() => void) | null>(null);

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

  // 어느 경로로 와도 1회만 확정 - 타이머 완료·언마운트·호스트 이동 drain이 같은 문을 지난다
  const settlePendingCommit = useCallback(() => {
    unregisterPendingRef.current?.();
    unregisterPendingRef.current = null;
    cancelScheduledCommit();
    const pending = pendingValueRef.current;
    pendingValueRef.current = null;
    if (pending === null) return;
    if (!isEqualRef.current(pending.value, canonicalValueRef.current)) {
      onCommitRef.current(pending.value);
    }
    setOptimisticValue((currentOptimistic) =>
      currentOptimistic === pending ? null : currentOptimistic,
    );
  }, [cancelScheduledCommit]);

  useEffect(() => () => settlePendingCommit(), [settlePendingCommit]);

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

    const win =
      frameHostRef?.current?.ownerDocument.defaultView ??
      panelHostWindow ??
      window;
    unregisterPendingRef.current?.();
    unregisterPendingRef.current =
      registerPendingOptimisticCommit(settlePendingCommit);
    commitFrameRef.current = {
      win,
      id: win.requestAnimationFrame(() => {
        commitFrameRef.current = null;
        commitTimerRef.current = {
          win,
          id: win.setTimeout(() => {
            commitTimerRef.current = null;
            settlePendingCommit();
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
