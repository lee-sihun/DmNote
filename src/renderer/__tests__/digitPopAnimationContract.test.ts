import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/styles/main.css'),
  'utf8',
);
const tokensCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/styles/tokens/base.css'),
  'utf8',
);

const digitPopKeyframes = mainCss.slice(
  mainCss.indexOf('@keyframes dmnDigitPop'),
  mainCss.indexOf(
    '@media (prefers-reduced-motion: reduce)',
    mainCss.indexOf('@keyframes dmnDigitPop'),
  ),
);

describe('숫자 스텝 팝인 애니메이션 계약', () => {
  it('WebKit에서 자릿수 재합성을 일으키는 filter를 사용하지 않는다', () => {
    expect(digitPopKeyframes).not.toContain('filter:');
    expect(tokensCss).not.toContain('--ui-digit-blur');
  });

  it('이동과 투명도 팝인 효과는 유지한다', () => {
    expect(digitPopKeyframes).toContain('transform: translateY(');
    expect(digitPopKeyframes).toContain('opacity: 0;');
    expect(digitPopKeyframes).toContain('transform: translateY(0);');
    expect(digitPopKeyframes).toContain('opacity: 1;');
  });
});
