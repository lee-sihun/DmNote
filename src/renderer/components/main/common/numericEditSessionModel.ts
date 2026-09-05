import {
  evaluateArithmeticExpression,
  MAX_EXPRESSION_LENGTH,
} from '@utils/core/arithmeticExpression';
import {
  ARITHMETIC_INPUT_PATTERN,
  canParseNumericInput,
  isPartialNumericInput,
} from './numberInputModel';

interface NumericEditModelOptions {
  allowDecimal: boolean;
  decimalScale: number;
  min: number;
  max: number;
  suffix?: string;
}

export const createNumericEditModel = ({
  allowDecimal,
  decimalScale,
  min,
  max,
  suffix,
}: NumericEditModelOptions) => {
  const resolvedDecimalScale = allowDecimal
    ? Math.max(0, Math.floor(decimalScale))
    : 0;
  const supportsDecimal = resolvedDecimalScale > 0;

  const normalizePrecision = (num: number): number => {
    if (!supportsDecimal) return num;
    return Number(num.toFixed(resolvedDecimalScale));
  };

  // 부호는 맨 앞에 하나, 소수점도 하나만 유지
  const sanitizeNumericInput = (raw: string): string => {
    let sanitized = raw.replace(supportsDecimal ? /[^0-9.-]/g : /[^0-9-]/g, '');
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
    // 잘라서 다른 유효 수식으로 확정되는 상황 방지
    if (raw.length > MAX_EXPRESSION_LENGTH) return null;
    if (!ARITHMETIC_INPUT_PATTERN.test(raw)) return null;
    if (isPartialNumericInput(raw)) return sanitizeNumericInput(raw);
    if (canParseNumericInput(raw)) {
      return !supportsDecimal && raw.includes('.')
        ? raw
        : sanitizeNumericInput(raw);
    }
    return raw;
  };

  // 정밀도 정규화 뒤 도메인 제한
  const clampValue = (num: number): number =>
    Math.min(Math.max(normalizePrecision(num), min), max);

  const parseAndClamp = (input: string): number | null => {
    if (!canParseNumericInput(input)) return null;
    const parsed = Number(input);
    return clampValue(supportsDecimal ? parsed : Math.round(parsed));
  };

  const evaluateAndClampExpression = (input: string): number | null => {
    const evaluated = evaluateArithmeticExpression(input);
    if (evaluated === null) return null;
    return clampValue(supportsDecimal ? evaluated : Math.round(evaluated));
  };

  const getDisplayValue = (value: number | string): string => {
    const normalized =
      typeof value === 'number' ? normalizePrecision(value) : value;
    return suffix ? `${normalized}${suffix}` : String(normalized);
  };

  return {
    resolvedDecimalScale,
    supportsDecimal,
    normalizePrecision,
    sanitizeNumericInput,
    normalizeDraftInput,
    clampValue,
    parseAndClamp,
    evaluateAndClampExpression,
    getDisplayValue,
  };
};
