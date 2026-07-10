/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  offset as fuiOffset,
  shift,
  flip,
  autoUpdate,
  type Placement,
} from '@floating-ui/react';

type FloatingPopupProps = {
  open: boolean;
  referenceRef?: React.RefObject<HTMLElement>;
  placement?: string;
  offset?: number;
  offsetX?: number;
  offsetY?: number;
  fixedX?: number;
  fixedY?: number;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
  onClose?: () => void;
  className?: string;
  children?: React.ReactNode;
  autoClose?: boolean;
  closeOnScroll?: boolean; // 스크롤 시 닫을지 여부
  portalToBody?: boolean;
  animate?: boolean;
};

const FloatingPopup = ({
  open,
  referenceRef,
  placement = 'top',
  offset = 20,
  offsetX = 0,
  offsetY = 0,
  fixedX,
  fixedY,
  interactiveRefs = [],
  onClose,
  className = '',
  children,
  autoClose = true,
  closeOnScroll = false,
  portalToBody = false,
  animate = true,
}: FloatingPopupProps) => {
  const { x, y, refs, strategy, update } = useFloating({
    placement: placement as Placement,
    middleware: [fuiOffset(offset), shift(), flip()],
    whileElementsMounted: autoUpdate,
  });

  const floatingRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (referenceRef && referenceRef.current)
      refs.setReference(referenceRef.current);
  }, [referenceRef, refs.setReference]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && autoClose) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose?.();
      };

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
          target instanceof Element &&
          !!target.closest('[data-dmn-modal-backdrop="true"]');
        if (isInsideModal) return;
        // 서브메뉴도 body 포털이라 floating 내부로 인식되지 않음 — 닫힘 예외
        const isInsideSubMenu =
          target instanceof Element &&
          !!target.closest('[data-dmn-popup-submenu="true"]');
        if (isInsideSubMenu) return;
        onClose?.();
      };

      document.addEventListener('keydown', onKey);
      document.addEventListener('mousedown', onClickAway);
      return () => {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('mousedown', onClickAway);
      };
    }
  }, [open, autoClose, onClose, referenceRef, refs.floating]);

  useEffect(() => {
    if (open) update?.();
  }, [open, update]);

  // closeOnScroll: 스크롤 시 팝업 닫기
  useEffect(() => {
    if (!open || !closeOnScroll) return;

    const handleScroll = () => {
      onClose?.();
    };

    // 캡처 단계에서 모든 스크롤 이벤트 감지
    document.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, closeOnScroll, onClose]);

  // 고정 좌표 사용 시 메뉴 위치를 조정
  useLayoutEffect(() => {
    if (
      !open ||
      !floatingRef.current ||
      typeof fixedX !== 'number' ||
      typeof fixedY !== 'number'
    ) {
      setAdjustedPos(null);
      return;
    }

    const rect = floatingRef.current.getBoundingClientRect();

    let adjustedX = fixedX + offsetX;
    let adjustedY = fixedY + offsetY;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = rect.width;
    const menuHeight = rect.height;
    const padding = 5; // 창 가장자리로부터의 패딩

    // 오른쪽 경계를 벗어나면 왼쪽으로 이동
    if (adjustedX + menuWidth > viewportWidth - padding) {
      adjustedX = viewportWidth - menuWidth - padding;
    }

    // 아래쪽 경계를 벗어나면 위쪽으로 이동
    if (adjustedY + menuHeight > viewportHeight - padding) {
      adjustedY = viewportHeight - menuHeight - padding;
    }

    // 왼쪽 경계를 벗어나면 최소 padding 위치로 조정
    if (adjustedX < padding) {
      adjustedX = padding;
    }

    // 위쪽 경계를 벗어나면 최소 padding 위치로 조정
    if (adjustedY < padding) {
      adjustedY = padding;
    }

    setAdjustedPos((prev) => {
      if (prev?.x === adjustedX && prev.y === adjustedY) return prev;
      return { x: adjustedX, y: adjustedY };
    });
  }, [open, fixedX, fixedY, offsetX, offsetY]);

  useEffect(() => {
    if (!open || autoClose) return;

    let pointerCapturedInside = false;

    const referenceEl = referenceRef?.current ?? null;

    const _handlePointerDownInside = () => {
      pointerCapturedInside = true;
    };

    const handlePointerUp = () => {
      pointerCapturedInside = false;
    };

    const handleDocumentDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // floatingRef.current를 이벤트 발생 시점에 동적으로 참조
      const floatingEl = floatingRef.current;
      const interactiveEls = interactiveRefs
        .map((r) => r?.current)
        .filter(Boolean) as HTMLElement[];
      const isInsideModal =
        target instanceof Element &&
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
        target instanceof Element &&
        !!target.closest('[data-dmn-popup-submenu="true"]');
      if (isInsideSubMenu) {
        pointerCapturedInside = false;
        return;
      }

      if (pointerCapturedInside) {
        return;
      }

      onClose?.();
    };

    // 이벤트 리스너는 document에만 등록 (floatingEl은 동적으로 참조)
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointerdown', handleDocumentDown, true);
    document.addEventListener('mousedown', handleDocumentDown, true);

    return () => {
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointerdown', handleDocumentDown, true);
      document.removeEventListener('mousedown', handleDocumentDown, true);
    };
  }, [open, autoClose, onClose, referenceRef, interactiveRefs]);

  if (!open) return null;

  const isFixed = typeof fixedX === 'number' && typeof fixedY === 'number';

  // 고정 좌표를 사용할 때는 조정된 위치, 아니면 기본 위치를 사용합
  let left: number;
  let top: number;

  if (isFixed && adjustedPos) {
    left = adjustedPos.x;
    top = adjustedPos.y;
  } else if (isFixed) {
    // adjustedPos 계산 대기 중이면 기본 위치 사용
    left = (fixedX as number) + offsetX;
    top = (fixedY as number) + offsetY;
  } else {
    left = (x ?? 0) + offsetX;
    top = (y ?? 0) + offsetY;
  }

  const floatingContent = (
    <div
      ref={(node) => {
        refs.setFloating(node);
        floatingRef.current = node;
      }}
      style={{
        position: isFixed ? 'fixed' : strategy,
        left,
        top,
      }}
      className={`${className}${animate ? ' tooltip-fade-in' : ''}`}
      role="dialog"
      aria-modal="false"
    >
      {children}
    </div>
  );

  // 위치 계산 전후에 렌더 루트가 바뀌지 않도록 필요 시 처음부터 body에 렌더링
  if (portalToBody || isFixed) {
    return createPortal(floatingContent, document.body);
  }

  return floatingContent;
};

export default FloatingPopup;
