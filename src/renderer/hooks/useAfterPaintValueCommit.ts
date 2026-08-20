import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type React from 'react';

import { usePanelHost } from '@contexts/PanelHostContext';
import { registerPendingOptimisticCommit } from './pendingOptimisticCommits';
import type { CommitStrategy } from './useOptimisticBooleanCommit';

interface PendingValue<T> {
  value: T;
}

interface UseAfterPaintValueCommitOptions<T> {
  onCommit: (value: T) => void;
  strategy?: CommitStrategy;
  /**
   * 요소가 분리 패널 자식 창에 있으면 그 창의 프레임에 커밋을 싣는다.
   * 메인이 가려져 있어도 멈추지 않게
   */
  frameHostRef?: React.RefObject<Element | null>;
}

export const useAfterPaintValueCommit = <T>({
  onCommit,
  strategy = 'after-paint',
  frameHostRef,
}: UseAfterPaintValueCommitOptions<T>) => {
  // 프레임·타이머는 예약한 창과 함께 들고 있어야 그 창에서 취소된다
  const commitFrameRef = useRef<{ win: Window; id: number } | null>(null);
  const commitTimerRef = useRef<{ win: Window; id: number } | null>(null);
  const pendingValueRef = useRef<PendingValue<T> | null>(null);
  const onCommitRef = useRef(onCommit);
  // 패널 호스트 창 - frameHostRef가 없어도 분리 창 안이면 그 창의 프레임에 실린다.
  // 스케줄 함수들은 렌더마다 새로 만들어져 최신 컨텍스트 값을 클로저로 잡는다
  const { window: panelHostWindow } = usePanelHost();
  const unregisterPendingRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

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

  const commitPendingValue = useCallback(() => {
    unregisterPendingRef.current?.();
    unregisterPendingRef.current = null;
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
      unregisterPendingRef.current?.();
      unregisterPendingRef.current =
        registerPendingOptimisticCommit(commitPendingValue);
      const win =
        frameHostRef?.current?.ownerDocument.defaultView ??
        panelHostWindow ??
        window;
      commitFrameRef.current = {
        win,
        id: win.requestAnimationFrame(() => {
          commitFrameRef.current = null;
          commitTimerRef.current = {
            win,
            id: win.setTimeout(() => {
              commitTimerRef.current = null;
              commitPendingValue();
            }, 0),
          };
        }),
      };
    },
    [
      cancelScheduledCommit,
      commitPendingValue,
      frameHostRef,
      panelHostWindow,
      strategy,
    ],
  );

  const cancelPendingCommit = useCallback(() => {
    unregisterPendingRef.current?.();
    unregisterPendingRef.current = null;
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
