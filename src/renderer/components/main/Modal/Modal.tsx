import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  onClick?: () => void;
  children: React.ReactNode;
  animate?: boolean;
  /** 스크린리더용 다이얼로그 이름 */
  ariaLabel?: string;
}

const Modal = ({
  onClick,
  children,
  animate = true,
  ariaLabel,
}: ModalProps) => {
  const scrimAnimClass = animate ? 'animate-modal-scrim' : '';
  const contentAnimClass = animate ? 'animate-modal-scale' : '';
  const closeFromBackdropRef = useRef(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClick);
  useEffect(() => {
    onCloseRef.current = onClick;
  });

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

  // 닫힐 때 열기 전 포커스 복원 (요소가 아직 문서에 연결된 경우만)
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    return () => {
      if (prevFocused && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };
  }, []);

  // Escape 닫기 — 레이어 소유권: 위 겹(팝업·서브메뉴·플로팅 피커)이 있으면 양보하고
  // 최상위 모달(마지막 마운트 백드롭)만 소비. 한 번에 한 겹씩 닫힘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // 키 리스닝 중엔 양보 — Escape는 리스닝 취소로 예약됨 (raw input 레이스 포함)
      if (window.__dmn_isKeyListening) return;
      // 서브메뉴·플러그인 드롭다운이 위에 떠 있으면 그쪽이 소유
      if (document.querySelector('[data-dmn-popup-submenu="true"]')) return;
      // FloatingPopup 계열(피커·컨텍스트 메뉴)이 위에 떠 있으면 그쪽이 소유
      if (document.querySelector('[role="dialog"][aria-modal="false"]')) return;
      // 모달 스택에서 최상위만 소비
      const backdrops = document.querySelectorAll(
        '[data-dmn-modal-backdrop="true"]',
      );
      if (backdrops[backdrops.length - 1] !== backdropRef.current) return;
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

  // 배경 블러는 모달의 조상이 아니라 형제 언더레이가 소유해야 함 —
  // 조상이 backdrop-filter를 가지면 backdrop root가 생겨 모달 글래스의
  // 블러가 WebKit에서 배경을 샘플링하지 못함. 형제 레이어는 정상 합성됨
  // 조상 opacity 애니메이션도 같은 이유로 금지 — opacity < 1인 조상이
  // backdrop root가 되어 페이드 동안 블러가 죽었다가 끝나는 순간 튐.
  // 그래서 animate-modal-scale은 래퍼가 아닌 직계 자식(> *)에 적용되고,
  // 등장 모션은 스크림(틴트+블러 키프레임)과 콘텐츠 루트가 각자 소유한다
  return createPortal(
    <div
      ref={backdropRef}
      data-dmn-modal-backdrop="true"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed top-[31px] bottom-[61px] left-[1px] right-[1px] flex items-center justify-center z-50"
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
      onWheel={handleWheel}
    >
      {/* 스크림 언더레이 — 클릭은 래퍼로 통과 */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] pointer-events-none ${scrimAnimClass}`}
      />
      <div className={`relative ${contentAnimClass}`}>{children}</div>
    </div>,
    document.body,
  );
};

export default Modal;
