import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  onClick?: () => void;
  children: React.ReactNode;
  animate?: boolean;
}

const Modal = ({ onClick, children, animate = true }: ModalProps) => {
  const scrimAnimClass = animate ? 'animate-modal-scrim' : '';
  const contentAnimClass = animate ? 'animate-modal-scale' : '';
  const closeFromBackdropRef = useRef(false);

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
      data-dmn-modal-backdrop="true"
      className="fixed top-[31px] bottom-[61px] left-[1px] right-[1px] flex items-center justify-center z-50"
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
      onWheel={handleWheel}
    >
      {/* 스크림 언더레이 — 클릭은 래퍼로 통과 */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] pointer-events-none ${scrimAnimClass}`}
      />
      <div className={`relative ${contentAnimClass}`}>{children}</div>
    </div>,
    document.body,
  );
};

export default Modal;
