import React, { useState, useRef, useEffect } from 'react';

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
  /** true일 경우 드롭다운이 부모 컨테이너의 전체 너비를 차지함 */
  fullWidth?: boolean;
  /** 아이콘 트리거 모드: 설정 시 버튼이 아이콘으로 표시됨 */
  iconTrigger?: React.ReactNode;
  /** 메뉴 수평 정렬 (기본: left) */
  align?: 'left' | 'center' | 'right';
}

const Dropdown: React.FC<DropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = '선택',
  disabled = false,
  fullWidth = false,
  iconTrigger,
  align = 'left',
}) => {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 드롭다운 열릴 때 위치 계산
  useEffect(() => {
    if (open && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // 하단 메뉴 높이 고려 (약 50px)
      const bottomPadding = 60;

      // 드롭다운 메뉴 예상 높이 (옵션당 25px + padding)
      const estimatedMenuHeight = Math.min(options.length * 25 + 4, 200);

      // 버튼 아래 공간이 부족하면 위로 펼치기
      const spaceBelow = viewportHeight - buttonRect.bottom - bottomPadding;
      setOpenUpward(spaceBelow < estimatedMenuHeight);
    }
  }, [open, options.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const selected = options.find((opt) => opt.value === value);

  return (
    <div
      ref={ref}
      className={`relative ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {iconTrigger ? (
        <button
          ref={buttonRef}
          type="button"
          className={`flex items-center justify-center w-[23px] h-[23px] rounded-[7px] border-[1px] cursor-pointer transition-colors ${
            open
              ? 'border-[#459BF8] bg-[#2A2A31]'
              : 'border-[#3A3943] bg-[#2A2A31] hover:border-[#505058]'
          }`}
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
        >
          {iconTrigger}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className={`flex box-border items-center justify-between h-[23px] py-[0px] px-[8px] bg-[#2A2A31] border-[1px] border-[#3A3944] rounded-[7px] text-[#DBDEE8] text-style-2 outline-none ${
            fullWidth ? 'w-full' : ''
          }`}
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
        >
          <span
            className={`truncate leading-[23px] ${
              !selected ? 'text-[#DBDEE8]' : ''
            }`}
          >
            {selected ? selected.label : placeholder}
          </span>
          <svg
            width="8"
            height="5"
            viewBox="0 0 14 8"
            fill="none"
            className={`ml-[5px] transition-transform duration-200 ${
              open ? 'rotate-180' : 'rotate-0'
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
      )}
      {open && (
        <div
          className={`absolute flex flex-col justify-center items-center p-[1px] bg-[#2A2A31] border-[1px] border-[#3A3944] rounded-[7px] z-20 overflow-x-hidden overflow-y-auto gap-[2px] max-h-[200px] ${
            fullWidth
              ? 'left-0 right-0'
              : align === 'right'
              ? 'right-0'
              : align === 'center'
              ? 'left-1/2 -translate-x-1/2'
              : 'left-0'
          } ${openUpward ? 'bottom-[25px]' : 'top-[25px]'}`}
        >
          {options.length === 0 ? (
            <div className="px-4 py-3 text-[#9AA0AA] text-[18px] font-medium">
              옵션 없음
            </div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`text-left w-full h-[23px] px-[13px] py-[0px] rounded-[7px] text-style-2 text-[#DBDEE8] transition-colors duration-100 flex items-center bg-[#2A2A31] hover:bg-[#24232A] ${
                  value === opt.value ? '!bg-[#24232A] pointer-events-none' : ''
                }`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="truncate leading-[23px]">{opt.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default Dropdown;
