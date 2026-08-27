import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import DigitPopLayer from '@components/main/common/DigitPopLayer';
import { useDigitPop, type DigitPopState } from '@hooks/ui/useDigitPop';
import { useFrameCoalescer } from '@hooks/ui/useFrameCoalescer';
import { useFieldError } from '@hooks/ui/useFieldError';
import {
  isStaleRepeat,
  parseLeadingNumber,
  resolveStepper,
} from '@utils/core/numberStep';
import {
  evaluateArithmeticExpression,
  MAX_EXPRESSION_LENGTH,
} from '@utils/core/arithmeticExpression';
import { I18nContext } from '@contexts/I18nContextDef';
import { useAfterPaintValueCommit } from '@hooks/useAfterPaintValueCommit';
import { useScrubDrag, type ScrubDragHandlers } from '@hooks/ui/useScrubDrag';

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

// 숫자 입력 셸 - 외형과 타이포는 label 래퍼가 소유, input은 투명 flex 자식.
// label 위임으로 프리픽스·여백 클릭도 입력 포커스로 이어지고,
// 긴 값은 input 내부 스크롤로 처리되어 고정폭에서도 잘리지 않음
// 잘못된 수식은 링과 흔들기로만 알린다. 말풍선까지 띄우면 좁은 패널에서
// 아래 행을 덮고, 스크롤 뷰포트가 overflow-y auto라 가로로도 잘린다
const NumberInputShell: React.FC<{
  prefix?: React.ReactNode;
  /** 접두를 좌우로 끌어 값을 바꾸는 게스처. 있으면 접두가 드래그 손잡이가 된다 */
  scrub?: { active: boolean; handlers: ScrubDragHandlers };
  width: string;
  focused: boolean;
  invalid: boolean;
  shaking: boolean;
  onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => void;
  children: React.ReactNode;
}> = ({
  prefix,
  scrub,
  width,
  focused,
  invalid,
  shaking,
  onAnimationEnd,
  children,
}) => (
  <label
    // 오류 링은 포커스 링을 대체한다. 둘을 겹치면 같은 자리에서 색이 섞여
    // 무엇이 잘못됐는지 읽히지 않는다. 보더가 아니라 링이라 상자 크기는 그대로다
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

// 재생 방향은 실제 값 변화가 정한다. 한 프레임에 위아래가 섞여 들어와도
// 마지막 키가 아니라 합산 결과를 따라간다
const stepDirection = (prev: number, next: number): 1 | -1 =>
  next < prev ? -1 : 1;

// 자릿수 레이어가 input 글자와 같은 자리에 서야 해서 타이포는 둘이 함께 쓴다
const NUMBER_FIELD_TYPOGRAPHY = 'text-body tabular-nums';
const NUMBER_FIELD_CLASS = `w-full h-full bg-transparent text-center text-ellipsis ${NUMBER_FIELD_TYPOGRAPHY}`;
const ARITHMETIC_INPUT_PATTERN = /^[0-9+\-*/().\s]*$/;

const isPartialNumericInput = (input: string): boolean =>
  input === '' || input === '-' || input === '.' || input === '-.';

const canParseNumericInput = (input: string): boolean =>
  input.trim() !== '' && Number.isFinite(Number(input));

const isExpressionDraft = (input: string): boolean =>
  !isPartialNumericInput(input) && !canParseNumericInput(input);

const useNumberInputMessages = () => {
  const i18n = React.useContext(I18nContext);
  return {
    expressionHint:
      i18n?.t('numberInput.expressionHint') ??
      'Expressions supported: + - * / ( )',
  };
};

interface NumberFieldProps {
  value: string;
  inputMode: 'numeric' | 'decimal';
  placeholder?: string;
  /** input과 자릿수 레이어가 함께 쓰는 색·기울임 */
  textClass: string;
  /** placeholder 전용 표현 - 레이어에는 해당 없음 */
  placeholderClass?: string;
  ariaLabel?: string;
  disabled?: boolean;
  pop: DigitPopState | null;
  invalid: boolean;
  tooltip: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
}

// input 위에 자릿수 레이어를 겹치는 배치 래퍼.
// 레이어는 재생 대상 문자열이 현재 표시값과 같을 때만 살아 있다 - 타이핑, blur 단위 부착,
// 외부 값 변경으로 표시값이 달라지면 별도 정리 경로 없이 스스로 접힌다.
// 덕분에 재생 상태가 남아 input 글자가 투명한 채로 굳는 경우가 생기지 않는다
const NumberInputField: React.FC<NumberFieldProps> = ({
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
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  // 값이 칸보다 길면 input은 넘친 쪽을 잘라 보여주고 레이어는 전체를 그린다.
  // 두 글자 배치가 어긋나므로 그 구간은 재생하지 않는다.
  //
  // 재생이 걸릴 때만 잰다. 값이 바뀔 때마다 재면 강제 동기 레이아웃이 스텝마다 붙는데,
  // 꾹 누르는 구간은 재생이 없으므로 전부 헛일이다 (실측 0.3ms/회, 2초 홀드에 38ms)
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    if (!pop) return;
    const input = inputRef.current;
    if (!input) return;
    setOverflowing(input.scrollWidth > input.clientWidth);
  }, [pop]);

  // 낙관적으로 켜고 레이아웃 이펙트가 아니라고 하면 같은 프레임에 접는다.
  // 이펙트는 paint 전에 끝나므로 어긋난 레이어가 화면에 나가지 않는다
  const popping = pop !== null && pop.text === value && !overflowing;

  // 래퍼는 배치만 담당한다. input이 갖고 있던 flex 사이징을 그대로 물려받고
  // input은 그 안을 꽉 채워서, 레이어가 없을 때의 레이아웃은 이전과 동일하다
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

export const NumberInput: React.FC<NumberInputProps> = ({
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
}) => {
  const messages = useNumberInputMessages();
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

  const normalizeDraftInput = (raw: string): string | null => {
    // 잘라서 받으면 사용자가 넣지 않은 다른 유효 수식이 확정될 수 있어 통째로 거절한다
    if (raw.length > MAX_EXPRESSION_LENGTH) return null;
    if (!ARITHMETIC_INPUT_PATTERN.test(raw)) return null;
    if (isPartialNumericInput(raw)) {
      return sanitizeNumericInput(raw);
    }
    if (canParseNumericInput(raw)) {
      return !supportsDecimal && raw.includes('.')
        ? raw
        : sanitizeNumericInput(raw);
    }
    return raw;
  };

  // 정밀도 정규화가 먼저다. 클램프를 먼저 하면 반올림이 값을 경계 밖으로 밀어낸다
  // (자릿수 1에 max 0.96이면 0.96으로 자른 뒤 1.0이 되어 상한을 넘는다)
  const clampValue = (num: number): number =>
    Math.min(Math.max(normalizePrecision(num), min), max);

  const parseAndClamp = (input: string): number | null => {
    if (!canParseNumericInput(input)) {
      return null;
    }

    const parsed = Number(input);
    return clampValue(supportsDecimal ? parsed : Math.round(parsed));
  };

  const evaluateAndClampExpression = (input: string): number | null => {
    const evaluated = evaluateArithmeticExpression(input);
    if (evaluated === null) return null;
    return clampValue(supportsDecimal ? evaluated : Math.round(evaluated));
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
  const fieldError = useFieldError();
  // Escape로 blur된 경우 확정 없이 원복
  const escapedRef = useRef(false);
  const liveCommit = onPreview ?? onChange;
  const { scheduleCommit, cancelPendingCommit } =
    useAfterPaintValueCommit<number>({
      onCommit: liveCommit,
      strategy: commitStrategy,
    });
  const digitPop = useDigitPop();
  const stepFrame = useFrameCoalescer();
  // 편집 중 권위값. 같은 React 커밋 안에서 이벤트가 여러 개 처리되면 state는 아직
  // 이전 값이라 스텝 기준이 어긋난다. 화면에 나간 값은 renderedRef가 따로 기억한다
  const draftRef = useRef(localValue);
  const renderedRef = useRef(localValue);
  const hasUserInputRef = useRef(false);
  // 꾹 누르고 있는 키. 이 구간은 값만 바뀌고 재생하지 않는다.
  // 키를 구분해야 위를 누른 채 아래를 뗐을 때 엉뚱하게 끝나지 않는다
  const holdKeyRef = useRef<string | null>(null);
  const lastEmittedRef = useRef<number | null>(null);
  // 스텝이 출발한 값. Mixed처럼 표시가 비어 있으면 화면 문자열로는 방향을 알 수 없다
  const stepBaseRef = useRef(0);
  const suppressDigitPopRef = useRef(false);
  const committedValueRef = useRef(value);
  const committedMixedRef = useRef(isMixed);
  // 이번 편집에서 값을 내보냈는지. 되돌릴 게 없으면 취소가 호출부를 건드리면 안 된다
  const emittedRef = useRef(false);

  // 권위값·화면값·비교 기준을 한 번에 맞춘다. 셋이 갈라지면 스텝이 화면과 다른 수에서 이어진다
  const syncText = (text: string) => {
    draftRef.current = text;
    renderedRef.current = text;
    setLocalValue(text);
  };

  // 발행은 한 곳으로 모은다. 타이핑이 내보낸 값을 스텝이 모르면
  // 스텝이 우연히 이전 스텝값과 같아졌을 때 발행이 통째로 빠진다
  const emitValue = (next: number) => {
    lastEmittedRef.current = next;
    emittedRef.current = true;
    scheduleCommit(next);
  };

  // 취소는 값을 내보낸 것과 같은 채널로 되돌린다.
  // onPreview가 없는 입력은 타이핑이 onChange로 이미 저장까지 갔으므로 되돌릴 길이 그것뿐이다
  const restorePreview = () => {
    if (onCancel) {
      onCancel();
      return;
    }
    if (!emittedRef.current) return;
    // Mixed는 되돌릴 값이 하나가 아니다. 표시되던 대표값을 발행하면
    // 호출부가 그 값을 선택된 요소 전부에 적용해 요소별 값이 사라진다.
    // 지금도 함께 보는 이유: 분리 패널 selection sync는 포커스를 유지한 채 선택만
    // 갈아끼워서, 편집을 시작한 선택과 지금 쓰이는 대상이 다를 수 있다.
    // 항목별 복원은 gesture를 가진 onCancel만 할 수 있다
    if (committedMixedRef.current || isMixed) return;

    const committedValue = committedValueRef.current;
    const committed =
      typeof committedValue === 'number'
        ? committedValue
        : Number(committedValue);
    if (Number.isFinite(committed)) (onPreview ?? onChange)(committed);
  };

  const cancelDraft = () => {
    cancelPendingCommit();
    syncText(
      committedMixedRef.current
        ? ''
        : getDisplayValue(committedValueRef.current),
    );
    hasUserInputRef.current = false;
    fieldError.clear();
    digitPop.clear();
    restorePreview();
  };

  // 스텝 기준은 편집 중인 값이 우선. 비었거나 부호만 남은 중간 상태면 확정값으로 돌아간다.
  // Mixed는 대표값이 기준 - 타이핑과 마찬가지로 절대값을 전체에 적용한다
  const resolveStepBase = (): number => {
    // sanitizer는 숫자와 부호만 남기므로 지수 표기가 전혀 다른 수가 된다 (1e-7 -> 17).
    // 그대로 숫자로 읽히는 draft는 손대지 않고 쓴다
    if (canParseNumericInput(draftRef.current)) {
      return Number(draftRef.current);
    }
    const typed = sanitizeNumericInput(draftRef.current);
    if (canParseNumericInput(typed)) return Number(typed);
    const committed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(committed) ? committed : 0;
  };

  // 한 프레임에 쌓인 스텝을 합쳐 한 번만 내보낸다. 스텝마다 화면과 캔버스를 갱신하면
  // 처리가 키 반복을 못 따라가 이벤트가 밀리고, 손을 뗀 뒤에도 값이 계속 올라간다.
  // 꾹 누르는 동안에는 값만 바꾼다 - 자릿수가 매 스텝 깜빡이면 값을 눈으로 좇을 수 없다
  const flushStep = () => {
    const suppressDigitPop = suppressDigitPopRef.current;
    suppressDigitPopRef.current = false;
    // 예약과 실행 사이에 min/max가 바뀔 수 있어 실행 시점 규칙으로 다시 재운다.
    // 화면과 내보내는 값이 갈라지지 않게 둘 다 이 결과를 쓴다
    const parsed = parseAndClamp(draftRef.current);
    const nextText = parsed === null ? draftRef.current : String(parsed);
    const prevText = renderedRef.current;

    // 표시가 이미 최신이어도 아래 발행 게이트는 지나야 한다.
    // 간격 때문에 미뤄둔 마지막 값이 여기서 나간다
    if (nextText === prevText) {
      draftRef.current = nextText;
    } else {
      // 꾹 누르는 구간은 재생하지 않는다. 반복 간격이 재생보다 짧아
      // 자릿수가 계속 깜빡이면 값을 눈으로 좇을 수 없다
      if (holdKeyRef.current === null && !suppressDigitPop) {
        const prevNumber = canParseNumericInput(prevText)
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

    if (parsed === null) return;
    if (parsed === lastEmittedRef.current) return;
    // 타이핑과 같은 경로 - 확정은 blur/Enter가 한 번에 한다
    emitValue(parsed);
  };

  const stepBy = (
    stepper: (base: number) => number,
    repeat: boolean,
    key: string,
  ): boolean => {
    const base = resolveStepBase();
    // 반올림은 스텝 뒤에 - 먼저 반올림하면 63.4 ↓가 63을 건너뛰고 62가 된다
    const stepped = stepper(base);
    const next = clampValue(supportsDecimal ? stepped : Math.round(stepped));
    const nextText = String(next);
    // 상·하한에 닿아 값이 그대로면 할 일이 없다
    if (nextText === draftRef.current) {
      suppressDigitPopRef.current = false;
      return false;
    }

    // keyup을 놓쳐도 다음 단발 누름이 꾹 누르기 상태를 되돌린다
    holdKeyRef.current = repeat ? key : null;

    stepBaseRef.current = base;
    draftRef.current = nextText;
    hasUserInputRef.current = true;

    if (repeat) {
      // 예약해 둔 함수가 아니라 최신 렌더의 것을 실행해야 한다.
      // 예약과 실행 사이에 min/max가 바뀌면 낡은 규칙으로 확정된다.
      // 대상 전환은 이 경로로 막지 않는다 - 최신 콜백은 새 대상을 가리킨다
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

  // 손을 떼면 밀린 스텝과 최종값을 간격 제한 없이 반영한다.
  // 재생은 하지 않는다 - 꾹 눌러 이동하는 동안은 처음부터 끝까지 값만 움직인다.
  // keyup을 못 받아도 값은 이미 맞고, 다음 단발 누름이 상태를 되돌린다
  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== holdKeyRef.current) return;

    stepFrame.cancel();
    flushStep();
    holdKeyRef.current = null;
  };

  // 숫자, 마이너스, 소수점(옵션), 백스페이스, Delete, 화살표, Tab, Enter만 허용
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter는 blur를 통해 확정, Escape는 확정 없이 원복
    if (e.key === 'Enter') {
      if (isExpressionDraft(draftRef.current)) {
        const evaluated = evaluateAndClampExpression(draftRef.current);
        if (evaluated === null) {
          e.preventDefault();
          fieldError.raise();
          return;
        }
        fieldError.clear();
        digitPop.clear();
      }
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Escape') {
      // 되돌릴 게 있을 때만 이 필드가 Escape를 소비한다.
      // 팝업과 모달은 defaultPrevented로 한 겹씩 닫으므로, 편집을 되돌리는 Escape가
      // 그대로 올라가면 값만 되돌리려다 감싸는 피커까지 접힌다.
      // 반대로 손대지 않은 필드가 삼키면 모달이 첫 Escape에 안 닫힌다
      if (hasUserInputRef.current) e.preventDefault();
      escapedRef.current = true;
      e.currentTarget.blur();
      return;
    }

    // 위아래 방향키는 값 조절. Ctrl/Cmd 조합은 캐럿 이동 관습이라 건드리지 않는다
    if (!e.ctrlKey && !e.metaKey) {
      const stepper = resolveStepper(e.key, e, resolvedDecimalScale, step);
      if (stepper !== null) {
        // 버리는 이벤트도 기본 동작(캐럿 이동)은 막아야 한다
        e.preventDefault();
        // 스크럽 중에는 포인터가 값의 권위다. 붙잡은 방향키 반복이 끼어들지 않게
        if (scrub.active) return;
        if (isStaleRepeat(e.nativeEvent)) return;
        if (isExpressionDraft(draftRef.current)) {
          const evaluated = evaluateAndClampExpression(draftRef.current);
          if (evaluated === null) {
            // Enter와 같은 신호를 준다. 아무 반응이 없으면 방향키가 죽은 것으로 읽힌다.
            // 반복은 재생을 매번 끊으므로 첫 누름만
            if (!e.repeat) fieldError.raise();
            return;
          }

          stepFrame.cancel();
          holdKeyRef.current = null;
          syncText(String(evaluated));
          hasUserInputRef.current = true;
          fieldError.clear();
          digitPop.clear();
          suppressDigitPopRef.current = true;
          const stepped = stepBy(stepper, e.repeat, e.key);
          if (!stepped && evaluated !== lastEmittedRef.current) {
            emitValue(evaluated);
          }
          return;
        }
        stepBy(stepper, e.repeat, e.key);
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

    // 허용된 특수 키
    if (allowedKeys.includes(e.key)) {
      return;
    }

    // Ctrl/Cmd 조합 허용 (복사, 붙여넣기, 전체선택 등)
    if (e.ctrlKey || e.metaKey) {
      return;
    }

    // 숫자와 수식 문자
    if (/^[0-9+\-*/()]$/.test(e.key) || e.key === ' ') {
      return;
    }

    if (e.key === '.' || e.key === 'Decimal') {
      return;
    }

    // 그 외 모든 키 입력 차단
    e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 밀린 스텝이 뒤늦게 도착하면 방금 친 글자를 덮는다.
    // 타이핑이 끼어들면 꾹 누르기 구간도 끝난 것으로 본다
    stepFrame.cancel();
    holdKeyRef.current = null;
    suppressDigitPopRef.current = false;

    const newValue = normalizeDraftInput(e.target.value);
    if (newValue === null) {
      e.currentTarget.value = draftRef.current;
      return;
    }

    syncText(newValue);
    hasUserInputRef.current = true;
    fieldError.clear();

    if (isExpressionDraft(newValue)) return;
    const clamped = parseAndClamp(newValue);
    if (clamped !== null) {
      // 게스처 모드에서는 타이핑이 preview로만 흐름
      emitValue(clamped);
    }
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
    if (!isMixed) {
      const numericValue =
        typeof value === 'number'
          ? String(normalizePrecision(value))
          : String(value);
      syncText(numericValue);
    } else {
      syncText('');
    }
  };

  // 포커스 중 표시는 숫자만, 아니면 단위까지
  const draftTextFor = (num: number): string =>
    isFocused ? String(normalizePrecision(num)) : getDisplayValue(num);

  // 접두 스크럽은 preview 채널이 있을 때만 켠다. 없으면 liveCommit이 onChange라
  // 이동마다 저장이 나가 방향키 꾹 누르기와 같은 적체가 생긴다
  const scrubEnabled = Boolean(prefix) && Boolean(onPreview) && !disabled;
  const scrub = useScrubDrag({
    enabled: scrubEnabled,
    resolveBase: () => {
      digitPop.clear();
      // 비포커스 표시값의 %, ° 같은 suffix는 수식 문자가 아니다
      // 실제 수식을 편집 중인 포커스 상태에서만 평가 경로로 보낸다
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
    step: step ?? 1,
    quantize: (raw) => clampValue(supportsDecimal ? raw : Math.round(raw)),
    // 접두 손잡이와 입력은 같은 label 아래에 있다
    ownsFocus: (active, handle) =>
      handle.parentElement?.contains(active) ?? false,
    onMove: (next) => {
      // 밀린 키 스텝은 버린다. 드래그가 그 값 위에서 이어지면 손을 뗀 뒤 값이 한 번 더 뛴다
      stepFrame.cancel();
      holdKeyRef.current = null;
      // 포커스를 옮기지 않는 스크럽에서도 단위 유무가 바뀌지 않게 표시 형식을 유지
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
      onChange(final);
    },
    onCancel: () => {
      cancelPendingCommit();
      syncText(
        committedMixedRef.current
          ? ''
          : draftTextFor(Number(committedValueRef.current)),
      );
      hasUserInputRef.current = false;
      fieldError.clear();
      digitPop.clear();
      restorePreview();
    },
  });

  useEffect(() => {
    // 스크럽 중에는 로컬 draft가 표시 권위다. after-paint preview가 늦게 돌아와도
    // 현재 포인터 값과 단위 문자열을 한 프레임 전 값으로 덮지 않는다
    if (!isFocused && !scrub.active) {
      syncText(isMixed ? '' : getDisplayValue(value));
      hasUserInputRef.current = false;
      committedValueRef.current = value;
      committedMixedRef.current = isMixed;
    }
    // active 종료만으로 옛 prop을 다시 쓰지 않는다. 최종 onChange의 value 변경이 동기화한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused, isMixed]);

  const handleBlur = () => {
    setIsFocused(false);
    // 확정과 취소 모두 최종값을 직접 들고 간다. 밀린 스텝이 그 뒤에 도착하면
    // 취소한 값이 되살아나거나 확정 뒤에 값이 한 번 더 움직인다
    stepFrame.cancel();
    holdKeyRef.current = null;

    // 끌고 있는 도중의 blur(창 전환, 분리 패널 포커스 정산)는 취소다.
    // 드래그 draft를 확정하면 창 blur 리스너가 저장을 만든다.
    // 잡기만 하고 안 움직인 세션은 값을 건드리지 않았으므로 평소 정산으로 이어간다
    if (scrub.cancel()) return;

    // Escape는 확정 없이 표시값 원복
    if (escapedRef.current) {
      escapedRef.current = false;
      cancelDraft();
      return;
    }

    // 확정 기준은 화면 state가 아니라 권위값. 마지막 입력과 blur가 같은 커밋에
    // 몰리면 state는 아직 이전 값이다
    // 손대지 않은 필드는 아무것도 쓰지 않는다. 포커스 중 외부에서 값이 바뀌었으면
    // 편집 시작 때 떠 온 옛 draft가 새 값을 덮어쓴다
    if (!hasUserInputRef.current) {
      syncText(isMixed ? '' : getDisplayValue(value));
      fieldError.clear();
      onBlur?.();
      return;
    }

    if (isExpressionDraft(draftRef.current)) {
      const evaluated = evaluateAndClampExpression(draftRef.current);
      if (evaluated === null) {
        cancelDraft();
        return;
      }

      syncText(getDisplayValue(evaluated));
      hasUserInputRef.current = false;
      fieldError.clear();
      digitPop.clear();
      cancelPendingCommit();
      onChange(evaluated);
      onBlur?.(evaluated);
      return;
    }

    const clamped = parseAndClamp(draftRef.current);
    if (clamped === null) {
      cancelDraft();
      return;
    }

    syncText(getDisplayValue(clamped));
    cancelPendingCommit();
    onChange(clamped);
    hasUserInputRef.current = false;
    fieldError.clear();
    // 확정값을 그대로 넘긴다. onChange가 예약한 state를 호출부가 같은 이벤트에서
    // 읽으면 아직 이전 값이라, 밀린 스텝이 있는 채로 blur하면 옛 값이 저장된다
    onBlur?.(clamped ?? undefined);
  };

  // Mixed 상태일 때 placeholder 표시 여부
  const showMixedPlaceholder = isMixed && !isFocused && localValue === '';

  return (
    <NumberInputShell
      prefix={prefix}
      scrub={scrubEnabled ? scrub : undefined}
      width={width}
      focused={isFocused}
      invalid={fieldError.active}
      shaking={fieldError.shaking}
      onAnimationEnd={fieldError.handleAnimationEnd}
    >
      <NumberInputField
        inputMode={supportsDecimal ? 'decimal' : 'numeric'}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={showMixedPlaceholder ? mixedPlaceholder : undefined}
        textClass={showMixedPlaceholder ? 'text-fg-faint italic' : 'text-fg'}
        placeholderClass={
          showMixedPlaceholder
            ? 'placeholder:text-fg-faint placeholder:italic'
            : ''
        }
        ariaLabel={ariaLabel}
        disabled={disabled}
        pop={digitPop.pop}
        invalid={fieldError.active}
        tooltip={messages.expressionHint}
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
  const messages = useNumberInputMessages();
  const resolvedDecimalScale = allowDecimal
    ? Math.max(0, Math.floor(decimalScale))
    : 0;
  const supportsDecimal = resolvedDecimalScale > 0;
  const inputMode = supportsDecimal ? 'decimal' : 'numeric';

  const normalizePrecision = (num: number): number => {
    if (!supportsDecimal) return num;
    return Number(num.toFixed(resolvedDecimalScale));
  };

  // 숫자 모드에서는 부호를 맨 앞에 하나, 소수점도 하나만 유지
  const sanitizeInput = (raw: string): string => {
    const pattern = supportsDecimal ? /[^0-9.-]/g : /[^0-9-]/g;
    let sanitized = raw.replace(pattern, '');

    const isNegative = sanitized.startsWith('-');
    sanitized = sanitized.replace(/-/g, '');
    if (isNegative) sanitized = `-${sanitized}`;

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

  const normalizeDraftInput = (raw: string): string | null => {
    // 잘라서 받으면 사용자가 넣지 않은 다른 유효 수식이 확정될 수 있어 통째로 거절한다
    if (raw.length > MAX_EXPRESSION_LENGTH) return null;
    if (!ARITHMETIC_INPUT_PATTERN.test(raw)) return null;
    if (isPartialNumericInput(raw)) {
      return sanitizeInput(raw);
    }
    if (canParseNumericInput(raw)) {
      return !supportsDecimal && raw.includes('.') ? raw : sanitizeInput(raw);
    }
    return raw;
  };

  // 정밀도 정규화가 먼저다. 클램프를 먼저 하면 반올림이 값을 경계 밖으로 밀어낸다
  // (자릿수 1에 max 0.96이면 0.96으로 자른 뒤 1.0이 되어 상한을 넘는다)
  const domainMin = allowNegative ? min : Math.max(0, min);
  const clampValue = (num: number): number =>
    Math.min(Math.max(normalizePrecision(num), domainMin), max);

  const evaluateAndClampExpression = (input: string): number | null => {
    const evaluated = evaluateArithmeticExpression(input);
    if (evaluated === null) return null;
    return clampValue(supportsDecimal ? evaluated : Math.round(evaluated));
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
  const fieldError = useFieldError();
  // Escape로 blur된 경우 확정 없이 원복
  const escapedRef = useRef(false);
  const liveCommit = onPreview ?? onChange;
  const { scheduleCommit, cancelPendingCommit } = useAfterPaintValueCommit<
    number | undefined
  >({
    onCommit: liveCommit,
    strategy: commitStrategy,
  });
  const digitPop = useDigitPop();
  const stepFrame = useFrameCoalescer();
  // 편집 중 권위값. 같은 React 커밋 안에서 이벤트가 여러 개 처리되면 state는 아직
  // 이전 값이라 스텝 기준이 어긋난다. 화면에 나간 값은 renderedRef가 따로 기억한다
  const draftRef = useRef(localValue);
  const renderedRef = useRef(localValue);
  const hasUserInputRef = useRef(false);
  // 꾹 누르고 있는 키. 이 구간은 값만 바뀌고 재생하지 않는다.
  // 키를 구분해야 위를 누른 채 아래를 뗐을 때 엉뚱하게 끝나지 않는다
  const holdKeyRef = useRef<string | null>(null);
  const lastEmittedRef = useRef<number | null>(null);
  // 스텝이 출발한 값. 빈 값에서 시작하면 화면 문자열로는 방향을 알 수 없다
  const stepBaseRef = useRef(0);
  const suppressDigitPopRef = useRef(false);
  const committedValueRef = useRef(value);
  const committedMixedRef = useRef(isMixed);
  // 이번 편집에서 값을 내보냈는지. 되돌릴 게 없으면 취소가 호출부를 건드리면 안 된다
  const emittedRef = useRef(false);

  // 권위값·화면값·비교 기준을 한 번에 맞춘다. 셋이 갈라지면 스텝이 화면과 다른 수에서 이어진다
  const syncText = (text: string) => {
    draftRef.current = text;
    renderedRef.current = text;
    setLocalValue(text);
  };

  // 발행은 한 곳으로 모은다. 타이핑이 내보낸 값을 스텝이 모르면
  // 스텝이 우연히 이전 스텝값과 같아졌을 때 발행이 통째로 빠진다.
  // unset은 숫자가 아니므로 기준을 비워 다음 스텝이 반드시 나가게 한다
  const emitValue = (next: number | undefined) => {
    lastEmittedRef.current = next ?? null;
    emittedRef.current = true;
    scheduleCommit(next);
  };

  // 취소는 값을 내보낸 것과 같은 채널로 되돌린다.
  // onPreview가 없는 입력은 타이핑이 onChange로 이미 저장까지 갔으므로 되돌릴 길이 그것뿐이다
  const restorePreview = () => {
    if (onCancel) {
      onCancel();
      return;
    }
    if (!emittedRef.current) return;
    // Mixed는 되돌릴 값이 하나가 아니다. 표시되던 대표값을 발행하면
    // 호출부가 그 값을 선택된 요소 전부에 적용해 요소별 값이 사라진다.
    // 지금도 함께 보는 이유: 분리 패널 selection sync는 포커스를 유지한 채 선택만
    // 갈아끼워서, 편집을 시작한 선택과 지금 쓰이는 대상이 다를 수 있다.
    // 항목별 복원은 gesture를 가진 onCancel만 할 수 있다
    if (committedMixedRef.current || isMixed) return;
    (onPreview ?? onChange)(committedValueRef.current);
  };

  const cancelDraft = () => {
    cancelPendingCommit();
    const committedValue = committedValueRef.current;
    syncText(
      committedMixedRef.current || committedValue == null
        ? ''
        : getDisplayValue(committedValue),
    );
    hasUserInputRef.current = false;
    fieldError.clear();
    digitPop.clear();
    restorePreview();
  };

  useEffect(() => {
    if (!isFocused) {
      syncText(isMixed || value == null ? '' : getDisplayValue(value));
      hasUserInputRef.current = false;
      committedValueRef.current = value;
      committedMixedRef.current = isMixed;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused, isMixed]);

  // 값이 비어 있으면 placeholder에 보이는 상속값이 기준이다.
  // 화면에 16px이 떠 있는데 0에서 시작하면 방향키가 값을 되돌리는 것처럼 보인다
  const resolveStepBase = (): number => {
    // sanitizer는 숫자와 부호만 남기므로 지수 표기가 전혀 다른 수가 된다 (1e-7 -> 17).
    // 그대로 숫자로 읽히는 draft는 손대지 않고 쓴다
    if (canParseNumericInput(draftRef.current)) {
      return Number(draftRef.current);
    }
    const typed = sanitizeInput(draftRef.current);
    if (canParseNumericInput(typed)) {
      return Number(typed);
    }
    if (value != null) return value;
    return parseLeadingNumber(placeholder) ?? 0;
  };

  // 한 프레임에 쌓인 스텝을 합쳐 한 번만 내보낸다. 스텝마다 화면과 캔버스를 갱신하면
  // 처리가 키 반복을 못 따라가 이벤트가 밀리고, 손을 뗀 뒤에도 값이 계속 올라간다.
  // 꾹 누르는 동안에는 값만 바꾼다 - 자릿수가 매 스텝 깜빡이면 값을 눈으로 좇을 수 없다
  const flushStep = () => {
    const suppressDigitPop = suppressDigitPopRef.current;
    suppressDigitPopRef.current = false;
    // 예약과 실행 사이에 min/max가 바뀔 수 있어 실행 시점 규칙으로 다시 재운다.
    // 화면과 내보내는 값이 갈라지지 않게 둘 다 이 결과를 쓴다
    const clamped = clampValue(Number(draftRef.current));
    const nextText = String(clamped);
    const prevText = renderedRef.current;

    // 표시가 이미 최신이어도 아래 발행 게이트는 지나야 한다.
    // 간격 때문에 미뤄둔 마지막 값이 여기서 나간다
    if (nextText === prevText) {
      draftRef.current = nextText;
    } else {
      // 꾹 누르는 구간은 재생하지 않는다. 반복 간격이 재생보다 짧아
      // 자릿수가 계속 깜빡이면 값을 눈으로 좇을 수 없다
      if (holdKeyRef.current === null && !suppressDigitPop) {
        const prevNumber = isPartialNumericInput(prevText)
          ? stepBaseRef.current
          : Number(prevText);
        digitPop.play(prevText, nextText, stepDirection(prevNumber, clamped));
      }
      syncText(nextText);
    }

    if (clamped === lastEmittedRef.current) return;
    // 타이핑과 같은 경로 - 확정은 blur/Enter가 한 번에 한다
    emitValue(clamped);
  };

  const stepBy = (
    stepper: (base: number) => number,
    repeat: boolean,
    key: string,
  ): boolean => {
    const base = resolveStepBase();
    // 반올림은 스텝 뒤에 - 먼저 반올림하면 63.4 ↓가 63을 건너뛰고 62가 된다
    const stepped = stepper(base);
    const next = clampValue(supportsDecimal ? stepped : Math.round(stepped));
    const nextText = String(next);
    // 상·하한에 닿아 값이 그대로면 할 일이 없다
    if (nextText === draftRef.current) {
      suppressDigitPopRef.current = false;
      return false;
    }

    // keyup을 놓쳐도 다음 단발 누름이 꾹 누르기 상태를 되돌린다
    holdKeyRef.current = repeat ? key : null;

    stepBaseRef.current = base;
    draftRef.current = nextText;
    hasUserInputRef.current = true;

    if (repeat) {
      // 예약해 둔 함수가 아니라 최신 렌더의 것을 실행해야 한다.
      // 예약과 실행 사이에 min/max가 바뀌면 낡은 규칙으로 확정된다.
      // 대상 전환은 이 경로로 막지 않는다 - 최신 콜백은 새 대상을 가리킨다
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

  // 손을 떼면 밀린 스텝과 최종값을 간격 제한 없이 반영한다.
  // 재생은 하지 않는다 - 꾹 눌러 이동하는 동안은 처음부터 끝까지 값만 움직인다.
  // keyup을 못 받아도 값은 이미 맞고, 다음 단발 누름이 상태를 되돌린다
  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== holdKeyRef.current) return;

    stepFrame.cancel();
    flushStep();
    holdKeyRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter는 blur를 통해 확정, Escape는 확정 없이 원복
    if (e.key === 'Enter') {
      if (isExpressionDraft(draftRef.current)) {
        const evaluated = evaluateAndClampExpression(draftRef.current);
        if (evaluated === null) {
          e.preventDefault();
          fieldError.raise();
          return;
        }
        fieldError.clear();
        digitPop.clear();
      }
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Escape') {
      // 되돌릴 게 있을 때만 이 필드가 Escape를 소비한다.
      // 팝업과 모달은 defaultPrevented로 한 겹씩 닫으므로, 편집을 되돌리는 Escape가
      // 그대로 올라가면 값만 되돌리려다 감싸는 피커까지 접힌다.
      // 반대로 손대지 않은 필드가 삼키면 모달이 첫 Escape에 안 닫힌다
      if (hasUserInputRef.current) e.preventDefault();
      escapedRef.current = true;
      e.currentTarget.blur();
      return;
    }

    // 위아래 방향키는 값 조절. Ctrl/Cmd 조합은 캐럿 이동 관습이라 건드리지 않는다
    if (!e.ctrlKey && !e.metaKey) {
      const stepper = resolveStepper(e.key, e, resolvedDecimalScale);
      if (stepper !== null) {
        // 버리는 이벤트도 기본 동작(캐럿 이동)은 막아야 한다
        e.preventDefault();
        if (isStaleRepeat(e.nativeEvent)) return;
        if (isExpressionDraft(draftRef.current)) {
          const evaluated = evaluateAndClampExpression(draftRef.current);
          if (evaluated === null) {
            // Enter와 같은 신호를 준다. 아무 반응이 없으면 방향키가 죽은 것으로 읽힌다.
            // 반복은 재생을 매번 끊으므로 첫 누름만
            if (!e.repeat) fieldError.raise();
            return;
          }

          stepFrame.cancel();
          holdKeyRef.current = null;
          syncText(String(evaluated));
          hasUserInputRef.current = true;
          fieldError.clear();
          digitPop.clear();
          suppressDigitPopRef.current = true;
          const stepped = stepBy(stepper, e.repeat, e.key);
          if (!stepped && evaluated !== lastEmittedRef.current) {
            emitValue(evaluated);
          }
          return;
        }
        stepBy(stepper, e.repeat, e.key);
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

    if (allowedKeys.includes(e.key)) return;
    if (e.ctrlKey || e.metaKey) return;
    if (/^[0-9+\-*/()]$/.test(e.key) || e.key === ' ') return;
    if (e.key === '.' || e.key === 'Decimal') return;

    e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 밀린 스텝이 뒤늦게 도착하면 방금 친 글자를 덮는다.
    // 타이핑이 끼어들면 꾹 누르기 구간도 끝난 것으로 본다
    stepFrame.cancel();
    holdKeyRef.current = null;
    suppressDigitPopRef.current = false;

    const newValue = normalizeDraftInput(e.target.value);
    if (newValue === null) {
      e.currentTarget.value = draftRef.current;
      return;
    }

    syncText(newValue);
    hasUserInputRef.current = true;
    fieldError.clear();

    // 빈 값만 unset, 부호·소수점만 남은 중간 상태는 commit하지 않고 입력 유지
    if (newValue === '') {
      emitValue(undefined);
      return;
    }
    if (isPartialNumericInput(newValue) || isExpressionDraft(newValue)) {
      return;
    }

    const numValue = Number(newValue);
    if (!Number.isFinite(numValue)) return;

    emitValue(clampValue(supportsDecimal ? numValue : Math.round(numValue)));
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
    syncText(!isMixed && value != null ? String(value) : '');
  };

  const handleBlur = () => {
    setIsFocused(false);
    // 확정과 취소 모두 최종값을 직접 들고 간다. 밀린 스텝이 그 뒤에 도착하면
    // 취소한 값이 되살아나거나 확정 뒤에 값이 한 번 더 움직인다
    stepFrame.cancel();
    holdKeyRef.current = null;

    // Escape는 확정 없이 표시값 원복
    if (escapedRef.current) {
      escapedRef.current = false;
      cancelDraft();
      return;
    }

    // 확정 기준은 화면 state가 아니라 권위값. 마지막 입력과 blur가 같은 커밋에
    // 몰리면 state는 아직 이전 값이다
    // 손대지 않은 필드는 아무것도 쓰지 않는다. Mixed가 풀리며 값이 들어온 뒤
    // 그대로 blur하면 빈 draft가 그 값을 지운다
    if (!hasUserInputRef.current) {
      syncText(isMixed || value == null ? '' : getDisplayValue(value));
      fieldError.clear();
      onBlur?.();
      return;
    }

    if (draftRef.current === '') {
      syncText('');
      cancelPendingCommit();
      onChange(undefined);
      hasUserInputRef.current = false;
      fieldError.clear();
      digitPop.clear();
      onBlur?.();
      return;
    }

    if (isExpressionDraft(draftRef.current)) {
      const evaluated = evaluateAndClampExpression(draftRef.current);
      if (evaluated === null) {
        cancelDraft();
        return;
      }

      syncText(getDisplayValue(evaluated));
      cancelPendingCommit();
      onChange(evaluated);
      hasUserInputRef.current = false;
      fieldError.clear();
      digitPop.clear();
      onBlur?.(evaluated);
      return;
    }

    const cleaned = draftRef.current;
    if (isPartialNumericInput(cleaned) || !Number.isFinite(Number(cleaned))) {
      cancelDraft();
      return;
    }

    const parsed = Number(cleaned);
    const clamped = clampValue(supportsDecimal ? parsed : Math.round(parsed));
    syncText(getDisplayValue(clamped));
    cancelPendingCommit();
    onChange(clamped);
    hasUserInputRef.current = false;
    // 확정값을 그대로 넘긴다. onChange가 예약한 state를 호출부가 같은 이벤트에서
    // 읽으면 아직 이전 값이라, 밀린 스텝이 있는 채로 blur하면 옛 값이 저장된다
    onBlur?.(clamped);
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
      prefix={prefix}
      width={width}
      focused={isFocused}
      invalid={fieldError.active}
      shaking={fieldError.shaking}
      onAnimationEnd={fieldError.handleAnimationEnd}
    >
      <NumberInputField
        inputMode={inputMode}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={effectivePlaceholder}
        textClass={textClass}
        placeholderClass={placeholderClass}
        pop={digitPop.pop}
        invalid={fieldError.active}
        tooltip={messages.expressionHint}
      />
    </NumberInputShell>
  );
};
