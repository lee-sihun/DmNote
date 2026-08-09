import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingPopup from './FloatingPopup';

const createRect = (
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect =>
  ({
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  } as DOMRect);

const disconnectedRect = createRect(0, 0, 0, 0);

describe('FloatingPopup reference synchronization', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 1024 },
      clientHeight: { configurable: true, value: 768 },
    });
    Object.defineProperties(document.body, {
      clientWidth: { configurable: true, value: 1024 },
      clientHeight: { configurable: true, value: 768 },
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function () {
        return this.matches('[data-dmn-floating-popup="true"]') ? 40 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function () {
        return this.matches('[data-dmn-floating-popup="true"]') ? 20 : 0;
      },
    );
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
      createRect(0, 0, 1, 1),
    ] as unknown as DOMRectList);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const renderPopup = async (
    referenceRef: React.RefObject<HTMLElement>,
    revision: string,
  ) => {
    await act(async () => {
      root.render(
        <FloatingPopup
          open
          ariaLabel="Reference popup"
          referenceRef={referenceRef}
          placement="bottom-start"
          offset={0}
          animate={false}
          autoClose={false}
          onClose={() => undefined}
        >
          <span>{revision}</span>
        </FloatingPopup>,
      );
    });
  };

  const expectPosition = async (left: number, top: number) => {
    await vi.waitFor(() => {
      const popup = document.querySelector<HTMLElement>(
        '[data-dmn-floating-popup="true"]',
      );
      expect(popup?.style.left).toBe(`${left}px`);
      expect(popup?.style.top).toBe(`${top}px`);
    });
  };

  it('positions from the replacement node when the same ref object changes', async () => {
    const anchorA = document.createElement('button');
    const anchorB = document.createElement('button');
    const rectA = createRect(80, 100, 30, 20);
    const rectB = createRect(360, 240, 50, 30);
    const measureA = vi
      .spyOn(anchorA, 'getBoundingClientRect')
      .mockImplementation(() =>
        anchorA.isConnected ? rectA : disconnectedRect,
      );
    const measureB = vi
      .spyOn(anchorB, 'getBoundingClientRect')
      .mockReturnValue(rectB);
    const referenceRef: React.RefObject<HTMLElement> = { current: anchorA };
    document.body.insertBefore(anchorA, host);

    await renderPopup(referenceRef, 'A');
    await expectPosition(80, 120);

    anchorA.replaceWith(anchorB);
    referenceRef.current = anchorB;
    await renderPopup(referenceRef, 'B');
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    await expectPosition(360, 270);

    expect(measureA).toHaveBeenCalled();
    expect(measureB).toHaveBeenCalled();
  });
});
