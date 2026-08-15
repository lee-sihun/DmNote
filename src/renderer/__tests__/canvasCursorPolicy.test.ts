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
