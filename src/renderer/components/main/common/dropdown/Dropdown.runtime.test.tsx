import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Dropdown from './Dropdown';

const observers: ResizeObserverStub[] = [];

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();

  constructor() {
    observers.push(this);
  }
}

const options = [
  { label: 'One', value: 'one' },
  { label: 'Two', value: 'two' },
];

const openListbox = () =>
  document.querySelector<HTMLElement>(
    '[role="listbox"]:not([data-dmn-motion-state="closing"])',
  );

describe('Dropdown 런타임 계약', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    host.remove();
    document.body.innerHTML = '';
  });

  const renderDropdown = async (
    onChange: (value: string) => void = vi.fn(),
  ) => {
    await act(async () => {
      root.render(
        <Dropdown options={options} value="one" onChange={onChange} />,
      );
    });
    return host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
  };

  const openMenu = async (trigger: HTMLButtonElement) => {
    await act(async () => trigger.click());
    expect(openListbox()).not.toBeNull();
  };

  it('sync 선택 콜백을 실행한 뒤 메뉴를 닫고 트리거 포커스를 복원한다', async () => {
    const snapshots: Array<{
      menuOpen: boolean;
      focusedRole: string | null;
    }> = [];
    const trigger = await renderDropdown(() => {
      snapshots.push({
        menuOpen: openListbox() !== null,
        focusedRole: document.activeElement?.getAttribute('role') ?? null,
      });
    });
    await openMenu(trigger);
    const optionButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );

    await act(async () => {
      optionButtons[1].focus();
      optionButtons[1].click();
    });

    expect(snapshots).toEqual([{ menuOpen: true, focusedRole: 'option' }]);
    expect(openListbox()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('메뉴 내부 스크롤은 유지하고 외부 스크롤·resize·바깥 클릭은 닫는다', async () => {
    const trigger = await renderDropdown();

    await openMenu(trigger);
    await act(async () => {
      openListbox()?.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(openListbox()).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(openListbox()).toBeNull();

    await openMenu(trigger);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(openListbox()).toBeNull();

    await openMenu(trigger);
    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
    });
    expect(openListbox()).toBeNull();
  });

  it('열린 표면을 관찰하고 닫힐 때 ResizeObserver를 해제한다', async () => {
    const trigger = await renderDropdown();
    await openMenu(trigger);

    const observer = observers.at(-1);
    expect(observer?.observe).toHaveBeenCalledWith(openListbox());
    expect(observer?.disconnect).not.toHaveBeenCalled();

    await act(async () => trigger.click());

    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
  });
});
