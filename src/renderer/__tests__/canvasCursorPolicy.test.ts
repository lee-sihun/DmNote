/**
 * 메인 캔버스 커서 정책 검증
 * main.css 규칙이 플러그인 콘텐츠의 자체 커서 선언을 이기는지 computed style로 확인
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const mainCss = readFileSync(
  path.resolve(__dirname, '../styles/main.css'),
  'utf8',
);

describe('메인 캔버스 커서 정책 (main.css)', () => {
  let style: HTMLStyleElement;
  let wrapper: HTMLDivElement;
  let child: HTMLDivElement;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = mainCss;
    document.head.appendChild(style);

    wrapper = document.createElement('div');
    wrapper.className = 'dmn-grabbable';
    child = document.createElement('div');
    // 콘텐츠 루트가 자체 인라인 커서를 선언하는 플러그인 재현
    child.style.cursor = 'pointer';
    wrapper.appendChild(child);
    document.body.appendChild(wrapper);
  });

  afterEach(() => {
    document.body.classList.remove('dmn-dragging');
    wrapper.remove();
    style.remove();
  });

  it('호버 커서는 자식 인라인 선언을 무시하고 래퍼 정책을 상속한다', () => {
    expect(getComputedStyle(wrapper).cursor).toBe('default');
    // jsdom은 inherit을 리터럴로 반환 - 인라인 pointer를 이긴 사실만 고정
    expect(getComputedStyle(child).cursor).toBe('inherit');
  });

  it('드래그 세션 클래스는 자식 인라인 선언 위에서 grabbing을 강제한다', () => {
    document.body.classList.add('dmn-dragging');

    expect(getComputedStyle(wrapper).cursor).toBe('grabbing');
    expect(getComputedStyle(child).cursor).toBe('grabbing');
  });
});

describe('패널 레이어 행 커서 정책 (main.css)', () => {
  let style: HTMLStyleElement;
  let row: HTMLDivElement;
  let eyeButton: HTMLButtonElement;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = mainCss;
    document.head.appendChild(style);

    row = document.createElement('div');
    row.className = 'dmn-row-grabbable';
    // 자체 커서를 선언하는 행 내부 버튼 재현 (눈알 토글 등)
    eyeButton = document.createElement('button');
    eyeButton.style.cursor = 'pointer';
    row.appendChild(eyeButton);
    document.body.appendChild(row);
  });

  afterEach(() => {
    document.body.classList.remove('dmn-dragging');
    row.remove();
    style.remove();
  });

  it('평시 행 커서는 grab이 아니라 default다', () => {
    expect(getComputedStyle(row).cursor).toBe('default');
  });

  it('행 내부 버튼은 자체 커서 선언을 유지한다', () => {
    // dmn-grabbable과 달리 상속 강제가 없어 버튼 UX가 보존된다
    expect(getComputedStyle(eyeButton).cursor).toBe('pointer');
  });

  it('누르는 동안 행을 grabbing으로 바꾸는 :active 규칙을 선언한다', () => {
    const rules = Array.from(style.sheet?.cssRules ?? []);
    const activeRule = rules.find(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        rule.selectorText === '.dmn-row-grabbable:active',
    );

    expect(activeRule?.style.cursor).toBe('grabbing');
  });

  it('드래그 세션 클래스는 행과 버튼 모두 grabbing으로 덮는다', () => {
    document.body.classList.add('dmn-dragging');

    expect(getComputedStyle(row).cursor).toBe('grabbing');
    expect(getComputedStyle(eyeButton).cursor).toBe('grabbing');
  });
});
