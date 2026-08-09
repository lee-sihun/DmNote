/* eslint-disable react-hooks/set-state-in-effect */
import React, {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import type {
  PropertyRowProps,
  NumberInputProps,
  OptionalNumberInputProps,
  TextInputProps,
  ColorInputProps,
  ToggleSwitchProps,
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
import PopupExit from '@components/main/Modal/PopupExit';
import DigitPopLayer from '@components/main/common/DigitPopLayer';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { useDigitPop, type DigitPopState } from '@hooks/ui/useDigitPop';
import { useFrameCoalescer } from '@hooks/ui/useFrameCoalescer';
import { useFieldError } from '@hooks/ui/useFieldError';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import {
  isStaleRepeat,
  parseLeadingNumber,
  resolveStepDelta,
} from '@utils/core/numberStep';
import {
  evaluateArithmeticExpression,
  MAX_EXPRESSION_LENGTH,
} from '@utils/core/arithmeticExpression';
import { gradientToCss } from '@src/types/color';
import { useTranslation } from '@contexts/useTranslation';
import { I18nContext } from '@contexts/I18nContextDef';
import { registerEditorDraftForLifecycle } from '@src/renderer/editor/runtime/lifecycleEditorDraft';
import { useAfterPaintValueCommit } from '@hooks/useAfterPaintValueCommit';
import { useOptimisticBooleanCommit } from '@hooks/useOptimisticBooleanCommit';
import TabSwitch from '@components/main/common/TabSwitch';

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
// 잘못된 수식은 링과 흔들기로만 알린다. 말풍선까지 띄우면 좁은 패널에서
// 아래 행을 덮고, 스크롤 뷰포트가 overflow-y auto라 가로로도 잘린다
const NumberInputShell: React.FC<{
  prefix?: string;
  width: string;
  focused: boolean;
  invalid: boolean;
  shaking: boolean;
  onAnimationEnd: (event: React.AnimationEvent<HTMLElement>) => void;
  children: React.ReactNode;
}> = ({
  prefix,
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
      <span className="shrink-0 text-fg-muted text-body">{prefix}</span>
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
        inputMode={inputMode}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        title={tooltip}
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
  // 미지정 방향은 무제한 — 플러그인 설정 스키마의 optional min/max 계약과 동일
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  prefix,
  suffix,
  width = '54px',
  allowDecimal = false,
  decimalScale = 1,
  step,
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
    if (isPartialNumericInput(raw) || canParseNumericInput(raw)) {
      return sanitizeNumericInput(raw);
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

    return clampValue(Number(input));
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
    // 항목별 복원은 gesture를 가진 onCancel만 할 수 있다
    if (committedMixedRef.current) return;

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

  useEffect(() => {
    if (!isFocused) {
      syncText(isMixed ? '' : getDisplayValue(value));
      hasUserInputRef.current = false;
      committedValueRef.current = value;
      committedMixedRef.current = isMixed;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isFocused, isMixed]);

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

  const stepBy = (delta: number, repeat: boolean, key: string): boolean => {
    const base = resolveStepBase();
    const next = clampValue(
      (supportsDecimal ? base : Math.round(base)) + delta,
    );
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
      // 예약과 실행 사이에 선택이나 min/max가 바뀌면 낡은 규칙으로 확정된다
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
      const delta = resolveStepDelta(e.key, e, resolvedDecimalScale, step);
      if (delta !== null) {
        // 버리는 이벤트도 기본 동작(캐럿 이동)은 막아야 한다
        e.preventDefault();
        if (isStaleRepeat(e.nativeEvent)) return;
        if (isExpressionDraft(draftRef.current)) {
          const evaluated = evaluateAndClampExpression(draftRef.current);
          if (evaluated === null) return;

          stepFrame.cancel();
          holdKeyRef.current = null;
          syncText(String(evaluated));
          hasUserInputRef.current = true;
          fieldError.clear();
          digitPop.clear();
          suppressDigitPopRef.current = true;
          const stepped = stepBy(delta, e.repeat, e.key);
          if (!stepped && evaluated !== lastEmittedRef.current) {
            emitValue(evaluated);
          }
          return;
        }
        stepBy(delta, e.repeat, e.key);
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
      prefix={showMixedPlaceholder ? undefined : prefix}
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
    if (isPartialNumericInput(raw) || canParseNumericInput(raw)) {
      return sanitizeInput(raw);
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
    // 항목별 복원은 gesture를 가진 onCancel만 할 수 있다
    if (committedMixedRef.current) return;
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

  const stepBy = (delta: number, repeat: boolean, key: string): boolean => {
    const base = resolveStepBase();
    const next = clampValue(
      (supportsDecimal ? base : Math.round(base)) + delta,
    );
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
      // 예약과 실행 사이에 선택이나 min/max가 바뀌면 낡은 규칙으로 확정된다
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
      const delta = resolveStepDelta(e.key, e, resolvedDecimalScale);
      if (delta !== null) {
        // 버리는 이벤트도 기본 동작(캐럿 이동)은 막아야 한다
        e.preventDefault();
        if (isStaleRepeat(e.nativeEvent)) return;
        if (isExpressionDraft(draftRef.current)) {
          const evaluated = evaluateAndClampExpression(draftRef.current);
          if (evaluated === null) return;

          stepFrame.cancel();
          holdKeyRef.current = null;
          syncText(String(evaluated));
          hasUserInputRef.current = true;
          fieldError.clear();
          digitPop.clear();
          suppressDigitPopRef.current = true;
          const stepped = stepBy(delta, e.repeat, e.key);
          if (!stepped && evaluated !== lastEmittedRef.current) {
            emitValue(evaluated);
          }
          return;
        }
        stepBy(delta, e.repeat, e.key);
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

    emitValue(clampValue(numValue));
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

    const clamped = clampValue(Number(cleaned));
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
      prefix={showMixedPlaceholder ? undefined : prefix}
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

// ============================================================================
// 텍스트 입력
// ============================================================================

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  commitStrategy = 'after-paint',
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
  const liveCommit = onPreview ?? onChange;
  const { scheduleCommit, flushPendingCommit, cancelPendingCommit } =
    useAfterPaintValueCommit<string>({
      onCommit: liveCommit,
      strategy: commitStrategy,
    });

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value);
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    if (onPreview) previewedRef.current = true;
    scheduleCommit(e.target.value);
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
      cancelPendingCommit();
      previewedRef.current = false;
      setLocalValue(value);
      // 취소 의미이므로 commit 성격의 onBlur는 호출하지 않음
      onCancel?.();
      return;
    }
    // 확정은 입력 컴포넌트의 최종값 기준 (부모 store 재조회 금지)
    if (onPreview && previewedRef.current) {
      cancelPendingCommit();
      onChange(finalValue);
    } else {
      flushPendingCommit();
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
  pickerMountStrategy = 'after-paint',
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
  const [internalPickerMounted, setInternalPickerMounted] = useState(false);
  const pickerMountFrameRef = useRef<number | null>(null);
  const pickerMountTimerRef = useRef<number | null>(null);

  const cancelPendingPickerMount = useCallback(() => {
    if (pickerMountFrameRef.current !== null) {
      cancelAnimationFrame(pickerMountFrameRef.current);
      pickerMountFrameRef.current = null;
    }
    if (pickerMountTimerRef.current !== null) {
      window.clearTimeout(pickerMountTimerRef.current);
      pickerMountTimerRef.current = null;
    }
  }, []);

  const schedulePickerMount = useCallback(() => {
    cancelPendingPickerMount();
    if (pickerMountStrategy === 'sync') {
      setInternalPickerMounted(true);
      return;
    }
    pickerMountFrameRef.current = requestAnimationFrame(() => {
      pickerMountFrameRef.current = null;
      pickerMountTimerRef.current = window.setTimeout(() => {
        pickerMountTimerRef.current = null;
        setInternalPickerMounted(true);
      }, 0);
    });
  }, [cancelPendingPickerMount, pickerMountStrategy]);

  const closeInternalPicker = useCallback(() => {
    cancelPendingPickerMount();
    setInternalPickerMounted(false);
    setInternalOpen(false);
  }, [cancelPendingPickerMount]);

  useEffect(
    () => () => {
      cancelPendingPickerMount();
    },
    [cancelPendingPickerMount],
  );

  const pickerMounted = isControlled ? open : internalPickerMounted;

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
      if (!isControlled) closeInternalPicker();
    }
  }, [closeInternalPicker, showStateTabs, isControlled]);

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
    } else if (internalOpen) {
      closeInternalPicker();
    } else {
      setInternalOpen(true);
      schedulePickerMount();
    }
  };

  const handleClose = () => {
    if (isControlled) {
      externalOnToggle();
    } else {
      closeInternalPicker();
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
      pickerMounted && window.__dmn_window_type !== 'panel'
        ? canvasAnchor
        : undefined,
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
        aria-haspopup="dialog"
        aria-expanded={open}
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
      <PopupExit open={pickerMounted}>
        {pickerMounted ? (
          <ColorPicker
            open={pickerMounted}
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
        ) : null}
      </PopupExit>
    </>
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

interface FontStyleButtonProps {
  active: boolean;
  title: string;
  onChange: (active: boolean) => void;
  children: React.ReactNode;
}

const FontStyleButton = ({
  active,
  title,
  onChange,
  children,
}: FontStyleButtonProps) => {
  const { value: visualActive, toggle } = useOptimisticBooleanCommit({
    canonicalValue: active,
    onCommit: onChange,
  });
  const buttonClass = visualActive
    ? 'bg-fill-active text-fg'
    : 'text-fg-faint hover:bg-surface-hover hover:text-fg-muted';

  return (
    <button
      type="button"
      aria-pressed={visualActive}
      onClick={toggle}
      className={`w-[24px] h-[21px] flex items-center justify-center transition-colors duration-fast ${buttonClass}`}
      title={title}
    >
      {children}
    </button>
  );
};

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
  return (
    <div className="flex items-center h-[23px] bg-inset rounded-md overflow-hidden">
      <FontStyleButton active={isBold} onChange={onBoldChange} title="Bold">
        <BoldIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isItalic}
        onChange={onItalicChange}
        title="Italic"
      >
        <ItalicIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isUnderline}
        onChange={onUnderlineChange}
        title="Underline"
      >
        <UnderlineIcon />
      </FontStyleButton>
      <FontStyleButton
        active={isStrikethrough}
        onChange={onStrikethroughChange}
        title="Strikethrough"
      >
        <StrikethroughIcon />
      </FontStyleButton>
    </div>
  );
};

// ============================================================================
// 탭 버튼 & 탭
// ============================================================================

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

  return (
    <TabSwitch
      tabs={tabs.map((tab) => ({ id: tab, label: labels[tab] }))}
      activeTab={activeTab}
      onTabChange={onTabChange}
      commitStrategy="after-paint"
    />
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
