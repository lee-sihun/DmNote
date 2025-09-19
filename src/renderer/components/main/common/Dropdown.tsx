import React, { useState, useRef, useEffect } from "react";

interface DropdownOption {
  label: string;
  value: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const Dropdown: React.FC<DropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = "선택",
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const selected = options.find((opt) => opt.value === value);

  return (
    <div
      ref={ref}
      className={`relative ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <button
        type="button"
        className="flex box-border items-center justify-between py-[0px] px-[8px] bg-[#2A2A31] border-[1px] border-[#3A3944] rounded-[7px] text-[#DBDEE8] text-style-2 !leading-[23px] outline-none"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <span className={`truncate ${!selected ? "text-[#DBDEE8]" : ""}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          width="8"
          height="5"
          viewBox="0 0 14 8"
          fill="none"
          className={`ml-[5px] transition-transform duration-200 ${
            open ? "rotate-180" : "rotate-0"
          }`}
        >
          <path
            d="M1 1L7 7L13 1"
            stroke="#DBDEE8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-[26px] flex flex-col justify-center items-center p-[1px] bg-[#2A2A31] border-[1px] border-[#3A3944] rounded-[7px] z-20 overflow-hidden gap-[2px]">
          {options.length === 0 ? (
            <div className="px-4 py-3 text-[#9AA0AA] text-[18px] font-medium">
              옵션 없음
            </div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`text-left w-full px-[13px] py-[0px] rounded-[7px] text-style-2 text-[#DBDEE8] !leading-[23px] transition-colors duration-100 flex items-center bg-[#2A2A31] hover:bg-[#24232A] ${
                  value === opt.value ? "!bg-[#24232A] pointer-events-none" : ""
                }`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="truncate">{opt.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default Dropdown;
