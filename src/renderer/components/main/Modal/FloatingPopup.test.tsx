import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingPopup from './FloatingPopup';

describe('FloatingPopup focus contract', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
      document.createElement('div').getBoundingClientRect(),
    ] as unknown as DOMRectList);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const renderPopup = async (open: boolean, children: React.ReactNode) => {
    await act(async () => {
      root.render(
        <FloatingPopup
          open={open}
          ariaLabel="Test popup"
          fixedX={0}
          fixedY={0}
          animate={false}
          onClose={() => undefined}
        >
          {children}
        </FloatingPopup>,
      );
    });
  };

  it('consumes Tab and cycles focus in both directions', async () => {
    await renderPopup(
      true,
      <>
        <button type="button">First</button>
        <button type="button">Last</button>
      </>,
    );

    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"][aria-modal="false"] button',
      ),
    );
    expect(document.activeElement).toBe(buttons[0]);

    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);

    const wrapped = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(wrapped);
    expect(wrapped.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);

    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('skips CSS-hidden fields when focusing and cycling', async () => {
    await renderPopup(
      true,
      <>
        <button type="button" style={{ display: 'none' }}>
          Hidden first
        </button>
        <button type="button">Visible first</button>
        <button type="button">Visible last</button>
        <button type="button" style={{ visibility: 'hidden' }}>
          Hidden last
        </button>
      </>,
    );

    const visibleButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"][aria-modal="false"] button',
      ),
    ).filter((button) => button.textContent?.startsWith('Visible'));
    expect(document.activeElement).toBe(visibleButtons[0]);

    visibleButtons[1].focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(visibleButtons[0]);

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(visibleButtons[1]);
  });

  it('consumes Tab and retains the dialog when no child is focusable', async () => {
    await renderPopup(true, <span>Content</span>);
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-modal="false"]',
    );
    expect(document.activeElement).toBe(dialog);

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
  });

  it('respects child autoFocus and restores the opener after close', async () => {
    const opener = document.createElement('button');
    document.body.prepend(opener);
    opener.focus();

    await renderPopup(
      true,
      <>
        <button type="button">First</button>
        <input aria-label="Preferred" autoFocus />
      </>,
    );
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Preferred',
    );

    await renderPopup(false, null);
    expect(document.activeElement).toBe(opener);
  });

  it('exposes an accessible dialog name', async () => {
    await renderPopup(true, <button type="button">Action</button>);

    expect(
      document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
    ).toBe('Test popup');
  });

  it('lets only the topmost popup consume Escape', async () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    await act(async () => {
      root.render(
        <>
          <FloatingPopup
            open
            ariaLabel="Bottom popup"
            fixedX={0}
            fixedY={0}
            animate={false}
            onClose={closeBottom}
          >
            <button type="button">Bottom</button>
          </FloatingPopup>
          <FloatingPopup
            open
            ariaLabel="Top popup"
            fixedX={10}
            fixedY={10}
            animate={false}
            onClose={closeTop}
          >
            <button type="button">Top</button>
          </FloatingPopup>
        </>,
      );
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(closeBottom).not.toHaveBeenCalled();
    expect(closeTop).toHaveBeenCalledTimes(1);
  });

  it('uses opening order instead of DOM order for Escape ownership', async () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    const renderLayers = async (showTop: boolean) => {
      await act(async () => {
        root.render(
          <>
            {showTop && (
              <FloatingPopup
                key="top"
                open
                ariaLabel="Top popup"
                animate={false}
                onClose={closeTop}
              >
                <button type="button">Top</button>
              </FloatingPopup>
            )}
            <FloatingPopup
              key="bottom"
              open
              ariaLabel="Bottom popup"
              animate={false}
              onClose={closeBottom}
            >
              <button type="button">Bottom</button>
            </FloatingPopup>
          </>,
        );
      });
    };

    await renderLayers(false);
    await renderLayers(true);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .map((element) => element.getAttribute('aria-label'))
        .filter(Boolean),
    ).toEqual(['Top popup', 'Bottom popup']);

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(closeBottom).not.toHaveBeenCalled();
    expect(closeTop).toHaveBeenCalledTimes(1);
  });
});
