import React from "react";

interface ModalProps {
  onClick?: () => void;
  children: React.ReactNode;
}

export default function Modal({ onClick, children }: ModalProps) {
  return (
    <div
      className="fixed top-[40px] left-[1px] flex items-center justify-center w-[900px] h-[387px] bg-[#000000] bg-opacity-70 z-50 opacity-0 animate-modal-fade"
      onClick={onClick}
    >
      <div className="animate-modal-scale">{children}</div>
    </div>
  );
}
