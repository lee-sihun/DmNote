import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import { useAfterPaintValueCommit } from '@hooks/useAfterPaintValueCommit';
import { useDigitPop } from '@hooks/ui/useDigitPop';
import { useFieldError } from '@hooks/ui/useFieldError';
import { useFrameCoalescer } from '@hooks/ui/useFrameCoalescer';
import { useScrubDrag } from '@hooks/ui/useScrubDrag';
import {
  isStaleRepeat,
  parseLeadingNumber,
  resolveStepper,
} from '@utils/number/numberStep';
import {
  canParseNumericInput,
  isExpressionDraft,
  isPartialNumericInput,
  stepDirection,
} from './numberInputModel';
import { createNumericEditModel } from './numericEditSessionModel';

interface NumericEditPolicyBase {
  commitStrategy: CommitStrategy;
  min: number;
  max: number;
  suffix?: string;
  allowDecimal: boolean;
  decimalScale: number;
  isMixed: boolean;
  hasPrefix: boolean;
  onCancel?: () => void;
  onBlur?: (value?: number) => void;
}

export interface RequiredNumericEditPolicy extends NumericEditPolicyBase {
  kind: 'required';
  value: number | string;
  onChange: (value: number) => void;
  onPreview?: (value: number) => void;
  step?: number;
  disabled: boolean;
}

export interface OptionalNumericEditPolicy extends NumericEditPolicyBase {
  kind: 'optional';
  value?: number;
  onChange: (value?: number) => void;
  onPreview?: (value?: number) => void;
  placeholder?: string;
  allowNegative: boolean;
}

export type NumericEditPolicy =
  | RequiredNumericEditPolicy
  | OptionalNumericEditPolicy;

export const createRequiredNumericEditPolicy = (
  policy: Omit<RequiredNumericEditPolicy, 'kind'>,
): RequiredNumericEditPolicy => ({ kind: 'required', ...policy });

export const createOptionalNumericEditPolicy = (
  policy: Omit<OptionalNumericEditPolicy, 'kind'>,
): OptionalNumericEditPolicy => ({ kind: 'optional', ...policy });

