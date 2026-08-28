import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/styles/main.css'),
  'utf8',
);

const readRule = (selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(mainCss);
  if (!match) {
    throw new Error(`CSS 규칙을 찾을 수 없습니다: ${selector}`);
  }
  return { body: match[1], index: match.index };
};

const baseMotionRule = readRule('[data-dmn-motion-state]');
const enteringMotionRule = readRule("[data-dmn-motion-state='entering']");
const closingMotionRule = readRule("[data-dmn-motion-state='closing']");

describe('팝업 모션 CSS 계약', () => {
  it('open 상태에서 WebKit fallback에 의존하지 않고 보이는 값을 상속한다', () => {
    expect(baseMotionRule.body).toContain('--dmn-motion-opacity: 1;');
    expect(baseMotionRule.body).toContain('--dmn-motion-scale: 1;');
  });

  it('등장 직전과 닫는 상태는 계속 투명하다', () => {
    expect(enteringMotionRule.body).toMatch(/--dmn-motion-opacity:\s*0;/);
    expect(closingMotionRule.body).toMatch(/--dmn-motion-opacity:\s*0;/);
  });

  it('상태별 값이 기본 open 값보다 뒤에서 재선언된다', () => {
    expect(enteringMotionRule.index).toBeGreaterThan(baseMotionRule.index);
    expect(closingMotionRule.index).toBeGreaterThan(baseMotionRule.index);
  });
});
