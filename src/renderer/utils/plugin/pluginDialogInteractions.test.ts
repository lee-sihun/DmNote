import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCheckbox } from './pluginComponents';
import { attachPluginDialogInteractions } from './pluginDialogInteractions';

const HANDLER_NAME = '__dmn_handler_dialog_test';

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>)[HANDLER_NAME];
});

describe('attachPluginDialogInteractions', () => {
  it('마운트된 루트의 클릭·input·change 이벤트를 핸들러에 위임한다', () => {
    const handler = vi.fn();
    (window as unknown as Record<string, unknown>)[HANDLER_NAME] = handler;
    const root = document.createElement('div');
    root.innerHTML = `
      <button data-plugin-handler="${HANDLER_NAME}">Click</button>
      <input data-plugin-handler-input="${HANDLER_NAME}" />
      <select data-plugin-handler-change="${HANDLER_NAME}"><option>One</option></select>
    `;
    document.body.appendChild(root);

    const detach = attachPluginDialogInteractions(root);
    root
      .querySelector('button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root
      .querySelector('input')
      ?.dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('select')
      ?.dispatchEvent(new Event('change', { bubbles: true }));

    expect(handler).toHaveBeenCalledTimes(3);
    detach();
  });

  it('체크박스와 드롭다운을 연결하고 cleanup 후 중복 실행하지 않는다', () => {
    const handler = vi.fn();
    (window as unknown as Record<string, unknown>)[HANDLER_NAME] = handler;
    const root = document.createElement('div');
    root.innerHTML = `
      <label data-checkbox-toggle data-plugin-handler-change="${HANDLER_NAME}" class="bg-line-strong">
        <input type="checkbox" />
        <div class="left-[2px]"></div>
      </label>
      <div class="plugin-dropdown" data-plugin-handler-change="${HANDLER_NAME}">
        <button data-dropdown-toggle><span>One</span></button>
        <div data-dropdown-menu class="hidden">
          <button data-value="two">Two</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const detach = attachPluginDialogInteractions(root);
    root
      .querySelector('label')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    expect(root.querySelector('input')?.checked).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    root
      .querySelector('[data-dropdown-toggle]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const menu = document.querySelector('[data-dropdown-menu]');
    expect(menu?.classList.contains('flex')).toBe(true);
    menu
      ?.querySelector('button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(2);

    detach();
    root
      .querySelector('label')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    expect(handler).toHaveBeenCalledTimes(2);

    const detachAgain = attachPluginDialogInteractions(root);
    root
      .querySelector('label')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    expect(handler).toHaveBeenCalledTimes(3);
    detachAgain();
  });

  // 실제 생성기 출력으로 검증 — 수기 fixture가 프로덕션 계약과 어긋나는 회귀 방지
  it('실제 createCheckbox 출력에서 label 클릭 시 checked를 정확히 1회 전달한다', () => {
    const received: boolean[] = [];
    const root = document.createElement('div');
    root.innerHTML = createCheckbox({
      checked: false,
      onChange: (checked) => {
        received.push(checked);
      },
    });
    document.body.appendChild(root);

    const detach = attachPluginDialogInteractions(root);
    const label = root.querySelector('label') as HTMLLabelElement;

    label.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(received).toEqual([true]);
    expect(root.querySelector('input')?.checked).toBe(true);

    label.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(received).toEqual([true, false]);

    detach();
    label.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(received).toEqual([true, false]);
  });
});
