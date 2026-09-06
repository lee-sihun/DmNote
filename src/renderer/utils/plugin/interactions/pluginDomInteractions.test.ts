import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachPluginDomInteractions } from './pluginDomInteractions';

const HANDLER_NAME = '__dmn_plugin_dom_handler_test';

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>)[HANDLER_NAME];
});

describe('attachPluginDomInteractions', () => {
  it('ShadowRoot에서도 위임 이벤트를 플러그인 핸들러에 전달한다', () => {
    const handler = vi.fn();
    (window as unknown as Record<string, unknown>)[HANDLER_NAME] = handler;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<button data-plugin-handler="${HANDLER_NAME}">run</button>`;

    const detach = attachPluginDomInteractions(root);
    root
      .querySelector('button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);

    detach();
    root
      .querySelector('button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('숫자 입력 blur를 min/max 범위로 정규화하고 change를 전달한다', () => {
    const handler = vi.fn();
    (window as unknown as Record<string, unknown>)[HANDLER_NAME] = handler;
    const root = document.createElement('div');
    root.innerHTML = `
      <input
        type="number"
        value="99"
        data-plugin-input-blur
        data-plugin-input-min="1"
        data-plugin-input-max="10"
        data-plugin-handler-change="${HANDLER_NAME}"
      />
    `;
    document.body.appendChild(root);

    const detach = attachPluginDomInteractions(root);
    const input = root.querySelector('input')!;
    input.dispatchEvent(new Event('blur'));

    expect(input.value).toBe('10');
    expect(handler).toHaveBeenCalledTimes(1);
    detach();
  });
});
