import { useEffect, useLayoutEffect, useRef } from 'react';
import type React from 'react';

import { usePanelHost } from '@contexts/PanelHostContext';
import { isHTMLElementNode } from '@utils/dom/isElementNode';

/**
 * 입력 blur 커밋이 유발하는 리렌더와 경합해 click이 유실되는 terminal 버튼용
 * pointerdown에서 press 의도를 기록하고 click이 정상 도착하면 그대로 실행,
 * click이 유실되면 pointerup 직후 1회만 fallback 실행 (이중 실행 가드)
 * 키보드 활성화(Enter/Space)는 의도 기록 없이 click으로 도착해 그대로 실행됨
 */
export const usePressAction = (action: () => void) => {
  const actionRef = useRef(action);
  const pressIntentRef = useRef<{
    pointerId: number;
    inside: boolean;
    bounds: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
  } | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 분리 패널 창의 버튼이면 그 창의 document/window가 포인터·blur를 받는다
  const { window: ownerWindow, document: ownerDocument } = usePanelHost();

  useLayoutEffect(() => {
    actionRef.current = action;
  }, [action]);

  const clearFallback = () => {
    if (fallbackTimerRef.current === null) return;
    clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  };

  const resetPress = () => {
    pressIntentRef.current = null;
    clearFallback();
  };

  useEffect(() => {
    const clearCurrentPress = () => {
      pressIntentRef.current = null;
      if (fallbackTimerRef.current !== null) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
    const handleWindowBlur = () => clearCurrentPress();
    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (
        event.isPrimary &&
        pressIntentRef.current?.pointerId === event.pointerId
      ) {
        clearCurrentPress();
      }
    };
    const handleDocumentPointerUp = (event: PointerEvent) => {
      const pointerId = event.pointerId;
      queueMicrotask(() => {
        if (pressIntentRef.current?.pointerId === pointerId) {
          clearCurrentPress();
        }
      });
    };
    const handleDocumentPointerCancel = (event: PointerEvent) => {
      if (pressIntentRef.current?.pointerId === event.pointerId) {
        clearCurrentPress();
      }
    };
    ownerWindow.addEventListener('blur', handleWindowBlur);
    ownerDocument.addEventListener(
      'pointerdown',
      handleDocumentPointerDown,
      true,
    );
    ownerDocument.addEventListener('pointerup', handleDocumentPointerUp, true);
    ownerDocument.addEventListener(
      'pointercancel',
      handleDocumentPointerCancel,
      true,
    );
    return () => {
      ownerWindow.removeEventListener('blur', handleWindowBlur);
      ownerDocument.removeEventListener(
        'pointerdown',
        handleDocumentPointerDown,
        true,
      );
      ownerDocument.removeEventListener(
        'pointerup',
        handleDocumentPointerUp,
        true,
      );
      ownerDocument.removeEventListener(
        'pointercancel',
        handleDocumentPointerCancel,
        true,
      );
      clearCurrentPress();
    };
  }, [ownerDocument, ownerWindow]);

  const isDisabled = (target: EventTarget | null) =>
    isHTMLElementNode(target) &&
    (target.matches(':disabled') ||
      target.getAttribute('aria-disabled') === 'true');

  const run = () => {
    clearFallback();
    pressIntentRef.current = null;
    actionRef.current();
  };

  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (
        event.button !== 0 ||
        !event.isPrimary ||
        event.defaultPrevented ||
        isDisabled(event.currentTarget)
      ) {
        resetPress();
        return;
      }
      clearFallback();
      pressIntentRef.current = {
        pointerId: event.pointerId,
        inside: true,
        bounds: event.currentTarget.getBoundingClientRect(),
      };
    },
    onPointerEnter: (event: React.PointerEvent) => {
      const intent = pressIntentRef.current;
      if (
        !intent ||
        intent.pointerId !== event.pointerId ||
        (event.buttons & 1) === 0 ||
        isDisabled(event.currentTarget)
      ) {
        return;
      }
      intent.inside = true;
    },
    onPointerUp: (event: React.PointerEvent) => {
      const intent = pressIntentRef.current;
      if (!intent || intent.pointerId !== event.pointerId) return;
      const shouldRun =
        event.button === 0 &&
        event.isPrimary &&
        intent.inside &&
        event.clientX >= intent.bounds.left &&
        event.clientX <= intent.bounds.right &&
        event.clientY >= intent.bounds.top &&
        event.clientY <= intent.bounds.bottom &&
        !event.defaultPrevented &&
        !isDisabled(event.currentTarget);
      pressIntentRef.current = null;
      if (!shouldRun) {
        clearFallback();
        return;
      }
      // 정상 경로에서는 직후 click이 타이머를 취소하고 실행
      // click이 유실된 경우에만 최신 action으로 fallback
      clearFallback();
      fallbackTimerRef.current = setTimeout(() => {
        fallbackTimerRef.current = null;
        actionRef.current();
      }, 0);
    },
    onPointerCancel: (event: React.PointerEvent) => {
      if (pressIntentRef.current?.pointerId === event.pointerId) resetPress();
    },
    onClick: (event: React.MouseEvent) => {
      if (event.defaultPrevented || isDisabled(event.currentTarget)) {
        resetPress();
        return;
      }
      run();
    },
    // 밖에서 놓으면 취소, 누른 채 다시 들어오면 native click과 같은 성공 처리
    onPointerLeave: (event: React.PointerEvent) => {
      if (pressIntentRef.current?.pointerId === event.pointerId) {
        pressIntentRef.current.inside = false;
      }
    },
  };
};
