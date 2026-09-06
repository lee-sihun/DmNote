import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingPopup from './FloatingPopup';
import { stubAnimationFrame } from '@src/renderer/__tests__/deferredContentHarness';

// 퇴장 유예가 생기면서 닫힘 구간에도 DOM이 남는다. 그 구간의 계약을 고정한다
describe('FloatingPopup exit transition', () => {
  let host: HTMLDivElement;
  let root: Root;

  const surface = () =>
    document.querySelector<HTMLElement>('[data-dmn-floating-popup="true"]');

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const render = async (props: {
    open: boolean;
    fixedX?: number;
    fixedY?: number;
  }) => {
    await act(async () => {
      root.render(
        <FloatingPopup
          open={props.open}
          ariaLabel="Motion popup"
          fixedX={props.fixedX}
          fixedY={props.fixedY}
          autoClose={false}
          onClose={() => undefined}
        >
          <button type="button">Item</button>
        </FloatingPopup>,
      );
    });
  };

  it('keeps the same node and body portal when closing clears the fixed position', async () => {
    await render({ open: true, fixedX: 120, fixedY: 90 });

    const opened = surface();
    expect(opened).not.toBeNull();
    // 고정 좌표는 body 포털 - 인라인으로 내려오면 재부모화된 것
    expect(opened?.parentElement).toBe(document.body);

    // 호출부는 닫으면서 좌표까지 비운다
    await render({ open: false });

    const closing = surface();
    expect(closing).toBe(opened);
    expect(closing?.parentElement).toBe(document.body);
    expect(closing?.getAttribute('data-dmn-motion-state')).toBe('closing');
    expect(closing?.style.left).toBe('120px');

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(surface()).toBeNull();
  });

  it('restores focus to the trigger that reopened it during the exit window', async () => {
    const first = document.createElement('button');
    const second = document.createElement('button');
    document.body.append(first, second);

    first.focus();
    await render({ open: true, fixedX: 10, fixedY: 10 });
    const opened = surface();

    // 닫기 시작 시점에 곧바로 복원된다 - 퇴장이 끝나기를 기다리지 않는다
    await render({ open: false, fixedX: 10, fixedY: 10 });
    expect(document.activeElement).toBe(first);

    // 퇴장 유예 안에서 다른 트리거로 재오픈하면 표면이 재사용된다
    second.focus();
    await render({ open: true, fixedX: 10, fixedY: 10 });
    expect(surface()).toBe(opened);

    await render({ open: false, fixedX: 10, fixedY: 10 });
    expect(document.activeElement).toBe(second);
  });

  it('after-paint 콘텐츠가 붙기 전에는 entering에 머물고, 붙은 뒤 open으로 넘어간다', async () => {
    // rAF를 타이머로 흘려 지연 마운트 시점을 손으로 넘긴다
    stubAnimationFrame();
    await act(async () => {
      root.render(
        <FloatingPopup
          open
          ariaLabel="Deferred motion popup"
          fixedX={10}
          fixedY={10}
          autoClose={false}
          contentMountStrategy="after-paint"
          onClose={() => undefined}
        >
          <button type="button">Item</button>
        </FloatingPopup>,
      );
    });
    // 빈 셸 자리에서 등장을 시작하면 내용이 붙는 순간 클램프가 다시 돌아 튄다
    expect(surface()?.getAttribute('data-dmn-motion-state')).toBe('entering');
    expect(surface()?.textContent).not.toContain('Item');

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(surface()?.textContent).toContain('Item');
    expect(surface()?.getAttribute('data-dmn-motion-state')).toBe('open');
  });
});
