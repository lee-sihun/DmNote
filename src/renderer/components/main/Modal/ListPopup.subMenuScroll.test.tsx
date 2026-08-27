/**
 * 부모 메뉴 스크롤 시 서브메뉴 닫힘 - 열 때 잰 좌표에 고정된 서브메뉴가 앵커 행과
 * 어긋난 채 남지 않게. 서브메뉴 자체 스크롤은 무시한다
 */
import React, { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ListPopup from './ListPopup';

const subMenu = () =>
  document.querySelector<HTMLElement>('[aria-label="더보기"]');

describe('서브메뉴 스크롤 닫힘', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('innerWidth', 600);
    vi.stubGlobal('innerHeight', 500);
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

  const openSubMenu = async () => {
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
    // 호버는 지연이 있어 키보드로 연다 (같은 showSubMenu 경로)
    await act(async () => {
      row.focus();
      row.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(subMenu()).not.toBeNull();
    return row;
  };

  it('앵커 행을 담은 조상이 스크롤되면 서브메뉴를 닫는다', async () => {
    const row = await openSubMenu();
    const scroller = row.parentElement!;

    await act(async () => {
      scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(subMenu()).toBeNull();
  });

  it('서브메뉴 자체 스크롤은 닫지 않는다', async () => {
    await openSubMenu();
    const sub = subMenu()!;

    await act(async () => {
      sub.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(subMenu()).not.toBeNull();
  });
});
