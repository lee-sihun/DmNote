import React from 'react';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  /** 배치용 클래스 — 폭·여백은 부모가 소유 */
  className?: string;
}

// 돋보기 + 인셋 필드 검색 인풋 공용 컨트롤
const SearchField = ({
  value,
  onChange,
  placeholder,
  onKeyDown,
  className = '',
}: SearchFieldProps) => (
  <div className={`relative ${className}`.trim()}>
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="absolute left-[10px] top-1/2 -translate-y-1/2 text-fg-faint pointer-events-none"
    >
      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 8L10.5 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full h-[30px] pl-[30px] pr-[10px] bg-inset rounded-surface text-fg text-body placeholder-fg-faint focus:shadow-focus-ring outline-none transition-shadow duration-fast"
    />
  </div>
);

export default SearchField;
