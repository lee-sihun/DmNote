import React from "react";

interface ModalProps {
  onClick?: () => void;
  children: React.ReactNode;
  animate?: boolean;
}

export default function Modal({ onClick, children, animate = true }: ModalProps) {
  const backdropAnimClass = animate ? "opacity-0 animate-modal-fade" : "opacity-100";
  const contentAnimClass = animate ? "animate-modal-scale" : "";

  return (
    <div
      className={`fixed top-[40px] left-[1px] flex items-center justify-center w-[900px] h-[387px] bg-[#000000] bg-opacity-70 z-50 ${backdropAnimClass}`}
      onClick={onClick}
    >
      <div className={contentAnimClass}>{children}</div>
    </div>
  );
}
