import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

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
      // 모달이 덮여 팝업이 닫힌 경우 잠긴 opener로 포커스를 되돌리면 모달에서
      // 포커스를 빼앗는다 (jsdom은 inert를 강제하지 않아 가드가 필요)
      if (!opener.closest('[inert]')) opener.focus();
      // 모달 종료 커밋에서 opener의 inert 해제가 한 번 늦으면 다음 frame에 재시도
      if (opener.ownerDocument.activeElement !== opener) {
        opener.ownerDocument.defaultView?.requestAnimationFrame(() => {
          if (opener.isConnected && !opener.closest('[inert]')) opener.focus();
        });
      }
    }
  }, []);

  // paint 전에 돌려놔야 포커스가 한 프레임 뜨지 않는다
  useLayoutEffect(() => {
    if (open) {
      // 닫히다 다시 열리면 가드를 풀어야 다음 닫힘에서도 복원된다
      restoredRef.current = false;
      return;
    }
    restoreFocus();
  }, [open, restoreFocus]);

  // 닫기 신호 없이 사라지는 경로(부모가 통째로 언마운트) 폴백
  useLayoutEffect(() => restoreFocus, [restoreFocus]);

  return { openerRef, captureOpener, restoreFocus };
};
