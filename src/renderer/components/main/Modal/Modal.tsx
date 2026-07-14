import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { isTopmostPopupLayer, registerPopupLayer } from './popupLayer';

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

interface ModalProps {
  onClick?: () => void;
  children: React.ReactNode;
  animate?: boolean;
  /** 스크린리더용 다이얼로그 이름 */
  ariaLabel?: string;
  /** 중앙 카드 대신 크롬 사이 영역을 통째로 덮는 전면 시트 */
  fullSurface?: boolean;
}

const Modal = ({
  onClick,
  children,
  animate = true,
  ariaLabel,
  fullSurface = false,
}: ModalProps) => {
  const scrimAnimClass = animate ? 'animate-modal-scrim' : '';
  // 전면 시트는 등장 애니메이션 없이 즉시 표시
  const contentAnimClass = animate && !fullSurface ? 'animate-modal-scale' : '';
  const closeFromBackdropRef = useRef(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClick);
  useEffect(() => {
    onCloseRef.current = onClick;
  });

  // 열기 전 포커스를 첫 렌더 시점에 캡처 — passive effect는 자식 autoFocus·
  // 자식 effect 이후에 실행돼 opener 대신 모달 내부 요소를 잡는 오염이 생긴다.
  // ref 초기화는 자식 마운트 전에 1회만 실행되므로 opener가 정확히 잡힘
  const prevFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null,
  );

  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    return registerPopupLayer(backdrop);
  }, []);

  useEffect(() => {
    const reset = () => {
      closeFromBackdropRef.current = false;
    };
    document.addEventListener('pointercancel', reset, true);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('pointercancel', reset, true);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // 자식 autoFocus를 존중하고, 지정이 없으면 첫 조작 요소로 포커스 이동
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop || backdrop.contains(document.activeElement)) return;
    const initialTarget = getFocusableElements(backdrop)[0] ?? backdrop;
    initialTarget.focus();
  }, []);

  // 닫힐 때 열기 전 포커스 복원 (요소가 아직 문서에 연결된 경우만)
  useEffect(() => {
    const prevFocused = prevFocusedRef.current;
    return () => {
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };
  }, []);

  // 최상위 모달만 Escape와 Tab 포커스 순환을 소유
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!isTopmostPopupLayer(backdropRef.current)) return;

      if (e.key === 'Tab') {
        const backdrop = backdropRef.current;
        if (!backdrop) return;
        const focusable = getFocusableElements(backdrop);
        if (focusable.length === 0) {
          e.preventDefault();
          backdrop.focus();
          return;
        }

        const active = document.activeElement;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!backdrop.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && (active === first || active === backdrop)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }

      if (e.key !== 'Escape') return;
      // 키 리스닝 중엔 양보 — Escape는 리스닝 취소로 예약됨 (raw input 레이스 포함)
      if (window.__dmn_isKeyListening) return;
      e.preventDefault();
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const handleBackdropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // only mark if pointer started directly on the backdrop
    closeFromBackdropRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // ignore clicks that bubbled up from content
    if (e.target !== e.currentTarget) return;
    // ignore clicks without a matching pointerDown on backdrop (e.g. window drag)
    if (!closeFromBackdropRef.current) return;
    closeFromBackdropRef.current = false;
    onClick?.();
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  // 스크림 딤은 모달의 조상이 아니라 형제 언더레이가 소유해야 함 —
  // 조상이 backdrop-filter나 반투명을 가지면 backdrop root가 생겨 모달 카드
  // 글래스의 블러가 WebKit에서 배경을 샘플링하지 못함. 형제 레이어는 정상 합성됨
  // 조상 opacity 애니메이션도 같은 이유로 금지 — opacity < 1인 조상이
  // backdrop root가 되어 페이드 동안 블러가 죽었다가 끝나는 순간 튐.
  // 그래서 animate-modal-scale은 래퍼가 아닌 직계 자식(> *)에 적용되고,
  // 등장 모션은 스크림(틴트 키프레임)과 콘텐츠 루트가 각자 소유한다
  // 스크림은 알파 딤만 — backdrop 블러는 풀스크린 재필터라 금지 (Windows 렉)
  return createPortal(
    <div
      ref={backdropRef}
      data-dmn-modal-backdrop="true"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      className="fixed top-[30px] bottom-[60px] left-0 right-0 flex items-center justify-center z-50"
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
      onWheel={handleWheel}
    >
      {/* 스크림 언더레이 — 클릭은 래퍼로 통과.
          전면 시트는 스크림 생략 — 시트가 영역을 다 덮어 어둡히기가 무의미하고,
          스크림이 겹치면 같은 글래스 토큰인데 사이드 패널보다 어둡게 합성됨 */}
      {!fullSurface && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 bg-black/60 pointer-events-none ${scrimAnimClass}`}
        />
      )}
      <div
        className={`${
          fullSurface ? 'absolute inset-0' : 'relative'
        } ${contentAnimClass}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
