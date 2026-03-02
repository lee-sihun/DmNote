import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  onClick?: () => void;
  children: React.ReactNode;
  animate?: boolean;
}

export default function Modal({
  onClick,
  children,
  animate = true,
}: ModalProps) {
  const backdropAnimClass = animate
    ? "opacity-0 animate-modal-fade"
    : "opacity-100";
  const contentAnimClass = animate ? "animate-modal-scale" : "";
  const closeFromBackdropRef = useRef(false);

  useEffect(() => {
    const reset = () => {
      closeFromBackdropRef.current = false;
    };
    document.addEventListener("pointercancel", reset, true);
    window.addEventListener("blur", reset);
    return () => {
      document.removeEventListener("pointercancel", reset, true);
      window.removeEventListener("blur", reset);
    };
  }, []);

  const handleBackdropPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
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

  return createPortal(
    <div
      data-dmn-modal-backdrop="true"
      className={`fixed top-[31px] left-[1px] flex items-center justify-center w-[900px] h-[396px] bg-[#000000] bg-opacity-70 z-50 ${backdropAnimClass}`}
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
      onWheel={handleWheel}
    >
      <div className={contentAnimClass}>{children}</div>
    </div>,
    document.body,
  );
}
