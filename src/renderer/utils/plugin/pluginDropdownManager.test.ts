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
