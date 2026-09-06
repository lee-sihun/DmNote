import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dropdown from './Dropdown';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const VIEWPORT_WIDTH = 600;
const VIEWPORT_HEIGHT = 500;
const MENU_WIDTH = 180;
const MENU_HEIGHT = 120;
const MARGIN = 8;
const GAP = 4;
// 하단 상주 크롬(미니 메뉴 바) 회피 여백 - Dropdown.place와 같은 값
const BOTTOM_PADDING = 60;

const options = [
  { label: 'One', value: 'one' },
  { label: 'Two', value: 'two' },
];

const menu = () =>
  document.querySelector<HTMLElement>(
    '[role="listbox"]:not([data-dmn-motion-state="closing"])',
  );

describe('Dropdown 화면 경계 보정', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('innerWidth', VIEWPORT_WIDTH);
    vi.stubGlobal('innerHeight', VIEWPORT_HEIGHT);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute('role') === 'listbox' ? MENU_WIDTH : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute('role') === 'listbox' ? MENU_HEIGHT : 0;
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

  // 트리거 위치를 원하는 좌표로 고정한 뒤 메뉴를 연다
  const openAt = async (rect: Partial<DOMRect>, align?: 'left' | 'right') => {
    await act(async () => {
      root.render(
        <Dropdown
          options={options}
          value="one"
          onChange={() => {}}
          align={align}
        />,
      );
    });
    const trigger = host.querySelector('button')!;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
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
    await act(async () => trigger.click());
  };

  it('오른쪽 경계를 넘으면 안쪽으로 당긴다', async () => {
    await openAt({ left: VIEWPORT_WIDTH - 40, right: VIEWPORT_WIDTH - 10 });

    expect(menu()?.style.left).toBe(
      `${VIEWPORT_WIDTH - MARGIN - MENU_WIDTH}px`,
    );
  });

  it('왼쪽으로 벗어나면 최소 여백까지만 올린다', async () => {
    await openAt({ left: -200, right: -100 });

    expect(menu()?.style.left).toBe(`${MARGIN}px`);
  });

  it('아래 공간이 부족하면 위로 펼친다', async () => {
    // bottom + gap + 높이가 하단 크롬 여백을 침범하는 위치
    await openAt({ top: 380, bottom: 404 });

    const style = menu()?.style;
    expect(style?.top).toBe('');
    expect(style?.bottom).toBe(`${VIEWPORT_HEIGHT - 380 + GAP}px`);
  });

  it('아래 공간이 충분하면 아래로 펼친다', async () => {
    await openAt({ top: 40, bottom: 64 });

    const style = menu()?.style;
    expect(style?.top).toBe(`${64 + GAP}px`);
    expect(style?.bottom).toBe('');
  });

  it('하단 상주 크롬 높이를 남겨둔다', async () => {
    // 화면에는 들어가지만 하단 크롬과 겹치는 위치라 위로 펼쳐야 한다
    const bottom = VIEWPORT_HEIGHT - BOTTOM_PADDING - MENU_HEIGHT + 10;
    await openAt({ top: bottom - 24, bottom });

    expect(menu()?.style.bottom).not.toBe('');
  });

  it('오른쪽 정렬은 right 좌표를 경계 안으로 맞춘다', async () => {
    await openAt({ left: 20, right: 60 }, 'right');

    const style = menu()?.style;
    expect(style?.left).toBe('');
    expect(Number.parseFloat(style?.right ?? '0')).toBeGreaterThanOrEqual(
      MARGIN,
    );
    expect(Number.parseFloat(style?.right ?? '0')).toBeLessThanOrEqual(
      VIEWPORT_WIDTH - MARGIN - MENU_WIDTH,
    );
  });
});