export const useNumericEditSession = (policy: NumericEditPolicy) => {
  const isOptional = policy.kind === 'optional';
  const {
    value,
    onPreview,
    onCancel,
    onBlur,
    commitStrategy,
    min,
    max,
    suffix,
    allowDecimal,
    decimalScale,
    isMixed,
    hasPrefix,
  } = policy;
  // Optional의 음수 금지 정책은 최종 도메인에만 적용
  const domainMin =
    policy.kind === 'optional' && !policy.allowNegative
      ? Math.max(0, min)
      : min;
  const {
    resolvedDecimalScale,
    supportsDecimal,
    normalizePrecision,
    sanitizeNumericInput,
    normalizeDraftInput,
    clampValue,
    parseAndClamp,
    evaluateAndClampExpression,
    getDisplayValue,
  } = createNumericEditModel({
    allowDecimal,
    decimalScale,
    min: domainMin,
    max,
    suffix,
  });

  const initialText =
    isMixed || (isOptional && value == null) ? '' : getDisplayValue(value!);
  const [localValue, setLocalValue] = useState<string>(initialText);
  const [isFocused, setIsFocused] = useState(false);
  const fieldError = useFieldError();
  const escapedRef = useRef(false);

  const commitLiveValue = (next: number | undefined) => {
    if (policy.kind === 'required') {
      if (next !== undefined) (policy.onPreview ?? policy.onChange)(next);
      return;
    }
    (policy.onPreview ?? policy.onChange)(next);
  };
  const { scheduleCommit, cancelPendingCommit } = useAfterPaintValueCommit<
    number | undefined
  >({
    onCommit: commitLiveValue,
    strategy: commitStrategy,
  });
  const digitPop = useDigitPop();
  const stepFrame = useFrameCoalescer();
  // draft는 이벤트 사이의 권위값, rendered는 실제 화면 비교 기준
  const draftRef = useRef(localValue);
  const renderedRef = useRef(localValue);
  const hasUserInputRef = useRef(false);
  const holdKeyRef = useRef<string | null>(null);
  const lastEmittedRef = useRef<number | null>(null);
  const stepBaseRef = useRef(0);
  const suppressDigitPopRef = useRef(false);
  const committedValueRef = useRef<number | string | undefined>(value);
  const committedMixedRef = useRef(isMixed);
  const emittedRef = useRef(false);

  const syncText = (text: string) => {
    draftRef.current = text;
    renderedRef.current = text;
    setLocalValue(text);
  };

  const emitValue = (next: number | undefined) => {
    lastEmittedRef.current = next ?? null;
    emittedRef.current = true;
    scheduleCommit(next);
  };

  const restorePreview = () => {
    if (onCancel) {
      onCancel();
      return;
    }
    if (!emittedRef.current) return;
    if (committedMixedRef.current || isMixed) return;

    const committedValue = committedValueRef.current;
    if (policy.kind === 'optional') {
      (policy.onPreview ?? policy.onChange)(
        committedValue as number | undefined,
      );
      return;
    }
    const committed =
      typeof committedValue === 'number'
        ? committedValue
        : Number(committedValue);
    if (Number.isFinite(committed)) {
      (policy.onPreview ?? policy.onChange)(committed);
    }
  };

  const cancelDraft = () => {
    const touched = hasUserInputRef.current || emittedRef.current;
    cancelPendingCommit();
    const committedValue = committedValueRef.current;
    syncText(
      committedMixedRef.current || (isOptional && committedValue == null)
        ? ''
        : getDisplayValue(committedValue!),
    );
    hasUserInputRef.current = false;
    fieldError.clear();
    digitPop.clear();
    if (touched) restorePreview();
  };

  const resolveStepBase = (): number => {
    if (canParseNumericInput(draftRef.current)) {
      return Number(draftRef.current);
    }
    const typed = sanitizeNumericInput(draftRef.current);
    if (canParseNumericInput(typed)) return Number(typed);

    if (policy.kind === 'optional') {
      if (policy.value != null) return policy.value;
      return parseLeadingNumber(policy.placeholder) ?? 0;
    }
    const committed =
      typeof policy.value === 'number' ? policy.value : Number(policy.value);
    return Number.isFinite(committed) ? committed : 0;
  };

  const invokeChange = (next: number | undefined) => {
    if (policy.kind === 'required') {
      if (next !== undefined) policy.onChange(next);
      return;
    }
    policy.onChange(next);
  };

  const flushStep = () => {
    const suppressDigitPop = suppressDigitPopRef.current;
    suppressDigitPopRef.current = false;
    const parsed = isOptional
      ? clampValue(Number(draftRef.current))
      : parseAndClamp(draftRef.current);
    const nextText = parsed === null ? draftRef.current : String(parsed);
    const prevText = renderedRef.current;

    if (nextText === prevText) {
      draftRef.current = nextText;
    } else {
      if (holdKeyRef.current === null && !suppressDigitPop) {
        const prevNumber = isOptional
          ? isPartialNumericInput(prevText)
            ? stepBaseRef.current
            : Number(prevText)
          : canParseNumericInput(prevText)
          ? Number(prevText)
          : stepBaseRef.current;
        digitPop.play(
          prevText,
          nextText,
          stepDirection(prevNumber, Number(nextText)),
        );
      }
      syncText(nextText);
    }

    if (parsed === null || parsed === lastEmittedRef.current) return;
    emitValue(parsed);
  };

  const stepBy = (
    stepper: (base: number) => number,
    repeat: boolean,
    key: string,
  ): boolean => {
    const base = resolveStepBase();
    const stepped = stepper(base);
    const next = clampValue(supportsDecimal ? stepped : Math.round(stepped));
    const nextText = String(next);
    if (nextText === draftRef.current) {
      suppressDigitPopRef.current = false;
      return false;
    }

    holdKeyRef.current = repeat ? key : null;
    stepBaseRef.current = base;
    draftRef.current = nextText;
    hasUserInputRef.current = true;

    if (repeat) {
      stepFrame.schedule(() => flushStepRef.current());
      return true;
    }
    stepFrame.cancel();
    flushStep();
    return true;
  };

  const flushStepRef = useRef(flushStep);
  useLayoutEffect(() => {
    flushStepRef.current = flushStep;
  });

  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== holdKeyRef.current) return;
    stepFrame.cancel();
    flushStep();
    holdKeyRef.current = null;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      if (isExpressionDraft(draftRef.current)) {
        const evaluated = evaluateAndClampExpression(draftRef.current);
        if (evaluated === null) {
          event.preventDefault();
          fieldError.raise();
          return;
        }
        fieldError.clear();
        digitPop.clear();
      }
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      if (hasUserInputRef.current) event.preventDefault();
      escapedRef.current = true;
      event.currentTarget.blur();
      return;
    }

    if (!event.ctrlKey && !event.metaKey) {
      const customStep = policy.kind === 'required' ? policy.step : undefined;
      const stepper = resolveStepper(
        event.key,
        event,
        resolvedDecimalScale,
        customStep,
      );
      if (stepper !== null) {
        event.preventDefault();
        // required 입력의 스크럽 권위 정책 유지
        if (policy.kind === 'required' && scrub.active) return;
        if (isStaleRepeat(event.nativeEvent)) return;
        if (isExpressionDraft(draftRef.current)) {
          const evaluated = evaluateAndClampExpression(draftRef.current);
          if (evaluated === null) {
            if (!event.repeat) fieldError.raise();
            return;
          }

          stepFrame.cancel();
          holdKeyRef.current = null;
          syncText(String(evaluated));
          hasUserInputRef.current = true;
          fieldError.clear();
          digitPop.clear();
          suppressDigitPopRef.current = true;
          const stepped = stepBy(stepper, event.repeat, event.key);
          if (!stepped && evaluated !== lastEmittedRef.current) {
            emitValue(evaluated);
          }
          return;
        }
        stepBy(stepper, event.repeat, event.key);
        return;
      }
    }

    const allowedKeys = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'Tab',
      'Home',
      'End',
    ];
    if (allowedKeys.includes(event.key)) return;
    if (event.ctrlKey || event.metaKey) return;
    if (/^[0-9+\-*/()]$/.test(event.key) || event.key === ' ') return;
    if (event.key === '.' || event.key === 'Decimal') return;
    event.preventDefault();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    stepFrame.cancel();
    holdKeyRef.current = null;
    suppressDigitPopRef.current = false;

    const newValue = normalizeDraftInput(event.target.value);
    if (newValue === null) {
      event.currentTarget.value = draftRef.current;
      return;
    }

    syncText(newValue);
    hasUserInputRef.current = true;
    fieldError.clear();

    if (policy.kind === 'optional') {
      if (newValue === '') {
        emitValue(undefined);
        return;
      }
      if (isPartialNumericInput(newValue) || isExpressionDraft(newValue)) {
        return;
      }
      const numericValue = Number(newValue);
      if (!Number.isFinite(numericValue)) return;
      emitValue(
        clampValue(supportsDecimal ? numericValue : Math.round(numericValue)),
      );
      return;
    }

    if (isExpressionDraft(newValue)) return;
    const clamped = parseAndClamp(newValue);
    if (clamped !== null) emitValue(clamped);
  };

  const handleFocus = () => {
    setIsFocused(true);
    hasUserInputRef.current = false;
    escapedRef.current = false;
    lastEmittedRef.current = null;
    emittedRef.current = false;
    fieldError.clear();
    committedValueRef.current = value;
    committedMixedRef.current = isMixed;

    if (policy.kind === 'optional') {
      syncText(
        !isMixed && policy.value != null
          ? String(normalizePrecision(policy.value))
          : '',
      );
      return;
    }
    if (isMixed) {
      syncText('');
      return;
    }
    syncText(
      typeof policy.value === 'number'
        ? String(normalizePrecision(policy.value))
        : String(policy.value),
    );
  };

  const draftTextFor = (numericValue: number): string =>
    isFocused
      ? String(normalizePrecision(numericValue))
      : getDisplayValue(numericValue);

  const scrubEnabled =
    hasPrefix &&
    Boolean(onPreview) &&
    (policy.kind === 'optional' || !policy.disabled);
  const scrub = useScrubDrag({
    enabled: scrubEnabled,
    resolveBase: () => {
      digitPop.clear();
      if (isFocused && isExpressionDraft(draftRef.current)) {
        const evaluated = evaluateAndClampExpression(draftRef.current);
        if (evaluated === null) {
          fieldError.raise();
          return null;
        }
        syncText(String(evaluated));
        hasUserInputRef.current = true;
        fieldError.clear();
        digitPop.clear();
        return evaluated;
      }
      return resolveStepBase();
    },
    step: policy.kind === 'required' ? policy.step ?? 1 : 1,
    range: { min: domainMin, max },
    quantize: (raw) => clampValue(supportsDecimal ? raw : Math.round(raw)),
    ownsFocus: (active, handle) =>
      handle.parentElement?.contains(active) ?? false,
    onMove: (next) => {
      stepFrame.cancel();
      holdKeyRef.current = null;
      syncText(draftTextFor(next));
      hasUserInputRef.current = true;
      emitValue(next);
    },
    onCommit: (final) => {
      cancelPendingCommit();
      syncText(draftTextFor(final));
      hasUserInputRef.current = false;
      committedValueRef.current = final;
      committedMixedRef.current = false;
      emittedRef.current = false;
      lastEmittedRef.current = null;
      invokeChange(final);
    },
    onCancel: () => {
      cancelPendingCommit();
      const committed = committedValueRef.current;
      syncText(
        committedMixedRef.current || (isOptional && committed == null)
          ? ''
          : draftTextFor(Number(committed)),
      );
      hasUserInputRef.current = false;
      fieldError.clear();
      digitPop.clear();
      restorePreview();
    },
  });

  useEffect(() => {
    if (!isFocused && !scrub.active) {
      syncText(
        isMixed || (isOptional && value == null) ? '' : getDisplayValue(value!),
      );
      hasUserInputRef.current = false;
      committedValueRef.current = value;
      committedMixedRef.current = isMixed;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused, isMixed]);

  const handleBlur = () => {
    setIsFocused(false);
    stepFrame.cancel();
    holdKeyRef.current = null;

    if (scrub.cancel()) return;
    if (escapedRef.current) {
      escapedRef.current = false;
      cancelDraft();
      return;
    }

    if (!hasUserInputRef.current) {
      syncText(
        isMixed || (isOptional && value == null) ? '' : getDisplayValue(value!),
      );
      fieldError.clear();
      onBlur?.();
      return;
    }

    if (policy.kind === 'optional' && draftRef.current === '') {
      syncText('');
      cancelPendingCommit();
      policy.onChange(undefined);
      hasUserInputRef.current = false;
      fieldError.clear();
      digitPop.clear();
      policy.onBlur?.();
      return;
    }

    if (isExpressionDraft(draftRef.current)) {
      const evaluated = evaluateAndClampExpression(draftRef.current);
      if (evaluated === null) {
        cancelDraft();
        return;
      }

      syncText(getDisplayValue(evaluated));
      if (policy.kind === 'required') {
        hasUserInputRef.current = false;
        fieldError.clear();
        digitPop.clear();
        cancelPendingCommit();
        policy.onChange(evaluated);
        policy.onBlur?.(evaluated);
        return;
      }
      cancelPendingCommit();
      policy.onChange(evaluated);
      hasUserInputRef.current = false;
      fieldError.clear();
      digitPop.clear();
      policy.onBlur?.(evaluated);
      return;
    }

    if (policy.kind === 'optional') {
      const cleaned = draftRef.current;
      if (isPartialNumericInput(cleaned) || !Number.isFinite(Number(cleaned))) {
        cancelDraft();
        return;
      }
      const parsed = Number(cleaned);
      const clamped = clampValue(supportsDecimal ? parsed : Math.round(parsed));
      syncText(getDisplayValue(clamped));
      cancelPendingCommit();
      policy.onChange(clamped);
      hasUserInputRef.current = false;
      policy.onBlur?.(clamped);
      return;
    }

    const clamped = parseAndClamp(draftRef.current);
    if (clamped === null) {
      cancelDraft();
      return;
    }
    syncText(getDisplayValue(clamped));
    cancelPendingCommit();
    policy.onChange(clamped);
    hasUserInputRef.current = false;
    fieldError.clear();
    policy.onBlur?.(clamped ?? undefined);
  };

  return {
    localValue,
    isFocused,
    supportsDecimal,
    fieldError,
    digitPop,
    scrub,
    scrubEnabled,
    handleChange,
    handleKeyDown,
    handleKeyUp,
    handleFocus,
    handleBlur,
  };
};
