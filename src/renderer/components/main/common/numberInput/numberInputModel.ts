export const ARITHMETIC_INPUT_PATTERN = /^[0-9+\-*/().\s]*$/;

export const stepDirection = (previous: number, next: number): 1 | -1 =>
  next < previous ? -1 : 1;

export const isPartialNumericInput = (input: string): boolean =>
  input === '' || input === '-' || input === '.' || input === '-.';

export const canParseNumericInput = (input: string): boolean =>
  input.trim() !== '' && Number.isFinite(Number(input));

export const isExpressionDraft = (input: string): boolean =>
  !isPartialNumericInput(input) && !canParseNumericInput(input);
