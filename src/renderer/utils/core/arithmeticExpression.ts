// 입력 단계에서도 같은 한계를 써야 파서가 절대 못 받을 문자열이 화면과 state를 거치지 않는다
export const MAX_EXPRESSION_LENGTH = 256;
const MAX_EXPRESSION_DEPTH = 32;

class ArithmeticParser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): number | null {
    const value = this.parseExpression(0);
    this.skipWhitespace();

    if (value === null || this.position !== this.input.length) {
      return null;
    }

    return Number.isFinite(value) ? value : null;
  }

  private parseExpression(depth: number): number | null {
    if (depth > MAX_EXPRESSION_DEPTH) return null;

    let value = this.parseTerm(depth);
    if (value === null) return null;

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];
      if (operator !== '+' && operator !== '-') break;
      this.position += 1;

      const right = this.parseTerm(depth);
      if (right === null) return null;
      value = operator === '+' ? value + right : value - right;
    }

    return value;
  }

  private parseTerm(depth: number): number | null {
    let value = this.parseUnary(depth);
    if (value === null) return null;

    while (true) {
      this.skipWhitespace();
      const operator = this.input[this.position];
      if (operator !== '*' && operator !== '/') break;
      this.position += 1;

      const right = this.parseUnary(depth);
      if (right === null) return null;
      value = operator === '*' ? value * right : value / right;
    }

    return value;
  }

  private parseUnary(depth: number): number | null {
    if (depth > MAX_EXPRESSION_DEPTH) return null;

    this.skipWhitespace();
    const operator = this.input[this.position];
    if (operator === '+' || operator === '-') {
      this.position += 1;
      const value = this.parseUnary(depth + 1);
      if (value === null) return null;
      return operator === '-' ? -value : value;
    }

    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): number | null {
    this.skipWhitespace();

    if (this.input[this.position] === '(') {
      this.position += 1;
      const value = this.parseExpression(depth + 1);
      if (value === null) return null;

      this.skipWhitespace();
      if (this.input[this.position] !== ')') return null;
      this.position += 1;
      return value;
    }

    return this.parseNumber();
  }

  private parseNumber(): number | null {
    this.skipWhitespace();
    const start = this.position;
    let integerDigits = 0;

    while (this.isDigit(this.input[this.position])) {
      integerDigits += 1;
      this.position += 1;
    }

    if (this.input[this.position] === '.') {
      this.position += 1;
      const fractionStart = this.position;
      while (this.isDigit(this.input[this.position])) {
        this.position += 1;
      }
      if (this.position === fractionStart) return null;
    } else if (integerDigits === 0) {
      return null;
    }

    const value = Number(this.input.slice(start, this.position));
    return Number.isFinite(value) ? value : null;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.position] ?? '')) {
      this.position += 1;
    }
  }

  private isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= '0' && character <= '9';
  }
}

export const evaluateArithmeticExpression = (input: string): number | null => {
  if (input.length === 0 || input.length > MAX_EXPRESSION_LENGTH) {
    return null;
  }

  return new ArithmeticParser(input).parse();
};
