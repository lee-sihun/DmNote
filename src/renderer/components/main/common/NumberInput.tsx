import React from 'react';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import { I18nContext } from '@contexts/I18nContextDef';
import { NumberInputField, NumberInputShell } from './NumberInputChrome';
import {
  createOptionalNumericEditPolicy,
  createRequiredNumericEditPolicy,
  useNumericEditSession,
} from './useNumericEditSession';

export interface NumberInputProps {
  value: number | string;
  onChange: (value: number) => void;
  /** 타이핑 callback을 첫 paint 뒤로 미뤄 입력 echo를 우선 반영 */
  commitStrategy?: CommitStrategy;
  /** 확정값을 함께 받는다. onChange가 예약한 state는 같은 이벤트에서 아직 이전 값이다 */
  onBlur?: (value?: number) => void;
  /** 지정 시 타이핑은 preview로 흐르고 onChange는 blur/Enter 확정에만 호출됨 */
  onPreview?: (value: number) => void;
  /** Escape 원복 시 호출 (게스처 취소 연동) */
  onCancel?: () => void;
  min?: number;
  max?: number;
  prefix?: React.ReactNode;
  suffix?: string;
  width?: string;
  allowDecimal?: boolean;
  decimalScale?: number;
  /** 방향키 눈금. 미지정이면 1, Shift는 이 값의 10배 */
  step?: number;
  /** 라벨 없는 자리에서 쓰는 접근성 이름 */
  ariaLabel?: string;
  disabled?: boolean;
  isMixed?: boolean;
  mixedPlaceholder?: string;
}

export interface OptionalNumberInputProps {
  value?: number;
  onChange: (value?: number) => void;
  /** 타이핑 callback을 첫 paint 뒤로 미뤄 입력 echo를 우선 반영 */
  commitStrategy?: CommitStrategy;
  /** 확정값을 함께 받는다. onChange가 예약한 state는 같은 이벤트에서 아직 이전 값이다 */
  onBlur?: (value?: number) => void;
  /** 지정 시 타이핑은 preview로 흐르고 onChange는 blur/Enter 확정에만 호출됨 */
  onPreview?: (value?: number) => void;
  /** Escape 원복 시 호출 (게스처 취소 연동) */
  onCancel?: () => void;
  min?: number;
  max?: number;
  prefix?: React.ReactNode;
  suffix?: string;
  width?: string;
  placeholder?: string;
  allowNegative?: boolean;
  allowDecimal?: boolean;
  decimalScale?: number;
  isMixed?: boolean;
  mixedPlaceholder?: string;
}

const useNumberInputMessages = () => {
  const i18n = React.useContext(I18nContext);
  return {
    expressionHint:
      i18n?.t('numberInput.expressionHint') ??
      'Expressions supported: + - * / ( )',
  };
};

export const NumberInput = ({
  value,
  onChange,
  commitStrategy = 'after-paint',
  onBlur,
  onPreview,
  onCancel,
  // 미지정 방향은 무제한, 플러그인 설정 스키마의 optional min/max 계약과 동일
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  prefix,
  suffix,
  width = '54px',
  allowDecimal = false,
  decimalScale = 1,
  step,
  ariaLabel,
  disabled = false,
  isMixed = false,
  mixedPlaceholder = 'Mixed',
}: NumberInputProps) => {
  const messages = useNumberInputMessages();
  const edit = useNumericEditSession(
    createRequiredNumericEditPolicy({
      value,
      onChange,
      commitStrategy,
      onBlur,
      onPreview,
      onCancel,
      min,
      max,
      suffix,
      allowDecimal,
      decimalScale,
      step,
      disabled,
      isMixed,
      hasPrefix: Boolean(prefix),
    }),
  );
  const showMixedPlaceholder =
    isMixed && !edit.isFocused && edit.localValue === '';

  return (
    <NumberInputShell
      prefix={prefix}
      scrub={edit.scrubEnabled ? edit.scrub : undefined}
      width={width}
      focused={edit.isFocused}
      invalid={edit.fieldError.active}
      shaking={edit.fieldError.shaking}
      onAnimationEnd={edit.fieldError.handleAnimationEnd}
    >
      <NumberInputField
        inputMode={edit.supportsDecimal ? 'decimal' : 'numeric'}
        value={edit.localValue}
        onChange={edit.handleChange}
        onKeyDown={edit.handleKeyDown}
        onKeyUp={edit.handleKeyUp}
        onFocus={edit.handleFocus}
        onBlur={edit.handleBlur}
        placeholder={showMixedPlaceholder ? mixedPlaceholder : undefined}
        textClass={showMixedPlaceholder ? 'text-fg-faint italic' : 'text-fg'}
        placeholderClass={
          showMixedPlaceholder
            ? 'placeholder:text-fg-faint placeholder:italic'
            : ''
        }
        ariaLabel={ariaLabel}
        disabled={disabled}
        pop={edit.digitPop.pop}
        invalid={edit.fieldError.active}
        tooltip={messages.expressionHint}
      />
    </NumberInputShell>
  );
};

export const OptionalNumberInput = ({
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
}: OptionalNumberInputProps) => {
  const messages = useNumberInputMessages();
  const edit = useNumericEditSession(
    createOptionalNumericEditPolicy({
      value,
      onChange,
      commitStrategy,
      onBlur,
      onPreview,
      onCancel,
      min,
      max,
      suffix,
      placeholder,
      allowNegative,
      allowDecimal,
      decimalScale,
      isMixed,
      hasPrefix: Boolean(prefix),
    }),
  );
  const showMixedPlaceholder =
    isMixed && !edit.isFocused && edit.localValue === '';
  const effectivePlaceholder = showMixedPlaceholder
    ? mixedPlaceholder
    : placeholder;
  const placeholderClass = effectivePlaceholder
    ? 'placeholder:text-fg-faint placeholder:italic'
    : '';
  const textClass = showMixedPlaceholder ? 'text-fg-faint italic' : 'text-fg';

  return (
    <NumberInputShell
      prefix={prefix}
      scrub={edit.scrubEnabled ? edit.scrub : undefined}
      width={width}
      focused={edit.isFocused}
      invalid={edit.fieldError.active}
      shaking={edit.fieldError.shaking}
      onAnimationEnd={edit.fieldError.handleAnimationEnd}
    >
      <NumberInputField
        inputMode={edit.supportsDecimal ? 'decimal' : 'numeric'}
        value={edit.localValue}
        onChange={edit.handleChange}
        onKeyDown={edit.handleKeyDown}
        onKeyUp={edit.handleKeyUp}
        onFocus={edit.handleFocus}
        onBlur={edit.handleBlur}
        placeholder={effectivePlaceholder}
        textClass={textClass}
        placeholderClass={placeholderClass}
        pop={edit.digitPop.pop}
        invalid={edit.fieldError.active}
        tooltip={messages.expressionHint}
      />
    </NumberInputShell>
  );
};
