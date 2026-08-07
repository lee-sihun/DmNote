/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type {
  PropertyRowProps,
  NumberInputProps,
  OptionalNumberInputProps,
  TextInputProps,
  ColorInputProps,
  ToggleSwitchProps,
  TabButtonProps,
  TabsProps,
  FontStyleToggleProps,
} from './types';
import { TABS } from './types';
import {
  SECTION_CARD_CLASS,
  FORM_ROW_CLASS,
  FORM_LABEL_CLASS,
} from '@utils/cardRecipes';
import ColorPicker from '@components/main/Modal/content/pickers/ColorPicker';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { gradientToCss } from '@src/types/color';
import { useTranslation } from '@contexts/useTranslation';
import { registerEditorDraftForLifecycle } from '@src/renderer/editor/runtime/lifecycleEditorDraft';
import { useAfterPaintValueCommit } from '@hooks/useAfterPaintValueCommit';

// ============================================================================
// 속성 행
// ============================================================================

export const PropertyRow: React.FC<PropertyRowProps> = ({
  label,
  children,
}) => (
  <div className={FORM_ROW_CLASS}>
    <p className={FORM_LABEL_CLASS}>{label}</p>
    <div className="flex items-center gap-[8px]">{children}</div>
  </div>
);

// 그룹 카드 — 관련 속성 행을 하나의 면으로 묶는 섹션 컨테이너.
// data 표식은 분리 창 피커가 좌우 정렬·폭을 맞추는 기준
export const PropertySection: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div data-dmn-section="true" className={SECTION_CARD_CLASS}>
    {children}
  </div>
);

// ============================================================================
// 숫자 입력
// ============================================================================

// 숫자 입력 셸 - 외형과 타이포는 label 래퍼가 소유, input은 투명 flex 자식.
// label 위임으로 프리픽스·여백 클릭도 입력 포커스로 이어지고,
// 긴 값은 input 내부 스크롤로 처리되어 고정폭에서도 잘리지 않음
const NumberInputShell: React.FC<{
  prefix?: string;
  width: string;
  focused: boolean;
  children: React.ReactNode;
}> = ({ prefix, width, focused, children }) => (
  <label
    className={`flex items-center gap-[4px] h-[23px] px-[6px] bg-inset rounded-md cursor-text ${
      focused ? 'shadow-focus-ring' : ''
    }`}
    style={{ width }}
  >
    {prefix && (
      <span className="shrink-0 text-fg-muted text-body">{prefix}</span>
    )}
    {children}
  </label>
);

const NUMBER_FIELD_CLASS =
  'flex-1 min-w-0 h-full bg-transparent text-body tabular-nums text-center text-ellipsis';

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  commitStrategy = 'after-paint',
  onBlur,
  onPreview,
  onCancel,
  // 미지정 방향은 무제한 — 플러그인 설정 스키마의 optional min/max 계약과 동일
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  prefix,
  suffix,
  width = '54px',
  allowDecimal = false,
  decimalScale = 1,
  isMixed = false,
  mixedPlaceholder = 'Mixed',
}) => {
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

  // blur 표시값에만 단위를 붙여 값과 함께 가운데 정렬 (포커스 시 숫자만)
  const getDisplayValue = (val: number | string): string => {
    const normalized = typeof val === 'number' ? normalizePrecision(val) : val;
    return suffix ? `${normalized}${suffix}` : String(normalized);
  };

  const [localValue, setLocalValue] = useState<string>(
    isMixed ? '' : getDisplayValue(value),
  );
  const [isFocused, setIsFocused] = useState(false);
  const [hasUserInput, setHasUserInput] = useState(false);
  // Escape로 blur된 경우 확정 없이 원복
  const escapedRef = useRef(false);
  const liveCommit = onPreview ?? onChange;
  const { scheduleCommit, flushPendingCommit, cancelPendingCommit } =
    useAfterPaintValueCommit<number>({
      onCommit: liveCommit,
      strategy: commitStrategy,
    });

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(isMixed ? '' : getDisplayValue(value));
      setHasUserInput(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused, isMixed]);

  // 숫자, 마이너스, 소수점(옵션), 백스페이스, Delete, 화살표, Tab, Enter만 허용
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter는 blur를 통해 확정, Escape는 확정 없이 원복
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Escape') {
      // cancel 경로가 없는 입력은 기존 동작대로 무시 (비키 스토어 원복 불가)
      if (onCancel) {
        escapedRef.current = true;
        e.currentTarget.blur();
      } else {
        e.preventDefault();
      }
      return;
    }

    const allowedKeys = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Tab',
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
      // 로컬 echo를 먼저 반영하고 부모 preview·commit은 첫 paint 뒤 실행
      scheduleCommit(clamped);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    setHasUserInput(false);
    escapedRef.current = false;
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

    // Escape는 확정 없이 표시값 원복
    if (escapedRef.current) {
      escapedRef.current = false;
      cancelPendingCommit();
      setLocalValue(isMixed ? '' : getDisplayValue(value));
      setHasUserInput(false);
      // 취소 의미이므로 commit 성격의 onBlur는 호출하지 않음
      onCancel?.();
      return;
    }

    const numericValue = sanitizeNumericInput(localValue);

    // Mixed 상태에서 사용자 입력이 없었으면 Mixed 유지
    if (isMixed && !hasUserInput) {
      cancelPendingCommit();
      setLocalValue('');
      setHasUserInput(false);
      onBlur?.();
      return;
    }

    const clamped = parseAndClamp(numericValue);
    if (clamped === null) {
      // 마지막 문자가 중간 입력이면 직전 유효값까지는 기존 계약대로 보존
      flushPendingCommit();
      setLocalValue(isMixed ? '' : getDisplayValue(value));
    } else {
      cancelPendingCommit();
      setLocalValue(getDisplayValue(clamped));
      onChange(clamped);
    }
    setHasUserInput(false);
    onBlur?.();
  };

  // Mixed 상태일 때 placeholder 표시 여부
  const showMixedPlaceholder = isMixed && !isFocused && localValue === '';

  return (
    <NumberInputShell
      prefix={showMixedPlaceholder ? undefined : prefix}
      width={width}
      focused={isFocused}
    >
      <input
        type="text"
        inputMode={supportsDecimal ? 'decimal' : 'numeric'}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={showMixedPlaceholder ? mixedPlaceholder : undefined}
        className={`${NUMBER_FIELD_CLASS} ${
          showMixedPlaceholder
            ? 'text-fg-faint italic placeholder:text-fg-faint placeholder:italic'
            : 'text-fg'
        }`}
      />
    </NumberInputShell>
  );
};

