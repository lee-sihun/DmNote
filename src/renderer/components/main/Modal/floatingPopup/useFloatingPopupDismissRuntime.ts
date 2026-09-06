import { useEffect } from 'react';
import type React from 'react';

import { isInsideHigherPopupLayer } from '../popupLayer';
import { isElementNode } from '@utils/dom/isElementNode';
import {
  getPopupDragSessionState,
  subscribePopupDragSession,
} from '@utils/ui/popupDragSession';

interface FloatingPopupAutoDismissRuntimeOptions {
  open: boolean;
  autoClose: boolean;
  onClose: () => void;
  referenceRef?: React.RefObject<HTMLElement>;
  refs: { floating: React.RefObject<HTMLElement | null> };
  ownerDocument: Document;
}

export const useFloatingPopupAutoDismissRuntime = ({
  open,
  autoClose,
  onClose,
  referenceRef,
  refs,
  ownerDocument,
}: FloatingPopupAutoDismissRuntimeOptions) => {
  useEffect(() => {
    if (open && autoClose) {
      let pendingCloseCleanup: (() => void) | null = null;
      const onClickAway = (e: MouseEvent) => {
        const target = e.target as Node;
        if (!refs.floating.current) return;
        if (
          refs.floating.current.contains(target) ||
          (referenceRef &&
            referenceRef.current &&
            referenceRef.current.contains(target))
        )
          return;
        // 모달이 열린 상태에서 모달 내부 클릭으로 팝업이 닫히는 것을 방지
        // (Modal은 body로 portal 렌더링되기 때문에 floating 내부로 인식되지 않음)
        const isInsideModal =
          isElementNode(target) &&
          !!target.closest('[data-dmn-modal-backdrop="true"]');
        if (isInsideModal) return;
        // 서브메뉴도 body 포털이라 floating 내부로 인식되지 않음 — 닫힘 예외
        const isInsideSubMenu =
          isElementNode(target) &&
          !!target.closest('[data-dmn-popup-submenu="true"]');
        if (isInsideSubMenu) return;
        // 드래그 후보는 클릭인지 실제 드래그인지 확정될 때까지 닫기 보류
        const dragState = getPopupDragSessionState();
        if (dragState === 'active') return;
        if (dragState === 'pending') {
          pendingCloseCleanup?.();
          pendingCloseCleanup = subscribePopupDragSession((state) => {
            if (state === 'pending') return;
            pendingCloseCleanup?.();
            pendingCloseCleanup = null;
            if (state === 'idle') onClose();
          });
          return;
        }

        // 온캔버스 편집 오버레이(그라데이션 축·자세 기즈모)는 닫힘 예외
        const isInsideCanvasEditor =
          isElementNode(target) &&
          !!target.closest('[data-dmn-canvas-editor-overlay="true"]');
        if (isInsideCanvasEditor) return;
        // 위에 쌓인 팝업(자식 피커 등)은 body 포털이라 floating 내부로 인식되지 않음
        if (isInsideHigherPopupLayer(refs.floating.current, target)) return;
        onClose();
      };

      ownerDocument.addEventListener('mousedown', onClickAway);
      return () => {
        pendingCloseCleanup?.();
        ownerDocument.removeEventListener('mousedown', onClickAway);
      };
    }
  }, [open, autoClose, onClose, referenceRef, refs.floating, ownerDocument]);
};

interface FloatingPopupPersistentDismissRuntimeOptions {
  open: boolean;
  autoClose: boolean;
  onClose: () => void;
  referenceRef?: React.RefObject<HTMLElement>;
  interactiveRefs: Array<React.RefObject<HTMLElement>>;
  floatingRef: React.RefObject<HTMLDivElement | null>;
  ownerDocument: Document;
}

