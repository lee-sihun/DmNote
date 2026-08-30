/**
 * 클릭 잔류 포커스 가드 계약 검증
 * 마우스 클릭은 버튼류에 활성화 가능한 포커스를 남기지 않고,
 * 텍스트 입력·retain 선언·키보드 흐름·프로그램적 포커스 이동은 건드리지 않는다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLastInputModality,
  installPointerFocusGuard,
  isPointerFocusRelease,
} from '@utils/focus/pointerFocusGuard';

const pointerEvent = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    isPrimary: true,
    ...init,
  });

// 실제 순서 재현: pointerdown → (브라우저 기본 포커스) → pointerup → click
const clickWithFocus = (target: Element, focusTarget?: HTMLElement) => {
  target.dispatchEvent(pointerEvent('pointerdown'));
  (focusTarget ?? (target as HTMLElement)).focus();
  target.dispatchEvent(pointerEvent('pointerup'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );
};

describe('pointerFocusGuard', () => {
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    uninstall = installPointerFocusGuard(document);
  });

  afterEach(() => {
    uninstall();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const mount = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
  };

  it('클릭한 버튼의 포커스를 release한다', () => {
    const button = mount('<button type="button">확인</button>');
    clickWithFocus(button);
    expect(document.activeElement).toBe(button);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('role=button div 행(피커 목록 모형)도 release한다', () => {
    const row = mount(
      '<div role="button" tabindex="0"><span>사운드</span></div>',
    );
    const label = row.querySelector('span') as HTMLElement;
    // 기본 포커스는 눌린 지점의 포커스 가능 조상(행)에 앉는다
    clickWithFocus(label, row);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('텍스트 입력은 클릭 포커스를 유지한다', () => {
    const input = mount('<input type="text" />') as HTMLInputElement;
    clickWithFocus(input);
    vi.runAllTimers();
    expect(document.activeElement).toBe(input);
  });

  it('checkbox input은 release한다', () => {
    const label = mount('<label><input type="checkbox" />토글</label>');
    const checkbox = label.querySelector('input') as HTMLInputElement;
    clickWithFocus(checkbox);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('data-dmn-pointer-focus=retain 슬라이더는 유지한다', () => {
    const slider = mount(
      '<div role="slider" tabindex="0" data-dmn-pointer-focus="retain"></div>',
    );
    clickWithFocus(slider);
    vi.runAllTimers();
    expect(document.activeElement).toBe(slider);
  });

  it('선언 없는 role=slider는 release한다', () => {
    const slider = mount('<div role="slider" tabindex="0"></div>');
    clickWithFocus(slider);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('클릭 흐름이 다른 요소로 옮긴 포커스(팝업 초기 포커스)는 유지한다', () => {
    mount(
      '<div><button type="button" id="trigger">열기</button>' +
        '<button type="button" id="option">옵션</button></div>',
    );
    const trigger = document.getElementById('trigger') as HTMLElement;
    const option = document.getElementById('option') as HTMLElement;
    trigger.dispatchEvent(pointerEvent('pointerdown'));
    trigger.focus();
    trigger.dispatchEvent(pointerEvent('pointerup'));
    // click 핸들러가 팝업을 열고 내부로 포커스를 옮긴 상황
    option.focus();
    trigger.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    vi.runAllTimers();
    expect(document.activeElement).toBe(option);
  });

  it('click이 오지 않는 릴리스(창 밖 드래그 종료)도 폴백으로 release한다', () => {
    const slider = mount('<div role="slider" tabindex="0"></div>');
    slider.dispatchEvent(pointerEvent('pointerdown'));
    slider.focus();
    slider.dispatchEvent(pointerEvent('pointerup'));
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('pointercancel은 세션을 버리고 포커스를 건드리지 않는다', () => {
    const button = mount('<button type="button">확인</button>');
    button.dispatchEvent(pointerEvent('pointerdown'));
    button.focus();
    button.dispatchEvent(pointerEvent('pointercancel'));
    vi.runAllTimers();
    expect(document.activeElement).toBe(button);
  });

  it('키보드 Tab 포커스는 세션이 없어 건드리지 않는다', () => {
    const button = mount('<button type="button">확인</button>');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    button.focus();
    vi.runAllTimers();
    expect(document.activeElement).toBe(button);
    expect(getLastInputModality()).toBe('keyboard');
  });

  it('clickless 릴리스 대기 중 keydown이 끼어도 release한다', () => {
    // 키 상시 입력 앱 - 폴백 창 안의 키 입력이 release를 취소하면 안 된다
    const slider = mount('<div role="slider" tabindex="0"></div>');
    slider.dispatchEvent(pointerEvent('pointerdown'));
    slider.focus();
    slider.dispatchEvent(pointerEvent('pointerup'));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
    );
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('평가 전에 Tab으로 옮겨간 포커스는 대상 무관으로 보존된다', () => {
    mount(
      '<div><button type="button" id="clicked">확인</button>' +
        '<button type="button" id="tabbed">다음</button></div>',
    );
    const clicked = document.getElementById('clicked') as HTMLElement;
    const tabbed = document.getElementById('tabbed') as HTMLElement;
    clickWithFocus(clicked);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    tabbed.focus();
    vi.runAllTimers();
    expect(document.activeElement).toBe(tabbed);
  });

  it('click이 중간에서 stopPropagation돼도 capture 리스너가 release한다', () => {
    const button = mount('<button type="button">미니맵</button>');
    button.addEventListener('click', (event) => event.stopPropagation());
    clickWithFocus(button);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('label 안 텍스트를 눌러도 위임된 checkbox를 release한다', () => {
    const label = mount(
      '<label><input type="checkbox" /><span>버전 건너뛰기</span></label>',
    );
    const checkbox = label.querySelector('input') as HTMLInputElement;
    const text = label.querySelector('span') as HTMLElement;
    // 브라우저의 label 위임 - span을 눌러도 포커스는 형제 input에 앉는다
    clickWithFocus(text, checkbox);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('모달 안 release는 body가 아니라 backdrop 중립 지점으로 보낸다', () => {
    const backdrop = mount(
      '<div data-dmn-modal-backdrop="true" tabindex="-1">' +
        '<button type="button">적용</button></div>',
    );
    const button = backdrop.querySelector('button') as HTMLElement;
    clickWithFocus(button);
    vi.runAllTimers();
    expect(document.activeElement).toBe(backdrop);
  });

  it('tabIndex=-1 팝업 표면 안 release도 그 표면으로 보낸다', () => {
    const surface = mount(
      '<div data-dmn-popup-layer="true" tabindex="-1">' +
        '<button type="button">옵션</button></div>',
    );
    const button = surface.querySelector('button') as HTMLElement;
    clickWithFocus(button);
    vi.runAllTimers();
    expect(document.activeElement).toBe(surface);
  });

  it('tabindex 없는 팝업 레이어(드롭다운 메뉴)는 blur한다', () => {
    const layer = mount(
      '<div data-dmn-popup-layer="true">' +
        '<button type="button">옵션</button></div>',
    );
    const button = layer.querySelector('button') as HTMLElement;
    clickWithFocus(button);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('단축키 조합은 모달리티를 키보드로 바꾸지 않는다', () => {
    const button = mount('<button type="button">확인</button>');
    button.dispatchEvent(pointerEvent('pointerdown'));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }),
    );
    expect(getLastInputModality()).toBe('pointer');
  });

  it('중복 설치는 리스너를 공유하고 마지막 해제에서 제거된다', () => {
    const release2 = installPointerFocusGuard(document);
    const button = mount('<button type="button">확인</button>');
    release2();
    clickWithFocus(button);
    vi.runAllTimers();
    expect(document.activeElement).toBe(document.body);
  });

  it('isPointerFocusRelease는 opener 복원 판정과 일치한다', () => {
    mount(
      '<div><button type="button" id="b"></button>' +
        '<input type="text" id="i" /></div>',
    );
    expect(isPointerFocusRelease(document.getElementById('b') as Element)).toBe(
      true,
    );
    expect(isPointerFocusRelease(document.getElementById('i') as Element)).toBe(
      false,
    );
  });
});
