import { describe, expect, it } from 'vitest';
import { evaluateArithmeticExpression } from './arithmeticExpression';

describe('evaluateArithmeticExpression', () => {
  it.each([
    ['10+10', 20],
    ['10/2', 5],
    ['10*5', 50],
    ['8-3-2', 3],
    ['8/4/2', 1],
  ])('%s를 계산한다', (expression, expected) => {
    expect(evaluateArithmeticExpression(expression)).toBe(expected);
  });

  it('표준 우선순위와 중첩 괄호를 적용한다', () => {
    expect(evaluateArithmeticExpression('2+3*4')).toBe(14);
    expect(evaluateArithmeticExpression('(2+3)*4')).toBe(20);
    expect(evaluateArithmeticExpression('2*(3+(4*5))')).toBe(46);
  });

  it.each([
    ['-5', -5],
    ['+5', 5],
    ['10-5', 5],
    ['10*-2', -20],
    ['-(2+3)', -5],
    ['10--2', 12],
  ])('단항 부호와 뺄셈을 구분한다: %s', (expression, expected) => {
    expect(evaluateArithmeticExpression(expression)).toBe(expected);
  });

  it.each([
    '',
    '10+',
    '10++',
    'abc',
    '1.2.3',
    '1.',
    '2(3)',
    '(1+2',
    '1+2)',
    '()',
  ])('잘못된 입력을 거절한다: %s', (expression) => {
    expect(evaluateArithmeticExpression(expression)).toBeNull();
  });

  it('유한수가 아닌 결과를 거절한다', () => {
    expect(evaluateArithmeticExpression('10/0')).toBeNull();
    expect(evaluateArithmeticExpression('0/0')).toBeNull();
  });

  it('수식 사이의 공백을 허용한다', () => {
    expect(evaluateArithmeticExpression(' 10 + ( 2 * 3 ) ')).toBe(16);
  });

  it('지나치게 긴 입력을 거절한다', () => {
    const expression = `${'1+'.repeat(128)}1`;
    expect(evaluateArithmeticExpression(expression)).toBeNull();
  });

  it('지나치게 깊은 괄호와 단항 부호를 거절한다', () => {
    expect(
      evaluateArithmeticExpression(`${'('.repeat(40)}1${')'.repeat(40)}`),
    ).toBeNull();
    expect(evaluateArithmeticExpression(`${'-'.repeat(40)}1`)).toBeNull();
  });
});
