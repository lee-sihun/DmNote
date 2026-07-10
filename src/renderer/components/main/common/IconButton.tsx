import React from 'react';

type IconButtonSize = 'sm' | 'md';

interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  /** 토글형 버튼의 선택 상태 */
  selected?: boolean;
}

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'w-[24px] h-[24px] rounded-md',
  md: 'w-[28px] h-[28px] rounded-md',
};

const IconButton = ({
  size = 'sm',
  selected = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: IconButtonProps) => {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center shrink-0 select-none transition-colors duration-fast disabled:opacity-40 disabled:pointer-events-none ${
        selected
          ? 'bg-surface-active text-fg'
          : 'text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover'
      } ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

export default IconButton;
