import React from 'react';

interface AddIconButtonProps {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** 버튼에 앵커된 메뉴의 기준점용 */
  buttonRef?: React.RefObject<HTMLButtonElement>;
  /** 배치용 클래스 — 정렬·여백은 부모가 소유 */
  className?: string;
}

// 30px 추가 아이콘 버튼 공용 컨트롤
const AddIconButton = ({
  label,
  onClick,
  buttonRef,
  className = '',
}: AddIconButtonProps) => (
  <button
    ref={buttonRef}
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className={`w-[30px] h-[30px] rounded-surface shrink-0 flex items-center justify-center bg-fill hover:bg-fill-hover active:bg-fill-active text-fg-muted hover:text-fg transition-colors duration-fast ${className}`.trim()}
  >
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
      <path
        d="M4 1V7M1 4H7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  </button>
);

export default AddIconButton;
