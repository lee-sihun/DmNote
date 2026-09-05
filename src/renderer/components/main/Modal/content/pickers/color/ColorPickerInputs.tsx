import React, { useRef, useState } from 'react';
import { NumberInput } from '@components/main/common/numberInput/NumberInput';
import { ColorSwatchSurface } from './ColorSwatch';

export type GradientSide = 'top' | 'bottom';

export interface PercentInputProps {
  value: number;
  label?: string;
  isMixed?: boolean;
  disabled?: boolean;
  onEditStart?: () => void;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel?: () => void;
}

const PercentInput = ({
  value,
  label,
  isMixed,
  disabled,
  onEditStart,
  onPreview,
  onCommit,
  onCancel,
}: PercentInputProps) => (
  <div className="w-[48px] flex-shrink-0" onFocusCapture={onEditStart}>
    <NumberInput
      value={value}
      min={0}
      max={100}
      width="48px"
      isMixed={isMixed}
      disabled={disabled}
      ariaLabel={label}
      onPreview={onPreview}
      onChange={onCommit}
      onCancel={onCancel}
    />
  </div>
);

interface ColorInputProps {
  value?: string;
  ariaLabel?: string;
  mixed?: boolean;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  onValueFocus?: () => void;
  onValueCommit?: () => void;
  onValueCancel?: () => boolean;
  previewColor?: string;
  alpha?: number;
  alphaPercent?: PercentInputProps;
}

export const ColorInput = ({
  value = '',
  ariaLabel,
  mixed = false,
  disabled = false,
  onValueChange,
  onValueFocus,
  onValueCommit,
  onValueCancel,
  previewColor,
  alpha,
  alphaPercent,
}: ColorInputProps) => {
  const [editing, setEditing] = useState(false);
  const cancelledRef = useRef(false);
  const showMixed = mixed && !editing;

  return (
    <div className="flex items-center gap-[6px] w-full">
      <div className="relative flex-1 min-w-0">
        <ColorSwatchSurface
          className="absolute left-[6px] top-1/2 -translate-y-1/2 w-[11px] h-[11px] rounded-[2px]"
          color={previewColor}
          opacity={alpha}
        />
        <input
          type="text"
          disabled={disabled}
          aria-label={ariaLabel}
          value={showMixed ? '' : value}
          placeholder={showMixed ? 'Mixed' : undefined}
          onChange={(event) => onValueChange?.(event.target.value)}
          onFocus={() => {
            cancelledRef.current = false;
            setEditing(true);
            onValueFocus?.();
          }}
          onBlur={() => {
            setEditing(false);
            if (cancelledRef.current) {
              cancelledRef.current = false;
              return;
            }
            onValueCommit?.();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape' && onValueCancel?.()) {
              event.preventDefault();
              cancelledRef.current = true;
              event.currentTarget.blur();
            }
          }}
          className="block pl-[23px] text-left w-full h-[23px] bg-inset rounded-md focus:shadow-focus-ring text-body text-fg uppercase placeholder:text-fg-faint placeholder:italic placeholder:normal-case disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {alphaPercent && <PercentInput {...alphaPercent} />}
    </div>
  );
};

interface GradientInputsProps {
  topValue: string;
  bottomValue: string;
  colorLabel: string;
  onTopChange: (value: string) => void;
  onBottomChange: (value: string) => void;
  onTopFocus: () => void;
  onBottomFocus: () => void;
  onTopCommit: () => void;
  onBottomCommit: () => void;
  onTopCancel: () => boolean;
  onBottomCancel: () => boolean;
  selected: GradientSide;
  onSelect?: (side: GradientSide) => void;
  rightTopPercent?: PercentInputProps;
  rightBottomPercent?: PercentInputProps;
}

export const GradientInputs = ({
  topValue,
  bottomValue,
  colorLabel,
  onTopChange,
  onBottomChange,
  onTopFocus,
  onBottomFocus,
  onTopCommit,
  onBottomCommit,
  onTopCancel,
  onBottomCancel,
  selected,
  onSelect,
  rightTopPercent,
  rightBottomPercent,
}: GradientInputsProps) => (
  <div className="flex flex-col gap-[6px]">
    <GradientInput
      label="Top"
      ariaLabel={`${colorLabel} Top`}
      value={topValue}
      onChange={onTopChange}
      onFocus={onTopFocus}
      onCommit={onTopCommit}
      onCancel={onTopCancel}
      selected={selected === 'top'}
      onSelect={() => onSelect?.('top')}
      rightPercent={rightTopPercent}
    />
    <GradientInput
      label="Bottom"
      ariaLabel={`${colorLabel} Bottom`}
      value={bottomValue}
      onChange={onBottomChange}
      onFocus={onBottomFocus}
      onCommit={onBottomCommit}
      onCancel={onBottomCancel}
      selected={selected === 'bottom'}
      onSelect={() => onSelect?.('bottom')}
      rightPercent={rightBottomPercent}
    />
  </div>
);

interface GradientInputProps {
  label: string;
  ariaLabel: string;
  value: string;
  onChange?: (value: string) => void;
  onFocus?: () => void;
  onCommit?: () => void;
  onCancel?: () => boolean;
  selected: boolean;
  onSelect?: () => void;
  rightPercent?: PercentInputProps;
}

const GradientInput = ({
  label,
  ariaLabel,
  value,
  onChange,
  onFocus,
  onCommit,
  onCancel,
  selected,
  onSelect,
  rightPercent,
}: GradientInputProps) => {
  const cancelledRef = useRef(false);
  return (
    <div className="flex items-center gap-[6px] w-full">
      <div className="relative flex-1 min-w-0">
        <ColorSwatchSurface
          role="button"
          tabIndex={0}
          onClick={() => onSelect?.()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect?.();
            }
          }}
          className="absolute left-[6px] top-1/2 -translate-y-1/2 w-[11px] h-[11px] rounded-[2px]"
          color={value ? `#${value}` : '#561ecb'}
        />
        <input
          type="text"
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onFocus={() => {
            cancelledRef.current = false;
            onSelect?.();
            onFocus?.();
          }}
          onBlur={() => {
            if (cancelledRef.current) {
              cancelledRef.current = false;
              return;
            }
            onCommit?.();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape' && onCancel?.()) {
              event.preventDefault();
              cancelledRef.current = true;
              event.currentTarget.blur();
            }
          }}
          placeholder={label}
          className={`block pl-[23px] text-left w-full h-[23px] bg-inset rounded-md text-body text-fg uppercase ${
            selected ? 'shadow-focus-ring' : 'focus:shadow-focus-ring'
          }`}
        />
      </div>
      {rightPercent && <PercentInput {...rightPercent} />}
    </div>
  );
};
