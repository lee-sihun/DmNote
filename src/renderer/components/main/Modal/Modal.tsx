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
  const pointerDownInsideRef = useRef(false);

  useEffect(() => {
    const handlePointerUp = () => {
      if (!pointerDownInsideRef.current) return;
      setTimeout(() => {
        pointerDownInsideRef.current = false;
      }, 0);
    };

    document.addEventListener("pointerup", handlePointerUp, true);
    return () => {
      document.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, []);

  const handleBackdropClick = () => {
    if (pointerDownInsideRef.current) {
      return;
    }
    onClick?.();
  };

  const handleContentPointerDown = () => {
    pointerDownInsideRef.current = true;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  return createPortal(
    <div
      data-dmn-modal-backdrop="true"
      className={`fixed top-[31px] left-[1px] flex items-center justify-center w-[900px] h-[396px] bg-[#000000] bg-opacity-70 z-50 ${backdropAnimClass}`}
      onClick={handleBackdropClick}
      onWheel={handleWheel}
    >
      <div
        className={contentAnimClass}
        onPointerDown={handleContentPointerDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
