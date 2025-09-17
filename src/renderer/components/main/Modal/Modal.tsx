import React from "react";

interface ModalProps {
  onClick?: () => void;
  children: React.ReactNode;
}

export default function Modal({ onClick, children }: ModalProps) {
  return (
    <div
      className="fixed top-[40px] left-[1px] flex items-center justify-center w-[900px] h-[387px] bg-[#000000] bg-opacity-50 backdrop-blur-[10px] z-50"
      onClick={onClick}
    >
      {children}
    </div>
  );
}
