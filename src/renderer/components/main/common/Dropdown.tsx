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
  /** 트리거/메뉴 너비 고정용 Tailwind 클래스 (예: 'w-[160px]'). 길면 말줄임(...) 처리됨 */
  widthClass?: string;
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
  widthClass = '',
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

      // 드롭다운 메뉴 예상 높이 (옵션당 26px + padding)
      const estimatedMenuHeight = Math.min(options.length * 26 + 8, 200);

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
      className={`relative ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {iconTrigger ? (
        <button
          ref={buttonRef}
          type="button"
          className={`flex items-center justify-center w-[24px] h-[24px] rounded-md border cursor-pointer transition-colors duration-fast ${
            open
              ? 'border-accent bg-surface'
              : 'border-line bg-surface hover:border-line-strong'
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
          className={`flex box-border items-center justify-between h-[24px] px-[8px] bg-surface border rounded-md text-fg text-body transition-colors duration-fast ${
            open ? 'border-accent' : 'border-line hover:border-line-strong'
          } ${fullWidth ? 'w-full' : ''} ${widthClass}`}
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
        >
          <span className={`truncate ${!selected ? 'text-fg-muted' : ''}`}>
            {selected ? selected.label : placeholder}
          </span>
          <svg
            width="8"
            height="5"
            viewBox="0 0 14 8"
            fill="none"
            className={`ml-[5px] shrink-0 text-fg-muted transition-transform duration-base ease-out-expo ${
              open ? 'rotate-180' : 'rotate-0'
            }`}
          >
            <path
              d="M1 1L7 7L13 1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {open && (
        <div
          className={`absolute flex flex-col p-[4px] gap-[1px] bg-elevated border border-line rounded-lg shadow-elevation-2 z-20 overflow-x-hidden overflow-y-auto max-h-[200px] tooltip-fade-in ${
            fullWidth
              ? 'left-0 right-0'
              : align === 'right'
              ? 'right-0'
              : align === 'center'
              ? 'left-1/2 -translate-x-1/2'
              : 'left-0'
          } ${widthClass} ${openUpward ? 'bottom-[28px]' : 'top-[28px]'}`}
        >
          {options.length === 0 ? (
            <div className="px-[8px] py-[6px] text-body text-fg-faint">
              옵션 없음
            </div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`text-left w-full h-[24px] px-[8px] rounded-[6px] text-body transition-colors duration-fast flex items-center ${
                  value === opt.value
                    ? 'bg-surface-active text-fg pointer-events-none'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
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
