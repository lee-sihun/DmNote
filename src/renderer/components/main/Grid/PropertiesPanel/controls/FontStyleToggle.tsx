import React, { useRef } from 'react';
import type { FontStyleToggleProps } from '../types';
import { useOptimisticBooleanCommit } from '@hooks/useOptimisticBooleanCommit';

// ============================================================================
// 글꼴 스타일 아이콘
// ============================================================================

// 렌더 크기가 viewBox보다 1px 작아 스트로크 값이 제각각이다 - 넷 다 화면상 1.2

const BoldIcon: React.FC = () => (
  <svg width="9" height="11" viewBox="0 0 10 12" fill="none">
    <path
      d="M1 1H5.5C7.433 1 9 2.343 9 4C9 5.657 7.433 6 5.5 6H1V1Z"
      stroke="currentColor"
      strokeWidth="1.33"
      strokeLinejoin="round"
    />
    <path
      d="M1 6H6C8.209 6 9.5 7.343 9.5 9C9.5 10.657 8.209 11 6 11H1V6Z"
      stroke="currentColor"
      strokeWidth="1.33"
      strokeLinejoin="round"
    />
  </svg>
);

const ItalicIcon: React.FC = () => (
  <svg width="7" height="11" viewBox="0 0 8 12" fill="none">
    <line
      x1="3"
      y1="1"
      x2="7"
      y2="1"
      stroke="currentColor"
      strokeWidth="1.37"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="11"
      x2="5"
      y2="11"
      stroke="currentColor"
      strokeWidth="1.37"
      strokeLinecap="round"
    />
    <line
      x1="5.5"
      y1="1"
      x2="2.5"
      y2="11"
      stroke="currentColor"
      strokeWidth="1.37"
      strokeLinecap="round"
    />
  </svg>
);

const UnderlineIcon: React.FC = () => (
  <svg width="11" height="13" viewBox="0 0 12 14" fill="none">
    <path
      d="M2 1V6C2 8.209 3.791 10 6 10C8.209 10 10 8.209 10 6V1"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="13"
      x2="11"
      y2="13"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
  </svg>
);

const StrikethroughIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <path
      d="M3 3C3 1.895 4.343 1 6 1C7.657 1 9 1.895 9 3C9 4 8 4.5 6 5"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
    <path
      d="M6 7C8 7.5 9 8 9 9C9 10.105 7.657 11 6 11C4.343 11 3 10.105 3 9"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="6"
      x2="11"
      y2="6"
      stroke="currentColor"
      strokeWidth="1.31"
      strokeLinecap="round"
    />
  </svg>
);

// ============================================================================
// 글꼴 스타일 토글
// ============================================================================

interface FontStyleButtonProps {
  active: boolean;
  title: string;
  onChange: (active: boolean) => void;
  children: React.ReactNode;
}

const FontStyleButton = ({
  active,
  title,
  onChange,
  children,
}: FontStyleButtonProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { value: visualActive, toggle } = useOptimisticBooleanCommit({
    canonicalValue: active,
    onCommit: onChange,
    frameHostRef: buttonRef,
  });
  const buttonClass = visualActive
    ? 'bg-fill-hover text-fg'
    : 'text-fg-faint hover:bg-fill hover:text-fg-muted';

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={visualActive}
      onClick={toggle}
      className={`w-[24px] h-[21px] flex items-center justify-center transition-colors duration-fast ${buttonClass}`}
      title={title}
    >
      {children}
    </button>
  );
};

export const FontStyleToggle: React.FC<FontStyleToggleProps> = ({
  isBold,
  isItalic,
  isUnderline,
  isStrikethrough,
  onBoldChange,
  onItalicChange,
  onUnderlineChange,
  onStrikethroughChange,
}) => {
  return (
    <div className="flex items-center h-[23px] bg-inset rounded-md overflow-hidden">
      <FontStyleButton active={isBold} onChange={onBoldChange} title="Bold">
        <BoldIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isItalic}
        onChange={onItalicChange}
        title="Italic"
      >
        <ItalicIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isUnderline}
        onChange={onUnderlineChange}
        title="Underline"
      >
        <UnderlineIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isStrikethrough}
        onChange={onStrikethroughChange}
        title="Strikethrough"
      >
        <StrikethroughIcon />
      </FontStyleButton>
    </div>
  );
};
