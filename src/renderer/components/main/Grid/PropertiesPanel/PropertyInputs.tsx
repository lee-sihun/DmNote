/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useRef } from 'react';
import type {
  PropertyRowProps,
  NumberInputProps,
  OptionalNumberInputProps,
  TextInputProps,
  ColorInputProps,
  SelectInputProps,
  ToggleSwitchProps,
  TabButtonProps,
  TabsProps,
  FontStyleToggleProps,
} from './types';
import { TABS } from './types';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';

// ============================================================================
// 속성 행
// ============================================================================

export const PropertyRow: React.FC<PropertyRowProps> = ({
  label,
  children,
}) => (
  <div className="flex justify-between items-center w-full min-h-[23px]">
    <p className="text-white text-style-2">{label}</p>
    <div className="flex items-center gap-[10.5px]">{children}</div>
  </div>
);

// ============================================================================
// 숫자 입력
// ============================================================================

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  onBlur,
  min = 0,
  max = 9999,
  prefix,
  suffix,
  width = '54px',
  allowDecimal = false,
  decimalScale = 1,
  isMixed = false,
  mixedPlaceholder = 'Mixed',
}) => {
  const hasSuffix = !!suffix;
  const resolvedDecimalScale = allowDecimal
    ? Math.max(0, Math.floor(decimalScale))
    : 0;
  const supportsDecimal = resolvedDecimalScale > 0;

  const normalizePrecision = (num: number): number => {
    if (!supportsDecimal) return num;
    return Number(num.toFixed(resolvedDecimalScale));
  };

  const sanitizeNumericInput = (raw: string): string => {
    let sanitized = raw.replace(supportsDecimal ? /[^0-9.-]/g : /[^0-9-]/g, '');

    const isNegative = sanitized.startsWith('-');
    sanitized = sanitized.replace(/-/g, '');
    if (isNegative) {
      sanitized = `-${sanitized}`;
    }

    if (!supportsDecimal) {
      return sanitized;
    }

    const sign = sanitized.startsWith('-') ? '-' : '';
    const unsigned = sign ? sanitized.slice(1) : sanitized;
    const dotIndex = unsigned.indexOf('.');

    if (dotIndex === -1) {
      return `${sign}${unsigned}`;
    }

    const integerPart = unsigned.slice(0, dotIndex);
    const fractionalPart = unsigned
      .slice(dotIndex + 1)
      .replace(/\./g, '')
      .slice(0, resolvedDecimalScale);

    return `${sign}${integerPart}.${fractionalPart}`;
  };

  const canParseNumericValue = (input: string): boolean => {
    if (input === '' || input === '-') return false;
    if (supportsDecimal && (input === '.' || input === '-.')) return false;
    return Number.isFinite(Number(input));
  };

  const parseAndClamp = (input: string): number | null => {
    if (!canParseNumericValue(input)) {
      return null;
    }

    const numValue = Number(input);
    const clamped = Math.min(Math.max(numValue, min), max);
    return normalizePrecision(clamped);
  };

  const getDisplayValue = (val: number | string, focused: boolean): string => {
    const normalized = typeof val === 'number' ? normalizePrecision(val) : val;
    if (hasSuffix && !focused) {
      return `${normalized}${suffix}`;
    }
    return String(normalized);
  };

  const [localValue, setLocalValue] = useState<string>(
    isMixed ? '' : getDisplayValue(value, false),
  );
  const [isFocused, setIsFocused] = useState(false);
  const [hasUserInput, setHasUserInput] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(isMixed ? '' : getDisplayValue(value, false));
      setHasUserInput(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused, isMixed]);

  // 숫자, 마이너스, 소수점(옵션), 백스페이스, Delete, 화살표, Tab, Enter만 허용
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowedKeys = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Tab',
      'Enter',
      'Home',
      'End',
    ];

    // 허용된 특수 키
    if (allowedKeys.includes(e.key)) {
      return;
    }

    // Ctrl/Cmd 조합 허용 (복사, 붙여넣기, 전체선택 등)
    if (e.ctrlKey || e.metaKey) {
      return;
    }

    // 숫자 0-9
    if (/^[0-9]$/.test(e.key)) {
      return;
    }

    // 소수점 (허용된 경우)
    if (supportsDecimal && (e.key === '.' || e.key === 'Decimal')) {
      const input = e.currentTarget;
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? selectionStart;
      const selectedText = input.value.slice(selectionStart, selectionEnd);
      if (!input.value.includes('.') || selectedText.includes('.')) {
        return;
      }
    }

    // 마이너스 (첫 번째 위치에서만)
    if (e.key === '-' && e.currentTarget.selectionStart === 0) {
      return;
    }

    // 그 외 모든 키 입력 차단
    e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = sanitizeNumericInput(e.target.value);
    setLocalValue(newValue);
    setHasUserInput(true);

    const clamped = parseAndClamp(newValue);
    if (clamped !== null) {
      onChange(clamped);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    setHasUserInput(false);
    if (!isMixed) {
      const numericValue =
        typeof value === 'number'
          ? String(normalizePrecision(value))
          : String(value);
      setLocalValue(numericValue);
    } else {
      setLocalValue('');
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const numericValue = sanitizeNumericInput(localValue);

    // Mixed 상태에서 사용자 입력이 없었으면 Mixed 유지
    if (isMixed && !hasUserInput) {
      setLocalValue('');
      setHasUserInput(false);
      onBlur?.();
      return;
    }

    const clamped = parseAndClamp(numericValue);
    if (clamped === null) {
      setLocalValue(isMixed ? '' : getDisplayValue(value, false));
    } else {
      setLocalValue(getDisplayValue(clamped, false));
      onChange(clamped);
    }
    setHasUserInput(false);
    onBlur?.();
  };

  // Mixed 상태일 때 placeholder 표시 여부
  const showMixedPlaceholder = isMixed && !isFocused && localValue === '';

  if (hasSuffix) {
    return (
      <input
        type="text"
        inputMode={supportsDecimal ? 'decimal' : 'numeric'}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={showMixedPlaceholder ? mixedPlaceholder : undefined}
        className={`text-center h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
          isFocused ? 'border-[#459BF8]' : 'border-[#3A3943]'
        } text-style-4 ${
          showMixedPlaceholder
            ? 'text-[#6B6D75] italic placeholder:text-[#6B6D75] placeholder:italic'
            : 'text-[#DBDEE8]'
        }`}
        style={{ width }}
      />
    );
  }

  return (
    <div
      className={`relative h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
        isFocused ? 'border-[#459BF8]' : 'border-[#3A3943]'
      }`}
      style={{ width }}
    >
      {prefix && !showMixedPlaceholder && (
        <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-[#97999E] text-style-1 pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode={supportsDecimal ? 'decimal' : 'numeric'}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={showMixedPlaceholder ? mixedPlaceholder : undefined}
        className={`absolute ${
          prefix && !showMixedPlaceholder ? 'left-[20px]' : 'left-0'
        } top-[-1px] h-[23px] ${
          prefix && !showMixedPlaceholder ? 'w-[26px]' : 'w-full'
        } bg-transparent text-style-4 ${
          showMixedPlaceholder
            ? 'text-[#6B6D75] italic placeholder:text-[#6B6D75] placeholder:italic'
            : 'text-[#DBDEE8]'
        } text-center`}
      />
    </div>
  );
};

// ============================================================================
// OptionalNumberInput (빈 값 -> undefined 허용, placeholder 지원)
// ============================================================================

export const OptionalNumberInput: React.FC<OptionalNumberInputProps> = ({
  value,
  onChange,
  onBlur,
  min = 0,
  max = 9999,
  prefix,
  suffix,
  width = '54px',
  placeholder,
  allowNegative = false,
  allowDecimal = false,
  decimalScale = 1,
  isMixed = false,
  mixedPlaceholder = 'Mixed',
}) => {
  const hasSuffix = !!suffix;
  const resolvedDecimalScale = allowDecimal
    ? Math.max(0, Math.floor(decimalScale))
    : 0;
  const supportsDecimal = resolvedDecimalScale > 0;
  const inputMode = supportsDecimal ? 'decimal' : 'numeric';

  const normalizePrecision = (num: number): number => {
    if (!supportsDecimal) return num;
    return Number(num.toFixed(resolvedDecimalScale));
  };

  // 숫자/부호/소수점만 남기고, 부호는 맨 앞에 하나, 소수점도 하나만 유지
  const sanitizeInput = (raw: string): string => {
    const pattern = supportsDecimal
      ? allowNegative
        ? /[^0-9.-]/g
        : /[^0-9.]/g
      : allowNegative
      ? /[^0-9-]/g
      : /[^0-9]/g;
    let sanitized = raw.replace(pattern, '');

    if (allowNegative) {
      const isNegative = sanitized.startsWith('-');
      sanitized = sanitized.replace(/-/g, '');
      if (isNegative) sanitized = `-${sanitized}`;
    }

    if (!supportsDecimal) return sanitized;

    const sign = sanitized.startsWith('-') ? '-' : '';
    const unsigned = sign ? sanitized.slice(1) : sanitized;
    const dotIndex = unsigned.indexOf('.');
    if (dotIndex === -1) return `${sign}${unsigned}`;

    const integerPart = unsigned.slice(0, dotIndex);
    const fractionalPart = unsigned
      .slice(dotIndex + 1)
      .replace(/\./g, '')
      .slice(0, resolvedDecimalScale);
    return `${sign}${integerPart}.${fractionalPart}`;
  };

  const getDisplayValue = (val: number, focused: boolean): string => {
    const normalized = normalizePrecision(val);
    if (hasSuffix && !focused) {
      return `${normalized}${suffix}`;
    }
    return String(normalized);
  };

  const [localValue, setLocalValue] = useState<string>(() => {
    if (isMixed || value == null) return '';
    return getDisplayValue(value, false);
  });
  const [isFocused, setIsFocused] = useState(false);
  const [hasUserInput, setHasUserInput] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      if (isMixed || value == null) {
        setLocalValue('');
      } else {
        setLocalValue(getDisplayValue(value, false));
      }
      setHasUserInput(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused, isMixed]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowedKeys = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Tab',
      'Enter',
      'Home',
      'End',
    ];

    if (allowedKeys.includes(e.key)) return;
    if (e.ctrlKey || e.metaKey) return;
    if (/^[0-9]$/.test(e.key)) return;
    if (allowNegative && e.key === '-') return;
    if (supportsDecimal && (e.key === '.' || e.key === 'Decimal')) return;

    e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = sanitizeInput(e.target.value);
    setLocalValue(newValue);
    setHasUserInput(true);

    // 빈 값만 unset, 부호·소수점만 남은 중간 상태는 commit하지 않고 입력 유지
    if (newValue === '') {
      onChange(undefined);
      return;
    }
    if (newValue === '-' || newValue === '.' || newValue === '-.') {
      return;
    }

    const numValue = Number(newValue);
    if (!Number.isFinite(numValue)) return;

    const clamped = Math.min(Math.max(numValue, min), max);
    onChange(normalizePrecision(clamped));
  };

  const handleFocus = () => {
    setIsFocused(true);
    setHasUserInput(false);
    if (!isMixed && value != null) {
      setLocalValue(String(value));
    } else {
      setLocalValue('');
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const cleaned = sanitizeInput(localValue);

    // Mixed 상태에서 사용자 입력이 없었으면 Mixed 유지
    if (isMixed && !hasUserInput) {
      setLocalValue('');
      setHasUserInput(false);
      onBlur?.();
      return;
    }

    if (
      cleaned === '' ||
      cleaned === '-' ||
      cleaned === '.' ||
      cleaned === '-.' ||
      isNaN(Number(cleaned))
    ) {
      setLocalValue('');
      onChange(undefined);
      setHasUserInput(false);
      onBlur?.();
      return;
    }

    const numValue = Number(cleaned);
    const clamped = normalizePrecision(Math.min(Math.max(numValue, min), max));
    setLocalValue(getDisplayValue(clamped, false));
    onChange(clamped);
    setHasUserInput(false);
    onBlur?.();
  };

  const showMixedPlaceholder = isMixed && !isFocused && localValue === '';
  const effectivePlaceholder = showMixedPlaceholder
    ? mixedPlaceholder
    : placeholder;

  const placeholderClass = effectivePlaceholder
    ? 'placeholder:text-[#6B6D75] placeholder:italic'
    : '';
  const textClass = showMixedPlaceholder
    ? 'text-[#6B6D75] italic'
    : 'text-[#DBDEE8]';

  if (prefix) {
    return (
      <div
        className={`relative h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
          isFocused ? 'border-[#459BF8]' : 'border-[#3A3943]'
        }`}
        style={{ width }}
      >
        {!showMixedPlaceholder && (
          <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-[#97999E] text-style-1 pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          type="text"
          inputMode={inputMode}
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={effectivePlaceholder}
          className={`absolute ${
            !showMixedPlaceholder ? 'left-[20px]' : 'left-0'
          } top-[-1px] h-[23px] ${
            !showMixedPlaceholder ? 'w-[26px]' : 'w-full'
          } bg-transparent text-style-4 ${textClass} ${placeholderClass} text-center`}
        />
      </div>
    );
  }

  if (hasSuffix) {
    return (
      <input
        type="text"
        inputMode={inputMode}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={effectivePlaceholder}
        className={`text-center h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
          isFocused ? 'border-[#459BF8]' : 'border-[#3A3943]'
        } text-style-4 ${textClass} ${placeholderClass}`}
        style={{ width }}
      />
    );
  }

  return (
    <input
      type="text"
      inputMode={inputMode}
      value={localValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={effectivePlaceholder}
      className={`text-center h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
        isFocused ? 'border-[#459BF8]' : 'border-[#3A3943]'
      } text-style-4 ${textClass} ${placeholderClass}`}
      style={{ width }}
    />
  );
};

// ============================================================================
// 텍스트 입력
// ============================================================================

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  onBlur,
  placeholder,
  width = '90px',
  isMixed = false,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value);
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    onChange(e.target.value);
  };

  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  return (
    <input
      type="text"
      value={localValue}
      onChange={handleChange}
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={`text-center h-[23px] p-[6px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
        isFocused ? 'border-[#459BF8]' : 'border-[#3A3943]'
      } text-style-4 ${
        isMixed
          ? 'text-[#DBDEE8] placeholder:text-[#6B6D75] placeholder:italic'
          : 'text-[#DBDEE8]'
      }`}
      style={{ width }}
    />
  );
};

// ============================================================================
// 컬러 입력
// ============================================================================

export const ColorInput: React.FC<ColorInputProps> = ({
  value,
  onChange,
  onChangeComplete,
  activeValue,
  onActiveChange,
  onActiveChangeComplete,
  showStateTabs = false,
  stateMode: externalStateMode,
  onStateModeChange: externalOnStateModeChange,
  colorId,
  solidOnly = true,
  panelElement,
  isOpen: externalIsOpen,
  onToggle: externalOnToggle,
}) => {
  // 외부 제어 모드인지 확인
  const isControlled =
    externalIsOpen !== undefined && externalOnToggle !== undefined;

  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? externalIsOpen : internalOpen;

  const isStateControlled =
    externalStateMode !== undefined && externalOnStateModeChange !== undefined;
  const [internalStateMode, setInternalStateMode] = useState<'idle' | 'active'>(
    'idle',
  );
  const stateMode =
    showStateTabs && isStateControlled
      ? externalStateMode
      : showStateTabs
      ? internalStateMode
      : 'idle';

  const buttonRef = useRef<HTMLButtonElement>(null);

  // 로컬 색상 상태 (드래그 중 UI 업데이트용)
  const [localColor, setLocalColor] = useState(value || '#FFFFFF');
  const [localActiveColor, setLocalActiveColor] = useState(
    activeValue ?? value ?? '#FFFFFF',
  );

  // 피커가 닫혀있을 때만 외부 prop과 동기화
  useEffect(() => {
    if (!open) {
      setLocalColor(value || '#FFFFFF');
      setLocalActiveColor(activeValue ?? value ?? '#FFFFFF');
    }
  }, [value, activeValue, open]);

  // colorId가 없으면 value 기반으로 생성
  const _stableId =
    colorId || `color-input-${value?.replace(/[^a-zA-Z0-9]/g, '')}`;

  const interactiveRefs = [buttonRef];

  const handleToggle = () => {
    if (isControlled) {
      externalOnToggle();
    } else {
      setInternalOpen((prev) => !prev);
    }
  };

  const handleClose = () => {
    if (isControlled) {
      externalOnToggle();
    } else {
      setInternalOpen(false);
    }
  };

  // 드래그 중 로컬 상태만 업데이트
  const handleColorChange = (color: string) => {
    if (showStateTabs && stateMode === 'active') {
      setLocalActiveColor(color);
      return;
    }
    setLocalColor(color);
    // onChange는 호출하지 않음 - 드래그 중 부모 상태 변경 방지
  };

  // 드래그 완료 시 부모에게 전달
  const handleColorChangeComplete = (color: string) => {
    if (showStateTabs && stateMode === 'active') {
      setLocalActiveColor(color);
      onActiveChange?.(color);
      onActiveChangeComplete?.(color);
      return;
    }

    setLocalColor(color);
    onChange?.(color);
    onChangeComplete?.(color);
  };

  const handleStateModeChange = (nextMode: 'idle' | 'active') => {
    if (!showStateTabs) return;
    if (isStateControlled) {
      externalOnStateModeChange(nextMode);
      return;
    }
    setInternalStateMode(nextMode);
  };

  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`w-[23px] h-[23px] rounded-[7px] border-[1px] overflow-hidden cursor-pointer transition-colors flex-shrink-0 ${
          open ? 'border-[#459BF8]' : 'border-[#3A3943] hover:border-[#505058]'
        }`}
        style={{
          backgroundColor: getDisplayColor(
            showStateTabs && stateMode === 'active'
              ? localActiveColor
              : localColor,
          ),
        }}
      />
      {open && (
        <ColorPicker
          open={open}
          referenceRef={buttonRef}
          panelElement={panelElement}
          color={
            showStateTabs && stateMode === 'active'
              ? localActiveColor
              : localColor
          }
          onColorChange={handleColorChange}
          onColorChangeComplete={handleColorChangeComplete}
          onClose={handleClose}
          interactiveRefs={interactiveRefs}
          solidOnly={solidOnly}
          stateMode={showStateTabs ? stateMode : undefined}
          onStateModeChange={showStateTabs ? handleStateModeChange : undefined}
        />
      )}
    </>
  );
};

// ============================================================================
// 선택 입력
// ============================================================================

export const SelectInput: React.FC<SelectInputProps> = ({
  value,
  options,
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`h-[23px] min-w-[70px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
          isOpen ? 'border-[#459BF8]' : 'border-[#3A3943]'
        } px-[8px] flex items-center justify-between gap-[4px] hover:border-[#505058] transition-colors`}
      >
        <span className="text-style-4 text-[#DBDEE8]">
          {options.find((opt) => opt.value === value)?.label || value}
        </span>
        <svg
          width="8"
          height="5"
          viewBox="0 0 8 5"
          fill="none"
          className="flex-shrink-0"
        >
          <path
            d="M1 1L4 4L7 1"
            stroke="#6B6D75"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-[27px] left-0 right-0 bg-[#2A2A30] border border-[#3A3943] rounded-[7px] z-20 overflow-hidden shadow-lg min-w-[70px]">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full px-[8px] py-[6px] text-left text-style-4 hover:bg-[#32323A] transition-colors ${
                  value === opt.value ? 'text-[#459BF8]' : 'text-[#DBDEE8]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// 토글 스위치
// ============================================================================

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
}) => {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-[32px] h-[18px] rounded-full transition-colors relative flex-shrink-0 ${
        checked ? 'bg-[#459BF8]' : 'bg-[#3A3943]'
      }`}
    >
      <div
        className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
};

// ============================================================================
// 섹션 구분선
// ============================================================================

export const SectionDivider: React.FC = () => (
  <div className="w-full h-[1px] bg-[#3A3943]" />
);

// ============================================================================
// 글꼴 스타일 아이콘
// ============================================================================

const BoldIcon: React.FC = () => (
  <svg width="9" height="11" viewBox="0 0 10 12" fill="none">
    <path
      d="M1 1H5.5C7.433 1 9 2.343 9 4C9 5.657 7.433 6 5.5 6H1V1Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path
      d="M1 6H6C8.209 6 9.5 7.343 9.5 9C9.5 10.657 8.209 11 6 11H1V6Z"
      stroke="currentColor"
      strokeWidth="1.8"
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
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="11"
      x2="5"
      y2="11"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <line
      x1="5.5"
      y1="1"
      x2="2.5"
      y2="11"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const UnderlineIcon: React.FC = () => (
  <svg width="11" height="13" viewBox="0 0 12 14" fill="none">
    <path
      d="M2 1V6C2 8.209 3.791 10 6 10C8.209 10 10 8.209 10 6V1"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="13"
      x2="11"
      y2="13"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const StrikethroughIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <path
      d="M3 3C3 1.895 4.343 1 6 1C7.657 1 9 1.895 9 3C9 4 8 4.5 6 5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M6 7C8 7.5 9 8 9 9C9 10.105 7.657 11 6 11C4.343 11 3 10.105 3 9"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <line
      x1="1"
      y1="6"
      x2="11"
      y2="6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

// ============================================================================
// 글꼴 스타일 토글
// ============================================================================

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
  const buttonClass = (active: boolean) =>
    `w-[24px] h-[21px] flex items-center justify-center transition-colors ${
      active
        ? 'bg-[#493C1D] text-[#FFB400]'
        : 'bg-[#2A2A30] text-[#6B6D75] hover:bg-[#32323A] hover:text-[#97999E]'
    }`;

  return (
    <div className="flex items-center h-[23px] bg-[#2A2A30] rounded-[7px] border border-[#3A3943] overflow-hidden">
      <button
        onClick={() => onBoldChange(!isBold)}
        className={buttonClass(isBold)}
        title="Bold"
      >
        <BoldIcon />
      </button>
      <button
        onClick={() => onItalicChange(!isItalic)}
        className={buttonClass(isItalic)}
        title="Italic"
      >
        <ItalicIcon />
      </button>
      <button
        onClick={() => onUnderlineChange(!isUnderline)}
        className={buttonClass(isUnderline)}
        title="Underline"
      >
        <UnderlineIcon />
      </button>
      <button
        onClick={() => onStrikethroughChange(!isStrikethrough)}
        className={buttonClass(isStrikethrough)}
        title="Strikethrough"
      >
        <StrikethroughIcon />
      </button>
    </div>
  );
};

// ============================================================================
// 탭 버튼 & 탭
// ============================================================================

const TabButton: React.FC<TabButtonProps> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`w-full h-[24px] rounded-[7px] text-style-2 transition-colors ${
      active
        ? 'bg-[#3A3943] text-white'
        : 'bg-[#26262C] text-[#9395A1] hover:bg-[#303036]'
    }`}
  >
    {children}
  </button>
);

export const Tabs: React.FC<TabsProps> = ({
  activeTab,
  onTabChange,
  t,
  availableTabs,
}) => {
  const tabs = availableTabs?.length
    ? availableTabs
    : [TABS.STYLE, TABS.NOTE, TABS.COUNTER];

  return (
    <div className="flex w-full h-[30px] bg-[#26262C] rounded-[7px] items-center p-[3px] gap-[5px]">
      {tabs.includes(TABS.STYLE) && (
        <TabButton
          active={activeTab === TABS.STYLE}
          onClick={() => onTabChange(TABS.STYLE)}
        >
          {t('propertiesPanel.tabStyle') || '키'}
        </TabButton>
      )}
      {tabs.includes(TABS.NOTE) && (
        <TabButton
          active={activeTab === TABS.NOTE}
          onClick={() => onTabChange(TABS.NOTE)}
        >
          {t('propertiesPanel.tabNote') || '노트'}
        </TabButton>
      )}
      {tabs.includes(TABS.COUNTER) && (
        <TabButton
          active={activeTab === TABS.COUNTER}
          onClick={() => onTabChange(TABS.COUNTER)}
        >
          {t('propertiesPanel.tabCounter') || '카운터'}
        </TabButton>
      )}
    </div>
  );
};

// ============================================================================
// 아이콘 컴포넌트
// ============================================================================

export const CloseIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path
      d="M1 1L9 9M9 1L1 9"
      stroke="#6B6D75"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

export const SidebarToggleIcon: React.FC<{ isOpen: boolean }> = ({
  isOpen,
}) => (
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
    <rect
      x="0.75"
      y="0.75"
      width="14.5"
      height="12.5"
      rx="2"
      stroke="#6B6D75"
      strokeWidth="1.5"
      fill="none"
    />
    <line
      x1={isOpen ? '10' : '12'}
      y1="1"
      x2={isOpen ? '10' : '12'}
      y2="13"
      stroke="#6B6D75"
      strokeWidth="1.5"
    />
    {isOpen && (
      <>
        <line
          x1="12"
          y1="4"
          x2="13.5"
          y2="4"
          stroke="#6B6D75"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <line
          x1="12"
          y1="7"
          x2="13.5"
          y2="7"
          stroke="#6B6D75"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <line
          x1="12"
          y1="10"
          x2="13.5"
          y2="10"
          stroke="#6B6D75"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </>
    )}
  </svg>
);

// 레이어/속성 모드 전환 토글 아이콘
export const ModeToggleIcon: React.FC<{
  mode: 'layer' | 'property';
  disabled?: boolean;
}> = ({ mode, disabled = false }) => {
  const strokeColor = disabled ? '#4A4A50' : '#6B6D75';
  const fillColor = disabled ? '#4A4A50' : '#6B6D75';

  if (mode === 'layer') {
    // 레이어 아이콘 (쌓인 레이어)
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 2L14 5.5L8 9L2 5.5L8 2Z"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M2 8L8 11.5L14 8"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2 10.5L8 14L14 10.5"
          stroke={strokeColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // 속성 아이콘 (슬라이더/설정)
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line
        x1="2"
        y1="4"
        x2="14"
        y2="4"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="5" cy="4" r="1.5" fill={fillColor} />
      <line
        x1="2"
        y1="8"
        x2="14"
        y2="8"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="11" cy="8" r="1.5" fill={fillColor} />
      <line
        x1="2"
        y1="12"
        x2="14"
        y2="12"
        stroke={strokeColor}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="7" cy="12" r="1.5" fill={fillColor} />
    </svg>
  );
};