// ============================================================================
// OptionalNumberInput (빈 값 -> undefined 허용, placeholder 지원)
// ============================================================================

export const OptionalNumberInput: React.FC<OptionalNumberInputProps> = ({
  value,
  onChange,
  commitStrategy = 'after-paint',
  onBlur,
  onPreview,
  onCancel,
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

  // blur 표시값에만 단위를 붙여 값과 함께 가운데 정렬 (포커스 시 숫자만)
  const getDisplayValue = (val: number): string => {
    const normalized = normalizePrecision(val);
    return suffix ? `${normalized}${suffix}` : String(normalized);
  };

  const [localValue, setLocalValue] = useState<string>(() => {
    if (isMixed || value == null) return '';
    return getDisplayValue(value);
  });
  const [isFocused, setIsFocused] = useState(false);
  const [hasUserInput, setHasUserInput] = useState(false);
  // Escape로 blur된 경우 확정 없이 원복
  const escapedRef = useRef(false);
  const liveCommit = onPreview ?? onChange;
  const { scheduleCommit, cancelPendingCommit } = useAfterPaintValueCommit<
    number | undefined
  >({
    onCommit: liveCommit,
    strategy: commitStrategy,
  });

  useEffect(() => {
    if (!isFocused) {
      if (isMixed || value == null) {
        setLocalValue('');
      } else {
        setLocalValue(getDisplayValue(value));
      }
      setHasUserInput(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused, isMixed]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter는 blur를 통해 확정, Escape는 확정 없이 원복
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Escape') {
      // cancel 경로가 없는 입력은 기존 동작대로 무시 (비키 스토어 원복 불가)
      if (onCancel) {
        escapedRef.current = true;
        e.currentTarget.blur();
      } else {
        e.preventDefault();
      }
      return;
    }

    const allowedKeys = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Tab',
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
      scheduleCommit(undefined);
      return;
    }
    if (newValue === '-' || newValue === '.' || newValue === '-.') {
      return;
    }

    const numValue = Number(newValue);
    if (!Number.isFinite(numValue)) return;

    const clamped = Math.min(Math.max(numValue, min), max);
    scheduleCommit(normalizePrecision(clamped));
  };

  const handleFocus = () => {
    setIsFocused(true);
    setHasUserInput(false);
    escapedRef.current = false;
    if (!isMixed && value != null) {
      setLocalValue(String(value));
    } else {
      setLocalValue('');
    }
  };

  const handleBlur = () => {
    setIsFocused(false);

    // Escape는 확정 없이 표시값 원복
    if (escapedRef.current) {
      escapedRef.current = false;
      cancelPendingCommit();
      if (isMixed || value == null) {
        setLocalValue('');
      } else {
        setLocalValue(getDisplayValue(value));
      }
      setHasUserInput(false);
      // 취소 의미이므로 commit 성격의 onBlur는 호출하지 않음
      onCancel?.();
      return;
    }

    const cleaned = sanitizeInput(localValue);
    cancelPendingCommit();

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
    setLocalValue(getDisplayValue(clamped));
    onChange(clamped);
    setHasUserInput(false);
    onBlur?.();
  };

  const showMixedPlaceholder = isMixed && !isFocused && localValue === '';
  const effectivePlaceholder = showMixedPlaceholder
    ? mixedPlaceholder
    : placeholder;

  const placeholderClass = effectivePlaceholder
    ? 'placeholder:text-fg-faint placeholder:italic'
    : '';
  const textClass = showMixedPlaceholder ? 'text-fg-faint italic' : 'text-fg';

  return (
    <NumberInputShell
      prefix={showMixedPlaceholder ? undefined : prefix}
      width={width}
      focused={isFocused}
    >
      <input
        type="text"
        inputMode={inputMode}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={effectivePlaceholder}
        className={`${NUMBER_FIELD_CLASS} ${textClass} ${placeholderClass}`}
      />
    </NumberInputShell>
  );
};

// ============================================================================
// 텍스트 입력
// ============================================================================

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  onBlur,
  onPreview,
  onCancel,
  placeholder,
  width = '90px',
  isMixed = false,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  // Escape로 blur된 경우 확정 없이 원복
  const escapedRef = useRef(false);
  const previewedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionActiveRef = useRef(false);
  const unregisterLifecycleRef = useRef<(() => void) | null>(null);
  const finalizeRef = useRef<(finalValue: string) => void>(() => undefined);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value);
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    // 게스처 모드에서는 타이핑이 preview로만 흐름
    if (onPreview) previewedRef.current = true;
    (onPreview ?? onChange)(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter는 blur를 통해 확정, Escape는 확정 없이 원복
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      // cancel 경로가 없는 입력은 기존 동작대로 무시
      if (onCancel) {
        escapedRef.current = true;
        e.currentTarget.blur();
      } else {
        e.preventDefault();
      }
    }
  };

  const clearLifecycleRegistration = () => {
    unregisterLifecycleRef.current?.();
    unregisterLifecycleRef.current = null;
  };

  const finalize = (finalValue: string) => {
    if (!sessionActiveRef.current) return;
    sessionActiveRef.current = false;
    clearLifecycleRegistration();
    setIsFocused(false);
    if (escapedRef.current) {
      escapedRef.current = false;
      previewedRef.current = false;
      setLocalValue(value);
      // 취소 의미이므로 commit 성격의 onBlur는 호출하지 않음
      onCancel?.();
      return;
    }
    // 확정은 입력 컴포넌트의 최종값 기준 (부모 store 재조회 금지)
    if (onPreview && previewedRef.current) {
      onChange(finalValue);
    }
    previewedRef.current = false;
    onBlur?.(finalValue);
  };

  useLayoutEffect(() => {
    finalizeRef.current = finalize;
  });

  useEffect(
    () => () => {
      sessionActiveRef.current = false;
      clearLifecycleRegistration();
    },
    [],
  );

  const handleFocus = () => {
    setIsFocused(true);
    escapedRef.current = false;
    previewedRef.current = false;
    sessionActiveRef.current = true;
    clearLifecycleRegistration();
    unregisterLifecycleRef.current = registerEditorDraftForLifecycle(() => {
      finalizeRef.current(inputRef.current?.value ?? value);
    });
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    finalize(event.currentTarget.value);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={localValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={`text-center h-[23px] p-[6px] bg-inset rounded-md ${
        isFocused ? 'shadow-focus-ring' : ''
      } text-body tabular-nums ${
        isMixed
          ? 'text-fg placeholder:text-fg-faint placeholder:italic'
          : 'text-fg'
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
  gradientValue,
  activeGradientValue,
  onModeCommit,
  canvasAnchor,
  gradientSurface = 'background',
}) => {
  const { t } = useTranslation();
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

  useEffect(() => {
    if (!showStateTabs) {
      setInternalStateMode('idle');
      if (!isControlled) setInternalOpen(false);
    }
  }, [showStateTabs, isControlled]);

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

  // ── gradient 배선 — onModeCommit이 주어진 경우에만 활성화 ──
  const supportsGradient = onModeCommit !== undefined;
  const showDetachedGradientHint =
    supportsGradient &&
    typeof window !== 'undefined' &&
    window.__dmn_window_type === 'panel';
  const storedGradient =
    stateMode === 'active'
      ? activeGradientValue ?? null
      : gradientValue ?? null;

  const gradientState = useGradientColorState({
    pair: supportsGradient
      ? {
          color:
            showStateTabs && stateMode === 'active'
              ? localActiveColor
              : localColor,
          gradient: storedGradient,
        }
      : {},
    fallbackColor: '#ffffff',
    contextKey: `${_stableId}:${stateMode}`,
    // 분리 창에서는 온캔버스 그라디언트 핸들 비활성 - 캔버스는 메인 창에 있고
    // 편집 세션 콜백이 창 경계를 넘을 수 없음 (Phase E 계약 E5)
    canvasAnchor:
      open && window.__dmn_window_type !== 'panel' ? canvasAnchor : undefined,
    canvasSurface: gradientSurface,
    canvasState: stateMode,
    onPreview: (modeValue) => {
      if (modeValue.mode === 'solid') handleColorChange(modeValue.color);
    },
    onCommit: (modeValue) => {
      const base =
        modeValue.mode === 'solid'
          ? modeValue.color
          : modeValue.spec.stops[0]?.color ?? '#ffffff';
      if (showStateTabs && stateMode === 'active') setLocalActiveColor(base);
      else setLocalColor(base);
      onModeCommit?.(stateMode, modeValue);
    },
  });

  return (
    <>
      <ColorSwatchButton
        ref={buttonRef}
        onClick={handleToggle}
        open={open}
        className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
        surfaceClassName="rounded-md"
        color={getDisplayColor(
          showStateTabs && stateMode === 'active'
            ? localActiveColor
            : localColor,
        )}
        image={
          supportsGradient && storedGradient
            ? gradientToCss(storedGradient)
            : undefined
        }
      />
      {open && (
        <ColorPicker
          open={open}
          referenceRef={buttonRef}
          panelElement={panelElement}
          color={
            supportsGradient
              ? gradientState.pickerColor
              : showStateTabs && stateMode === 'active'
              ? localActiveColor
              : localColor
          }
          onColorChange={
            supportsGradient
              ? (c: string) => gradientState.handlePickerColorChange(c, false)
              : handleColorChange
          }
          onColorChangeComplete={
            supportsGradient
              ? (c: string) => gradientState.handlePickerColorChange(c, true)
              : handleColorChangeComplete
          }
          onClose={handleClose}
          interactiveRefs={interactiveRefs}
          solidOnly={solidOnly}
          stateMode={showStateTabs ? stateMode : undefined}
          onStateModeChange={showStateTabs ? handleStateModeChange : undefined}
          headerSlot={supportsGradient ? gradientState.headerSlot : undefined}
          footerSlot={
            supportsGradient ? (
              <>
                {gradientState.footerSlot}
                {showDetachedGradientHint && (
                  <p className="mt-[8px] max-w-[210px] text-caption leading-[1.35] text-fg-muted">
                    {t('propertiesPanel.detachedGradientHint')}
                  </p>
                )}
              </>
            ) : undefined
          }
          gradientSpec={
            supportsGradient ? gradientState.paletteGradientSpec : undefined
          }
          onGradientSpecSelect={
            supportsGradient
              ? gradientState.handleGradientSpecSelect
              : undefined
          }
        />
      )}
    </>
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
        checked ? 'bg-accent' : 'bg-line-strong'
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
    `w-[24px] h-[21px] flex items-center justify-center transition-colors duration-fast ${
      active
        ? 'bg-fill-active text-fg'
        : 'text-fg-faint hover:bg-surface-hover hover:text-fg-muted'
    }`;

  return (
    <div className="flex items-center h-[23px] bg-inset rounded-md overflow-hidden">
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
    className={`relative z-10 w-full h-full rounded-[8px] text-body transition-colors duration-base ${
      active ? 'text-fg' : 'text-fg-muted hover:text-fg'
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

  const labels: Record<string, string> = {
    [TABS.STYLE]: t('propertiesPanel.tabStyle') || '키',
    [TABS.NOTE]: t('propertiesPanel.tabNote') || '노트',
    [TABS.COUNTER]: t('propertiesPanel.tabCounter') || '카운터',
  };

  const activeIndex = Math.max(0, tabs.indexOf(activeTab));

  return (
    <div className="relative flex w-full h-[30px] bg-inset rounded-surface items-center p-[2px]">
      <div
        aria-hidden
        className="absolute top-[2px] bottom-[2px] left-[2px] rounded-[8px] bg-fill-active shadow-elevation-chrome transition-transform duration-base ease-out-expo"
        style={{
          width: `calc((100% - 4px) / ${tabs.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {tabs.map((tab) => (
        <TabButton
          key={tab}
          active={activeTab === tab}
          onClick={() => onTabChange(tab)}
        >
          {labels[tab]}
        </TabButton>
      ))}
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
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

// 레이어/속성 모드 전환 토글 아이콘
export const ModeToggleIcon: React.FC<{
  mode: 'layer' | 'property';
  disabled?: boolean;
}> = ({ mode, disabled = false }) => {
  const strokeColor = 'currentColor';
  const fillColor = 'currentColor';
  const disabledClass = disabled ? 'text-fg-disabled' : undefined;

  if (mode === 'layer') {
    // 레이어 아이콘 (쌓인 레이어)
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className={disabledClass}
      >
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={disabledClass}
    >
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
