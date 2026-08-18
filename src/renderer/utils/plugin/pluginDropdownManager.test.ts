// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupPluginDropdownInteractions } from './pluginDropdownManager';

const createDropdownRoot = () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="plugin-dropdown">
      <button data-dropdown-toggle><span>Before</span><svg></svg></button>
      <div data-dropdown-menu class="hidden">
        <button data-value="next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  return root;
};

describe('plugin dropdown shared manager', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('여러 root가 document 전역 리스너 한 세트를 공유한다', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const first = createDropdownRoot();
    const second = createDropdownRoot();
    const cleanupFirst = setupPluginDropdownInteractions(first);
    const cleanupSecond = setupPluginDropdownInteractions(second);
    cleanups.push(cleanupFirst, cleanupSecond);

    expect(add.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(
      1,
    );
    expect(add.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(
      1,
    );
  });

  it('등록 root의 메뉴를 열고 선택한 값을 change로 전달한다', () => {
    const root = createDropdownRoot();
    cleanups.push(setupPluginDropdownInteractions(root));
    const dropdown = root.querySelector('.plugin-dropdown') as HTMLElement;
    const toggle = root.querySelector('[data-dropdown-toggle]') as HTMLElement;
    const change = vi.fn();
    dropdown.addEventListener('change', change);

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const menu = document.body.querySelector(
      '[data-plugin-dropdown-portal="true"]',
    ) as HTMLElement;
    expect(menu).not.toBeNull();
    const item = menu.querySelector('button')!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(dropdown.dataset.selected).toBe('next');
    expect(change).toHaveBeenCalledOnce();
    expect(root.querySelector('[data-dropdown-menu]')).toBe(menu);
  });

  it('마지막 등록 해제 시 열린 포털을 복원하고 리스너를 제거한다', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const root = createDropdownRoot();
    const cleanup = setupPluginDropdownInteractions(root);
    const toggle = root.querySelector('[data-dropdown-toggle]') as HTMLElement;
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    cleanup();
    expect(root.querySelector('[data-dropdown-menu]')).not.toBeNull();
    expect(remove.mock.calls.some(([type]) => type === 'click')).toBe(true);
  });
});

const VIEWPORT_WIDTH = 600;
const VIEWPORT_HEIGHT = 500;
const MENU_WIDTH = 180;
const MENU_HEIGHT = 120;
const VIEWPORT_PADDING = 8;
const MENU_MARGIN = 4;

const openMenuWithTriggerAt = (rect: Partial<DOMRect>) => {
  const root = createDropdownRoot();
  cleanupsForClamp.push(setupPluginDropdownInteractions(root));
  const toggle = root.querySelector<HTMLElement>('[data-dropdown-toggle]')!;
  const menu = root.querySelector<HTMLElement>('[data-dropdown-menu]')!;
  vi.spyOn(toggle, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 100,
    height: 24,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
  vi.spyOn(menu, 'offsetWidth', 'get').mockReturnValue(MENU_WIDTH);
  vi.spyOn(menu, 'offsetHeight', 'get').mockReturnValue(MENU_HEIGHT);
  toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return menu;
};

const cleanupsForClamp: Array<() => void> = [];

describe('플러그인 드롭다운 화면 경계 보정', () => {
  beforeEach(() => {
    vi.stubGlobal('innerWidth', VIEWPORT_WIDTH);
    vi.stubGlobal('innerHeight', VIEWPORT_HEIGHT);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanupsForClamp.splice(0).forEach((cleanup) => cleanup());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('경계 안이면 트리거 왼쪽 아래에 붙인다', () => {
    const menu = openMenuWithTriggerAt({ left: 40, bottom: 100, top: 76 });

    expect(menu.style.left).toBe('40px');
    expect(menu.style.top).toBe(`${100 + MENU_MARGIN}px`);
  });

  it('오른쪽 경계를 넘으면 안쪽으로 당긴다', () => {
    const menu = openMenuWithTriggerAt({
      left: VIEWPORT_WIDTH - 40,
      bottom: 100,
      top: 76,
    });

    expect(menu.style.left).toBe(
      `${VIEWPORT_WIDTH - MENU_WIDTH - VIEWPORT_PADDING}px`,
    );
  });

  it('왼쪽으로 벗어나면 최소 여백까지만 올린다', () => {
    const menu = openMenuWithTriggerAt({ left: -200, bottom: 100, top: 76 });

    expect(menu.style.left).toBe(`${VIEWPORT_PADDING}px`);
  });

  it('아래 공간이 부족하면 트리거 위로 펼친다', () => {
    const triggerTop = VIEWPORT_HEIGHT - 40;
    const menu = openMenuWithTriggerAt({
      left: 40,
      top: triggerTop,
      bottom: VIEWPORT_HEIGHT - 16,
    });

    expect(menu.style.top).toBe(`${triggerTop - MENU_HEIGHT - MENU_MARGIN}px`);
  });

  it('위아래 모두 좁으면 최소 여백을 지킨다', () => {
    const menu = openMenuWithTriggerAt({ left: 40, top: 10, bottom: 480 });

    expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(
      VIEWPORT_PADDING,
    );
  });

  it('포털된 메뉴는 body 바로 아래에 고정 배치된다', () => {
    const menu = openMenuWithTriggerAt({ left: 40, bottom: 100, top: 76 });

    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
    // 화면보다 긴 목록은 잘리지 않고 스크롤한다
    expect(menu.style.maxHeight).toBe('200px');
    expect(menu.style.overflowY).toBe('auto');
  });
});
