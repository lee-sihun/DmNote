import { describe, expect, it } from 'vitest';
import {
  ARITHMETIC_INPUT_PATTERN,
  canParseNumericInput,
  isExpressionDraft,
  isPartialNumericInput,
  stepDirection,
} from './numberInputModel';

describe('numberInputModel', () => {
  it('숫자 편집 중간값과 수식 draft를 구분한다', () => {
    expect(isPartialNumericInput('-.')).toBe(true);
    expect(canParseNumericInput(' 1.25 ')).toBe(true);
    expect(canParseNumericInput('')).toBe(false);
    expect(isExpressionDraft('1 + 2')).toBe(true);
    expect(isExpressionDraft('-')).toBe(false);
  });

  it('허용 문자와 실제 값 변화 방향을 판정한다', () => {
    expect(ARITHMETIC_INPUT_PATTERN.test('(1 + 2) / 3')).toBe(true);
    expect(ARITHMETIC_INPUT_PATTERN.test('1e3')).toBe(false);
    expect(stepDirection(2, 1)).toBe(-1);
    expect(stepDirection(1, 1)).toBe(1);
  });
});
