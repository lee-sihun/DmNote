import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

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
  /** 트리거 높이 클래스 (기본 h-[24px]) */
  heightClass?: string;
  /** 트리거 수평 패딩 클래스 (기본 px-[8px]) */
  paddingXClass?: string;
  /** 트리거 라운딩 클래스 (기본 rounded-md) */
  roundedClass?: string;
}

interface MenuPosition {
  left: number;
  top?: number;
  bottom?: number;
  width?: number;
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
  heightClass = 'h-[24px]',
  paddingXClass = 'px-[8px]',
  roundedClass = 'rounded-md',
}) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 메뉴는 body로 포털 — 패널/모달의 backdrop-filter·mask 아래에서는
  // 중첩 backdrop-blur가 무력화되므로 backdrop root 밖에서 그린다
  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // 하단 메뉴 높이 고려 (약 50px)
      const bottomPadding = 60;

      // 드롭다운 메뉴 예상 높이 (아이템 24 + 갭 4 리듬, padding 포함)
      const estimatedMenuHeight = Math.min(options.length * 28 + 4, 200);

      // 버튼 아래 공간이 부족하면 위로 펼치기
      const spaceBelow = viewportHeight - rect.bottom - bottomPadding;
      const openUpward = spaceBelow < estimatedMenuHeight;

      const gap = 4;
      const vertical = openUpward
        ? { bottom: viewportHeight - rect.top + gap }
        : { top: rect.bottom + gap };

      if (fullWidth) {
        setMenuPos({ left: rect.left, width: rect.width, ...vertical });
      } else if (align === 'right') {
        setMenuPos({ left: rect.right, ...vertical });
      } else if (align === 'center') {
        setMenuPos({ left: rect.left + rect.width / 2, ...vertical });
      } else {
        setMenuPos({ left: rect.left, ...vertical });
      }
    }
    setOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // 트리거가 스크롤/리사이즈로 움직이면 좌표가 어긋나므로 닫는다
    // (메뉴 내부 스크롤은 제외)
    const handleScroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open]);

  const selected = options.find((opt) => opt.value === value);

  // 정렬 이동은 transform이 아니라 translate 속성 사용 —
  // tooltipFadeIn이 transform을 애니메이트해서 겹치면 안 됨
  const menuTranslate =
    !fullWidth && align === 'right'
      ? '-100%'
      : !fullWidth && align === 'center'
      ? '-50%'
      : undefined;

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            data-dmn-popup-submenu="true"
            className={`fixed flex flex-col p-[4px] gap-[4px] bg-glass backdrop-blur-[24px] rounded-[10px] shadow-elevation-2 z-[60] overflow-x-hidden overflow-y-auto max-h-[200px] tooltip-fade-in ${widthClass}`}
            style={{
              left: menuPos.left,
              top: menuPos.top,
              bottom: menuPos.bottom,
              width: menuPos.width,
              translate: menuTranslate,
            }}
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
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={ref}
      className={`relative ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {iconTrigger ? (
        <button
          ref={buttonRef}
          type="button"
          className={`flex items-center justify-center w-[24px] h-[24px] rounded-md cursor-pointer bg-fill hover:bg-fill-hover transition-colors duration-fast ${
            open ? 'shadow-focus-ring' : ''
          }`}
          onClick={toggleOpen}
          disabled={disabled}
        >
          {iconTrigger}
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className={`flex box-border items-center justify-between ${heightClass} ${paddingXClass} bg-fill hover:bg-fill-hover ${roundedClass} text-fg text-body transition-colors duration-fast ${
            open ? 'shadow-focus-ring' : ''
          } ${fullWidth ? 'w-full' : ''} ${widthClass}`}
          onClick={toggleOpen}
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
      {menu}
    </div>
  );
};

export default Dropdown;