export const useFloatingPopupPersistentDismissRuntime = ({
  open,
  autoClose,
  onClose,
  referenceRef,
  interactiveRefs,
  floatingRef,
  ownerDocument,
}: FloatingPopupPersistentDismissRuntimeOptions) => {
  useEffect(() => {
    if (!open || autoClose) return;

    let pointerCapturedInside = false;
    let closeRequested = false;

    const referenceEl = referenceRef?.current ?? null;

    const _handlePointerDownInside = () => {
      pointerCapturedInside = true;
    };

    const handlePointerUp = () => {
      pointerCapturedInside = false;
    };

    const handleDocumentDown = (event: PointerEvent) => {
      if (closeRequested) return;
      const target = event.target as Node;
      // floatingRef.current를 이벤트 발생 시점에 동적으로 참조
      const floatingEl = floatingRef.current;
      const interactiveEls = interactiveRefs
        .map((r) => r?.current)
        .filter(Boolean) as HTMLElement[];
      const isInsideModal =
        isElementNode(target) &&
        !!target.closest('[data-dmn-modal-backdrop="true"]');

      if (!floatingEl) return;

      const isInsideFloating = floatingEl.contains(target);
      const isInsideReference = referenceEl?.contains(target) ?? false;
      const isInsideInteractive = interactiveEls.some((el) =>
        el.contains(target as Node),
      );

      if (isInsideFloating) {
        pointerCapturedInside = true;
        return;
      }

      if (
        pointerCapturedInside &&
        (event.type === 'pointerdown' || event.type === 'mousedown')
      ) {
        pointerCapturedInside = false;
      }

      if (isInsideReference || isInsideInteractive) {
        pointerCapturedInside = false;
        return;
      }

      // 모달이 열린 상태에서 모달 내부 클릭으로 팝업이 닫히는 것을 방지.
      // (Modal은 body로 portal 렌더링되기 때문에 단순 z-index로는 해결이 안 됨)
      if (isInsideModal) {
        pointerCapturedInside = false;
        return;
      }

      // 서브메뉴·포털 드롭다운도 body 포털이라 floating 내부로 인식되지 않음
      const isInsideSubMenu =
        isElementNode(target) &&
        !!target.closest('[data-dmn-popup-submenu="true"]');
      if (isInsideSubMenu) {
        pointerCapturedInside = false;
        return;
      }

      // 이미 승격된 드래그가 다른 팝업 표면을 오갈 때만 유지
      if (getPopupDragSessionState() === 'active') {
        pointerCapturedInside = false;
        return;
      }

      // 온캔버스 편집 오버레이(그라데이션 축·자세 기즈모) 조작도 팝업 편집의
      // 연장이라 닫힘 예외 - 캔버스에 있을 뿐 팝업 밖 클릭이 아니다
      const isInsideCanvasEditor =
        isElementNode(target) &&
        !!target.closest('[data-dmn-canvas-editor-overlay="true"]');
      if (isInsideCanvasEditor) {
        pointerCapturedInside = false;
        return;
      }

      // 위에 쌓인 팝업(자식 피커 등)은 body 포털이라 floating 내부로 인식되지 않음
      if (isInsideHigherPopupLayer(floatingEl, target)) {
        pointerCapturedInside = false;
        return;
      }

      if (pointerCapturedInside) {
        return;
      }

      closeRequested = true;
      onClose();
    };

    // 이벤트 리스너는 document에만 등록 (floatingEl은 동적으로 참조)
    ownerDocument.addEventListener('pointerup', handlePointerUp, true);
    ownerDocument.addEventListener('pointerdown', handleDocumentDown, true);
    ownerDocument.addEventListener('mousedown', handleDocumentDown, true);

    return () => {
      ownerDocument.removeEventListener('pointerup', handlePointerUp, true);
      ownerDocument.removeEventListener(
        'pointerdown',
        handleDocumentDown,
        true,
      );
      ownerDocument.removeEventListener('mousedown', handleDocumentDown, true);
    };
    // 원본 useRef 의존성 계약 유지 - 이벤트 시점 current 동적 참조
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoClose, onClose, referenceRef, interactiveRefs, ownerDocument]);
};
