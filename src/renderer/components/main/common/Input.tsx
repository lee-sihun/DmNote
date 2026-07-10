import React, { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 텍스트 정렬 (좌표·수치 입력은 center 권장) */
  align?: 'left' | 'center';
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ align = 'left', className = '', ...rest }, ref) => {
    return (
      <input
        ref={ref}
        className={`h-[24px] px-[8px] bg-inset border border-line rounded-md text-body text-fg placeholder:text-fg-faint transition-colors duration-fast hover:border-line-strong focus:border-accent disabled:opacity-40 ${
          align === 'center' ? 'text-center' : ''
        } ${className}`}
        {...rest}
      />
    );
  },
);

Input.displayName = 'Input';

export default Input;
