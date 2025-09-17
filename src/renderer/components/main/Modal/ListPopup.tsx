import React from "react";
import FloatingPopup from "./FloatingPopup";

export type ListItem = {
  id: string;
  label: string;
};

type ListPopupProps = {
  open: boolean;
  referenceRef?: React.RefObject<HTMLElement>;
  onClose?: () => void;
  items: ListItem[];
  onSelect?: (id: string) => void;
  className?: string;
};

const ListPopup = ({
  open,
  referenceRef,
  onClose,
  items,
  onSelect,
  className = "",
}: ListPopupProps) => {
  const defaultClassName =
    "z-30 bg-[#1A191E] rounded-[7px] p-[5px] flex flex-col gap-[5px]";
  const effectiveClassName = `${defaultClassName} ${className}`.trim();

  return (
    <FloatingPopup
      open={open}
      referenceRef={referenceRef}
      placement="top"
      offset={20}
      onClose={onClose}
      className={effectiveClassName}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => {
            onSelect(it.id);
            onClose?.();
          }}
          className="min-w-[108px] h-[24px] px-[24px] rounded-[7px] hover:bg-[#26262C] active:bg-[#2A2A31] flex items-center justify-center"
        >
          <span className="text-style-2 text-[#DBDEE8]">{it.label}</span>
        </button>
      ))}
    </FloatingPopup>
  );
};

export default ListPopup;
