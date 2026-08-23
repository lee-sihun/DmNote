import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ListPopup from './ListPopup';

const VIEWPORT_WIDTH = 600;
const VIEWPORT_HEIGHT = 500;
const SUB_WIDTH = 180;
const SUB_HEIGHT = 100;
const PADDING = 5;
const POPUP_CHROME_INSET = 4;
const SUBMENU_ANCHOR_GAP = 9;

const subMenu = () =>
  document.querySelector<HTMLElement>('[aria-label="더보기"]');

describe('서브메뉴 화면 경계 보정', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('innerWidth', VIEWPORT_WIDTH);
    vi.stubGlobal('innerHeight', VIEWPORT_HEIGHT);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute('aria-label') === '더보기' ? SUB_WIDTH : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute('aria-label') === '더보기' ? SUB_HEIGHT : 0;
      },
    );
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

  // 부모 행의 위치를 원하는 좌표로 고정한 뒤 서브메뉴를 연다
  const openSubMenuAt = async (left: number, right: number) => {
    const Harness = () => {
      const referenceRef = useRef<HTMLElement>(null!);
      const [open] = useState(true);
      return (
        <ListPopup
          open={open}
          ariaLabel="메뉴"
          referenceRef={referenceRef}
          onClose={() => {}}
          contentMountStrategy="sync"
          items={[
            {
              id: 'more',
              label: '더보기',
              children: [{ id: 'child', label: '항목', isPlugin: true }],
            },
          ]}
        />
      );
    };
    await act(async () => root.render(<Harness />));

    const row = document.querySelector<HTMLButtonElement>(
      '[role="menuitem"], [aria-haspopup="menu"]',
    )!;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      left,
      right,
      top: 100,
      bottom: 126,
      width: right - left,
      height: 26,
      x: left,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    // 호버는 150ms 지연이 있어 키보드로 연다 (같은 showSubMenu 경로)
    await act(async () => {
      row.focus();
      row.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
  };

  it('오른쪽에 자리가 있으면 부모와 간격을 두고 배치한다', async () => {
    await openSubMenuAt(20, 120);

    expect(subMenu()?.style.left).toBe(`${120 + SUBMENU_ANCHOR_GAP}px`);
  });

  it('서브메뉴 첫 행의 세로 중심을 부모 행과 맞춘다', async () => {
    await openSubMenuAt(20, 120);

    expect(subMenu()?.style.top).toBe(`${100 - POPUP_CHROME_INSET}px`);
  });

  it('오른쪽이 좁고 왼쪽이 넉넉하면 왼쪽으로 뒤집는다', async () => {
    await openSubMenuAt(380, 480);

    const style = subMenu()?.style;
    expect(style?.left).toBe('');
    expect(style?.right).toBe(`${VIEWPORT_WIDTH - 380 + SUBMENU_ANCHOR_GAP}px`);
  });

  // 뒤집어도 왼쪽에 자리가 없으면 반대쪽으로 잘리기만 한다.
  // 그럴 땐 뒤집지 않고 오른쪽 경계에 맞춰 안쪽으로 당겨야 한다
  it('양쪽 다 좁으면 뒤집지 않고 경계 안으로 당긴다', async () => {
    await openSubMenuAt(120, VIEWPORT_WIDTH - 30);

    const style = subMenu()?.style;
    expect(style?.right).toBe('');
    expect(style?.left).toBe(`${VIEWPORT_WIDTH - SUB_WIDTH - PADDING}px`);
  });

  it('당긴 결과가 왼쪽으로 넘치면 최소 여백을 지킨다', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute('aria-label') === '더보기'
          ? VIEWPORT_WIDTH + 100
          : 0;
      },
    );
    await openSubMenuAt(120, 400);

    expect(subMenu()?.style.left).toBe(`${PADDING}px`);
  });
});
