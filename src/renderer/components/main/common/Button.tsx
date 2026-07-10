import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active',
  secondary: 'bg-fill text-fg hover:bg-fill-hover active:bg-fill-active',
  ghost:
    'bg-transparent text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover',
  danger:
    'bg-danger-muted text-danger-fg hover:bg-[rgba(229,72,77,0.2)] active:bg-[rgba(229,72,77,0.26)]',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-[24px] px-[10px] text-body rounded-md',
  md: 'h-[30px] px-[14px] text-label rounded-lg',
};

const Button = ({
  variant = 'secondary',
  size = 'sm',
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) => {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-[6px] select-none whitespace-nowrap transition-colors duration-fast disabled:opacity-40 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};

export default Button;
