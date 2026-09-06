import React, { useLayoutEffect, useRef, useState } from 'react';
import DigitPopLayer from '@components/main/common/DigitPopLayer';
import type { DigitPopState } from '@hooks/ui/useDigitPop';
import type { ScrubDragHandlers } from '@hooks/ui/useScrubDrag';

interface NumberInputShellProps {
  prefix?: React.ReactNode;
  scrub?: { active: boolean; handlers: ScrubDragHandlers };
  width: string;
  focused: boolean;
  invalid: boolean;
  shaking: boolean;
  onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => void;
  children: React.ReactNode;
}

export const NumberInputShell = ({
  prefix,
  scrub,
  width,
  focused,
  invalid,
  shaking,
  onAnimationEnd,
  children,
}: NumberInputShellProps) => (
  <label
    className={`relative flex items-center gap-[4px] h-[23px] px-[6px] bg-inset rounded-md cursor-text ${
      invalid ? 'shadow-danger-ring' : focused ? 'shadow-focus-ring' : ''
    } ${shaking ? 'dmn-field-shake' : ''}`}
    style={{ width }}
    onAnimationEnd={onAnimationEnd}
  >
    {prefix && (
      <span
        className={`shrink-0 text-body text-fg-muted ${
          scrub ? 'cursor-ew-resize select-none' : ''
        }`}
        {...scrub?.handlers}
      >
        {prefix}
      </span>
    )}
    {children}
  </label>
);

interface NumberInputFieldProps {
  value: string;
  inputMode: 'numeric' | 'decimal';
  placeholder?: string;
  textClass: string;
  placeholderClass?: string;
  ariaLabel?: string;
  disabled?: boolean;
  pop: DigitPopState | null;
  invalid: boolean;
  tooltip: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
}

const NUMBER_FIELD_TYPOGRAPHY = 'text-body tabular-nums';
const NUMBER_FIELD_CLASS = `w-full h-full bg-transparent text-center text-ellipsis ${NUMBER_FIELD_TYPOGRAPHY}`;

export const NumberInputField = ({
  value,
  inputMode,
  placeholder,
  textClass,
  placeholderClass = '',
  ariaLabel,
  disabled,
  pop,
  invalid,
  tooltip,
  onChange,
  onKeyDown,
  onKeyUp,
  onFocus,
  onBlur,
}: NumberInputFieldProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    if (!pop) return;
    const input = inputRef.current;
    if (!input) return;
    setOverflowing(input.scrollWidth > input.clientWidth);
  }, [pop]);

  const popping = pop !== null && pop.text === value && !overflowing;
  return (
    <span className="relative flex flex-1 min-w-0 h-full">
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        inputMode={inputMode}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        title={tooltip}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={`${NUMBER_FIELD_CLASS} ${textClass} ${placeholderClass} ${
          popping ? 'dmn-digit-pop-host' : ''
        }`}
      />
      {popping && (
        <DigitPopLayer
          key={pop.cycle}
          pop={pop}
          className={`${NUMBER_FIELD_TYPOGRAPHY} ${textClass}`}
        />
      )}
    </span>
  );
};
