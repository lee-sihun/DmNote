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
import { isTopmostPopupLayer, registerPopupLayer } from './popupLayer';

interface FloatingPopupBaseProps {
  open: boolean;
  ariaLabel: string;
  referenceRef?: React.RefObject<HTMLElement>;
  placement?: string;
  offset?: number;
  offsetX?: number;
  offsetY?: number;
  fixedX?: number;
  fixedY?: number;
  interactiveRefs?: Array<React.RefObject<HTMLElement>>;
  onClose: () => void;
  className?: string;
  children?: React.ReactNode;
  autoClose?: boolean;
  closeOnScroll?: boolean; // 스크롤 시 닫을지 여부
  portalToBody?: boolean;
  animate?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  focusOriginRef?: React.MutableRefObject<HTMLElement | null>;
}

interface FloatingDialogPopupProps extends FloatingPopupBaseProps {
  role?: 'dialog';
  onMenuTab?: never;
}

interface FloatingMenuPopupProps extends FloatingPopupBaseProps {
  role: 'menu';
  onMenuTab: (event: KeyboardEvent) => void;
}

type FloatingPopupProps = FloatingDialogPopupProps | FloatingMenuPopupProps;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.closest('[hidden], [aria-hidden="true"]') &&
      element.getAttribute('aria-disabled') !== 'true',
  );

interface FloatingPopupSurfaceProps {
  setFloating: (node: HTMLDivElement | null) => void;
  style: React.CSSProperties;
  className: string;
  role: 'dialog' | 'menu';
  ariaLabel: string;
  onMenuTab?: (event: KeyboardEvent) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  focusOriginRef?: React.MutableRefObject<HTMLElement | null>;
  children?: React.ReactNode;
}

const FloatingPopupSurface = ({
  setFloating,
  style,
  className,
  role,
  ariaLabel,
  onMenuTab,
  onKeyDown,
  focusOriginRef,
  children,
}: FloatingPopupSurfaceProps) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null,
  );

  // 자식 팝업은 부모 모달의 layout 등록 뒤에 쌓여야 하므로 passive effect 사용
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    return registerPopupLayer(surface);
  }, []);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (focusOriginRef) {
      focusOriginRef.current = prevFocusedRef.current;
    }
    if (surface.contains(document.activeElement)) return;
    const initialTarget =
      role === 'menu'
        ? surface.querySelector<HTMLElement>(
            '[role^="menuitem"]:not(:disabled)',
          ) ?? surface
        : getFocusableElements(surface)[0] ?? surface;
    initialTarget.focus();
  }, [focusOriginRef, role]);

  useLayoutEffect(() => {
    const prevFocused = prevFocusedRef.current;
    return () => {
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const surface = surfaceRef.current;
      if (!isTopmostPopupLayer(surface)) return;

      if (role === 'menu') {
        onMenuTab?.(event);
        return;
      }

      event.preventDefault();
      const focusable = getFocusableElements(surface);
      if (focusable.length === 0) {
        surface.focus();
        return;
      }

      const activeIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const nextIndex =
        activeIndex < 0
          ? event.shiftKey
            ? focusable.length - 1
            : 0
          : (activeIndex + (event.shiftKey ? -1 : 1) + focusable.length) %
            focusable.length;
      focusable[nextIndex].focus();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onMenuTab, role]);

  return (
    <div
      ref={(node) => {
        setFloating(node);
        surfaceRef.current = node;
      }}
      style={style}
      className={className}
      role={role}
      aria-label={ariaLabel}
      aria-modal={role === 'dialog' ? false : undefined}
      data-dmn-popup-layer="true"
      data-dmn-floating-popup="true"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
};

const FloatingPopup = ({
  open,
  ariaLabel,
  role = 'dialog',
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
  onKeyDown,
  onMenuTab,
  focusOriginRef,
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

  // Escape 소유는 autoClose와 무관 — 한 번에 한 겹씩 닫힘.
  // 위에 body 포털 서브메뉴가 떠 있으면 그쪽이 상위 레이어이므로 양보
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!isTopmostPopupLayer(floatingRef.current)) return;
      // 이 레이어가 소비 — 하위 레이어(페이지·그리드 선택)로 내려가지 않게
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && autoClose) {
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
        // 온캔버스 그라데이션 핸들 조작도 팝업 편집의 연장 — 닫힘 예외
        const isInsideGradientOverlay =
          target instanceof Element &&
          !!target.closest('[data-dmn-gradient-overlay="true"]');
        if (isInsideGradientOverlay) return;
        onClose();
      };

      document.addEventListener('mousedown', onClickAway);
      return () => {
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
      onClose();
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

      // 온캔버스 그라데이션 핸들 조작도 팝업 편집의 연장 — 닫힘 예외
      const isInsideGradientOverlay =
        target instanceof Element &&
        !!target.closest('[data-dmn-gradient-overlay="true"]');
      if (isInsideGradientOverlay) {
        pointerCapturedInside = false;
        return;
      }

      if (pointerCapturedInside) {
        return;
      }

      onClose();
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
    <FloatingPopupSurface
      setFloating={(node) => {
        refs.setFloating(node);
        floatingRef.current = node;
      }}
      style={{
        position: isFixed ? 'fixed' : strategy,
        left,
        top,
      }}
      className={`${className}${animate ? ' animate-popup-fade' : ''}`}
      role={role}
      ariaLabel={ariaLabel}
      onMenuTab={onMenuTab}
      onKeyDown={onKeyDown}
      focusOriginRef={focusOriginRef}
    >
      {children}
    </FloatingPopupSurface>
  );

  // 위치 계산 전후에 렌더 루트가 바뀌지 않도록 필요 시 처음부터 body에 렌더링
  if (portalToBody || isFixed) {
    return createPortal(floatingContent, document.body);
  }

  return floatingContent;
};

export default FloatingPopup;
