import React from 'react';

interface ListAddRowProps {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** 행에 앵커된 메뉴의 기준점용 */
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** 캡처 대기처럼 진행 문구로 바뀌는 상태 */
  active?: boolean;
  activeLabel?: string;
  /** sm: 팝업 행(23px), md: 패널 행(30px) */
  size?: 'sm' | 'md';
}

// 리스트의 추가 행 공용 컨트롤 - 플랫 행 문법
const ListAddRow = ({
  label,
  onClick,
  buttonRef,
  active = false,
  activeLabel,
  size = 'md',
}: ListAddRowProps) => {
  const showActiveLabel = active && Boolean(activeLabel);
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={showActiveLabel ? activeLabel : label}
      className={`flex items-center gap-[6px] shrink-0 px-[8px] rounded-md text-left transition-colors duration-fast ${
        size === 'sm'
          ? 'h-[23px] text-body'
          : 'h-[var(--dmn-picker-row-h,30px)] text-label'
      } ${
        active
          ? 'bg-fill-hover text-fg'
          : 'text-fg-muted hover:bg-fill hover:text-fg'
      }`}
    >
      {/* 마크 7px, 굵기 1.2 - 탭 추가 행과 같은 글리프 */}
      {!showActiveLabel && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className="shrink-0"
          aria-hidden="true"
        >
          <path
            d="M5 1.5V8.5M1.5 5H8.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className="min-w-0 truncate">
        {showActiveLabel ? activeLabel : label}
      </span>
    </button>
  );
};

export default ListAddRow;
