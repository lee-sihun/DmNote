import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  getLastInputModality,
  isPointerFocusRelease,
} from '@utils/focus/pointerFocusGuard';

export interface FocusRestore {
  /** 열기 전 포커스. 퇴장 유예 중 재오픈이면 captureOpener가 갱신한다 */
  openerRef: RefObject<HTMLElement | null>;
  /**
   * 활성화 시점에 opener를 다시 잡는다. 첫 활성화는 첫 렌더 캡처가 정확하므로 건너뛴다.
   * 이미 안쪽에 포커스가 있으면 자식 autoFocus를 opener로 오인하지 않게 유지
   */
  captureOpener: (container: HTMLElement) => void;
  /** 닫기 시작 시점에 한 번 복원 */
  restoreFocus: () => void;
}

// 팝업과 모달의 포커스 복원.
//
// 열기 전 포커스는 첫 렌더 시점에 잡아야 한다. passive effect는 자식 autoFocus와
// 자식 effect 이후에 실행돼 opener 대신 내부 요소를 잡는다.
//
// 복원은 닫기 시작 시점에 한 번이다. 언마운트 cleanup에만 걸어두면 퇴장 모션이
// 끝날 때까지 포커스가 안에 붙잡혀 있다.
//
// open은 "열려 있는가"지 "마운트돼 있는가"가 아니다. 퇴장 유예 중에는 DOM이 남아도
// false여야 복원이 모션 시작과 함께 일어난다
export const useFocusRestore = (
  open: boolean,
  ownerDocument?: Document,
): FocusRestore => {
  const openerRef = useRef<HTMLElement | null>(
    ownerDocument
      ? (ownerDocument.activeElement as HTMLElement | null)
      : typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  const activatedRef = useRef(false);
  const restoredRef = useRef(false);
  // 재시도 rAF - 스케줄한 창과 함께 보관 (자식 창 rAF를 메인 창으로 취소하면 안 된다)
  const retryRef = useRef<{ view: Window; handle: number } | null>(null);

  const captureOpener = useCallback((container: HTMLElement) => {
    // 컨테이너가 분리 패널 창에 있으면 그 창의 activeElement가 opener다
    const activeElement = container.ownerDocument.activeElement;
    if (activatedRef.current && !container.contains(activeElement)) {
      openerRef.current = activeElement as HTMLElement | null;
    }
    activatedRef.current = true;
  }, []);

  const restoreFocus = useCallback(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const opener = openerRef.current;
    if (opener && opener.isConnected) {
      // 마우스 흐름의 닫힘에서는 버튼류 opener를 다시 잡지 않는다 -
      // 잔류 포커스가 다음 Space/Enter에 팝업을 도로 연다. 키보드(Escape 등)
      // 닫힘과 텍스트 입력 opener는 그대로 복원
      if (getLastInputModality() === 'pointer' && isPointerFocusRelease(opener))
        return;
      // 모달이 덮여 팝업이 닫힌 경우 잠긴 opener로 포커스를 되돌리면 모달에서
      // 포커스를 빼앗는다 (jsdom은 inert를 강제하지 않아 가드가 필요)
      if (!opener.closest('[inert]')) opener.focus();
      // 모달 종료 커밋에서 opener의 inert 해제가 한 번 늦으면 다음 frame에 재시도
      const doc = opener.ownerDocument;
      if (doc.activeElement !== opener) {
        const view = doc.defaultView;
        if (!view) return;
        // 스케줄 시점의 포커스 위치. 그새 사용자가 다른 곳을 잡았으면 뺏지 않는다 -
        // 같은 자리에 머물렀거나(닫히는 모달 안) body로 떨어진 경우만 재시도
        const activeAtSchedule = doc.activeElement;
        const handle = view.requestAnimationFrame(() => {
          retryRef.current = null;
          const active = doc.activeElement;
          if (
            active !== activeAtSchedule &&
            active !== doc.body &&
            active != null
          ) {
            return;
          }
          if (opener.isConnected && !opener.closest('[inert]')) opener.focus();
        });
        retryRef.current = { view, handle };
      }
    }
  }, []);

  // paint 전에 돌려놔야 포커스가 한 프레임 뜨지 않는다
  useLayoutEffect(() => {
    if (open) {
      // 닫히다 다시 열리면 가드를 풀어야 다음 닫힘에서도 복원된다.
      // 예약된 재시도는 버린다 - 다시 열린 팝업에서 포커스가 opener로 튕기면 안 된다
      restoredRef.current = false;
      const retry = retryRef.current;
      if (retry) {
        retry.view.cancelAnimationFrame(retry.handle);
        retryRef.current = null;
      }
      return;
    }
    restoreFocus();
  }, [open, restoreFocus]);

  // 닫기 신호 없이 사라지는 경로(부모가 통째로 언마운트) 폴백.
  // 예약된 재시도 참조는 놓아준다 - 닫힌 자식 창을 붙들지 않게
  useLayoutEffect(
    () => () => {
      restoreFocus();
      retryRef.current = null;
    },
    [restoreFocus],
  );

  return { openerRef, captureOpener, restoreFocus };
};
