import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ListPopup, { type ListItem } from './ListPopup';

describe('ListPopup keyboard contract', () => {
  let host: HTMLDivElement;
  let root: Root;
  let opener: HTMLButtonElement;
  let nextButton: HTMLButtonElement;
  let referenceRef: React.RefObject<HTMLElement>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    opener = document.createElement('button');
    opener.textContent = 'Open menu';
    nextButton = document.createElement('button');
    nextButton.textContent = 'After menu';
    host = document.createElement('div');
    document.body.append(opener, nextButton, host);
    root = createRoot(host);
    referenceRef = { current: opener };
    opener.focus();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
  });

  const renderMenu = async (items: ListItem[]) => {
    const Harness = () => {
      const [open, setOpen] = useState(true);
      return (
        <ListPopup
          open={open}
          ariaLabel="Actions"
          referenceRef={referenceRef}
          onClose={() => setOpen(false)}
          items={items}
        />
      );
    };

    await act(async () => root.render(<Harness />));
  };

  it('uses menu semantics and arrow-key navigation', async () => {
    await renderMenu([
      { id: 'first', label: 'First' },
      { id: 'second', label: 'Second' },
    ]);

    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    expect(menu?.getAttribute('aria-label')).toBe('Actions');
    expect(document.activeElement).toBe(items[0]);

    await act(async () => {
      items[0].dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(items[1]);

    await act(async () => {
      items[1].dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes a nested menu on Tab and moves focus past its opener', async () => {
    await renderMenu([
      {
        id: 'parent',
        label: 'Parent',
        children: [{ id: 'child', label: 'Child' }],
      },
    ]);

    const parent =
      document.querySelector<HTMLButtonElement>('[role="menuitem"]');
    expect(parent).not.toBeNull();
    await act(async () => {
      parent?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const submenu = document.querySelector<HTMLElement>(
      '[data-dmn-popup-submenu="true"]',
    );
    expect(submenu).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Child');

    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.dispatchEvent(tab));

    expect(tab.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(nextButton);
  });

  it('keeps Tab navigation inside the opener modal', async () => {
    const modal = document.createElement('div');
    modal.dataset.dmnModalBackdrop = 'true';
    const beforeButton = document.createElement('button');
    beforeButton.textContent = 'Before menu';
    modal.append(beforeButton, opener);
    document.body.insertBefore(modal, nextButton);
    opener.focus();

    await renderMenu([{ id: 'first', label: 'First' }]);
    expect(document.activeElement?.textContent).toBe('First');

    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.dispatchEvent(tab));

    expect(tab.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(beforeButton);
  });
});
