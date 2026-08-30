import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Modal from '../Modal/Modal';
import Dropdown from './Dropdown';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

// 닫힘 모션이 도는 동안 메뉴 DOM은 잠깐 남는다. 열려 있는 메뉴만 센다
const openListbox = () =>
  document.querySelector(
    '[role="listbox"]:not([data-dmn-motion-state="closing"])',
  );

describe('Dropdown keyboard contract', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    host.remove();
    document.body.innerHTML = '';
  });

  it('opens with ArrowDown, moves between options, and selects with Enter', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Dropdown
          options={[
            { label: 'One', value: 'one' },
            { label: 'Two', value: 'two' },
            { label: 'Three', value: 'three' },
          ]}
          value="one"
          onChange={onChange}
        />,
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>('button');
    trigger?.focus();
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    let options = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    expect(document.activeElement).toBe(options[0]);

    await act(async () => {
      options[0].dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    options = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    expect(document.activeElement).toBe(options[1]);

    await act(async () => {
      options[1].dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onChange).toHaveBeenCalledWith('two');
    expect(openListbox()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('열린 메뉴는 side panel과 같은 canvas glass 재질을 쓴다', async () => {
    await act(async () => {
      root.render(
        <Dropdown
          options={[{ label: 'One', value: 'one' }]}
          value="one"
          onChange={() => undefined}
        />,
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>('button');
    await act(async () => trigger?.click());

    const menu = openListbox();
    expect(menu?.classList.contains('bg-glass-panel')).toBe(true);
    expect(menu?.classList.contains('backdrop-glass-popup')).toBe(true);
    expect(menu?.classList.contains('backdrop-glass-canvas')).toBe(true);
    expect(menu?.classList.contains('shadow-elevation-popup')).toBe(true);
    expect(menu?.classList.contains('shadow-elevation-2')).toBe(false);
    expect(menu?.classList.contains('shadow-elevation-3')).toBe(false);
  });

  it('after-paint 전략은 메뉴와 라벨을 먼저 갱신하고 선택 콜백을 미룬다', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Dropdown
          options={[
            { label: 'One', value: 'one' },
            { label: 'Two', value: 'two' },
          ]}
          value="one"
          onChange={onChange}
          commitStrategy="after-paint"
        />,
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-haspopup="listbox"]',
    );
    await act(async () => trigger?.click());
    const options = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    await act(async () => options[1]?.click());

    expect(openListbox()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger?.textContent).toContain('Two');
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('wraps ArrowUp from the first option to the last option', async () => {
    await act(async () => {
      root.render(
        <Dropdown
          options={[
            { label: 'One', value: 'one' },
            { label: 'Two', value: 'two' },
          ]}
          value="one"
          onChange={() => undefined}
        />,
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>('button');
    trigger?.focus();
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const options = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    expect(document.activeElement).toBe(options[0]);
    await act(async () => {
      options[0].dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(options[1]);
  });

  it('returns Tab navigation to the trigger order inside a modal', async () => {
    await act(async () => {
      root.render(
        <div data-dmn-modal-backdrop="true">
          <button type="button">Before</button>
          <Dropdown
            options={[
              { label: 'One', value: 'one' },
              { label: 'Two', value: 'two' },
            ]}
            value="one"
            onChange={() => undefined}
          />
          <button type="button">After</button>
        </div>,
      );
    });

    const trigger = host.querySelectorAll<HTMLButtonElement>('button')[1];
    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const option = document.querySelector<HTMLButtonElement>('[role="option"]');
    await act(async () => {
      option?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(document.activeElement?.textContent).toBe('After');
    expect(openListbox()).toBeNull();
  });

  it('keeps Tab navigation inside a parent popup layer', async () => {
    await act(async () => {
      root.render(
        <>
          <button type="button">Outside before</button>
          <div data-dmn-popup-layer="true">
            <button type="button">Inside before</button>
            <Dropdown
              options={[
                { label: 'One', value: 'one' },
                { label: 'Two', value: 'two' },
              ]}
              value="one"
              onChange={() => undefined}
            />
            <button type="button">Inside after</button>
          </div>
          <button type="button">Outside after</button>
        </>,
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-haspopup="listbox"]',
    );
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const option = document.querySelector<HTMLButtonElement>('[role="option"]');
    await act(async () => {
      option?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(document.activeElement?.textContent).toBe('Inside after');
    expect(openListbox()).toBeNull();
  });

  it('closes and restores trigger focus when open options become empty', async () => {
    const renderOptions = async (
      options: Array<{ label: string; value: string }>,
    ) => {
      await act(async () => {
        root.render(
          <Dropdown options={options} value="one" onChange={() => undefined} />,
        );
      });
    };

    await renderOptions([
      { label: 'One', value: 'one' },
      { label: 'Two', value: 'two' },
    ]);
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-haspopup="listbox"]',
    );
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(openListbox()).not.toBeNull();

    await renderOptions([]);

    expect(openListbox()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('다중 모드는 항목 클릭에도 닫히지 않고 체크 상태를 토글로 보여준다', async () => {
    const onChange = vi.fn();
    const renderMulti = async (values: string[]) => {
      await act(async () => {
        root.render(
          <Dropdown
            options={[
              { label: 'One', value: 'one' },
              { label: 'Two', value: 'two' },
            ]}
            multiple
            values={values}
            onChange={onChange}
            placeholder="키 선택"
          />,
        );
      });
    };
    const optionByText = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
        (option) => option.textContent === text,
      )!;

    // 빈 선택은 자리표시 문구
    await renderMulti([]);
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-haspopup="listbox"]',
    );
    expect(trigger?.textContent).toContain('키 선택');

    await renderMulti(['one']);
    expect(trigger?.textContent).toContain('One');
    await act(async () => trigger?.click());

    expect(openListbox()?.getAttribute('aria-multiselectable')).toBe('true');
    expect(optionByText('One').getAttribute('aria-selected')).toBe('true');
    expect(optionByText('Two').getAttribute('aria-selected')).toBe('false');

    await act(async () => optionByText('Two').click());
    expect(onChange).toHaveBeenCalledWith('two');
    expect(openListbox()).not.toBeNull();

    // 컨트롤드 갱신 후 체크와 트리거 요약 반영
    await renderMulti(['one', 'two']);
    expect(optionByText('Two').getAttribute('aria-selected')).toBe('true');
    expect(trigger?.textContent).toContain('One, Two');

    // 키보드 선택도 메뉴를 유지한다
    await act(async () => {
      optionByText('One').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onChange).toHaveBeenCalledWith('one');
    expect(openListbox()).not.toBeNull();
  });

  it('closes itself before its parent modal on Escape', async () => {
    const closeModal = vi.fn();
    await act(async () => {
      root.render(
        <Modal onClick={closeModal} ariaLabel="Settings">
          <Dropdown
            options={[
              { label: 'One', value: 'one' },
              { label: 'Two', value: 'two' },
            ]}
            value="one"
            onChange={() => undefined}
          />
        </Modal>,
      );
    });

    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-haspopup="listbox"]',
    );
    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(openListbox()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(openListbox()).toBeNull();
    expect(closeModal).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(closeModal).toHaveBeenCalledTimes(1);
  });
});
