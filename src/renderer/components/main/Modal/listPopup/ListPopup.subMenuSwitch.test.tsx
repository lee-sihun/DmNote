import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ListPopup from './ListPopup';

// 서브메뉴 표면을 커서 오른쪽 먼 곳에 고정해 진행 방향 판정을 확정적으로 만든다
const SUB_RECT = { left: 300, right: 480, top: 100, bottom: 200 };

const surfaceOf = (label: string) =>
  document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

const rowOf = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (node) => node.textContent === label,
  )!;

// React는 mouseenter/leave를 mouseover/mouseout에서 합성한다
const move = (x: number, y: number) => {
  act(() => {
    rowOf('첫째').dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }),
    );
  });
};

// 실제 mouseover는 좌표를 싣고 온다. 진입 지점이 방향 판정의 마지막 표본이므로
// 좌표를 빼면 (0,0)에서 온 것처럼 취급돼 판정이 뒤집힌다
const enter = (label: string, x: number, y: number) => {
  act(() => {
    rowOf(label).dispatchEvent(
      new MouseEvent('mouseover', {
        bubbles: true,
        relatedTarget: null,
        clientX: x,
        clientY: y,
      }),
    );
  });
};

const leave = (label: string) => {
  act(() => {
    rowOf(label).dispatchEvent(
      new MouseEvent('mouseout', {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
};

const tick = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const Harness = ({ open }: { open: boolean }) => {
  const referenceRef = useRef<HTMLElement>(null!);
  return (
    <ListPopup
      open={open}
      ariaLabel="메뉴"
      referenceRef={referenceRef}
      onClose={() => {}}
      contentMountStrategy="sync"
      items={[
        { id: 'a', label: '첫째', children: [{ id: 'a1', label: 'A1' }] },
        { id: 'b', label: '둘째', children: [{ id: 'b1', label: 'B1' }] },
      ]}
    />
  );
};

describe('서브메뉴 형제 전환', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (open: boolean) => {
    await act(async () => {
      root.render(<Harness open={open} />);
    });
  };

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const label = this.getAttribute('aria-label');
        const isSubSurface = label === '첫째' || label === '둘째';
        const box = isSubSurface
          ? SUB_RECT
          : { left: 0, right: 100, top: 100, bottom: 130 };
        return {
          ...box,
          x: box.left,
          y: box.top,
          width: box.right - box.left,
          height: box.bottom - box.top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await render(true);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    host.remove();
    document.body.innerHTML = '';
  });

  const openFirst = () => {
    enter('첫째', 50, 115);
    tick(150);
  };

  // 서브메뉴에서 멀어지는 방향이라 의도 판정에 걸리지 않는다
  const leaveAwayFromSubMenu = () => {
    move(400, 150);
    move(10, 400);
    leave('첫째');
    enter('둘째', 10, 420);
  };

  // 왼쪽 아래에서 오른쪽 위 서브메뉴를 향해 대각선으로 들어간다
  const leaveTowardSubMenu = () => {
    move(10, 260);
    leave('첫째');
    enter('둘째', 60, 230);
  };

  it('첫 열림에는 진입 모션이 붙는다', () => {
    openFirst();

    const surface = surfaceOf('첫째');
    expect(surface).not.toBeNull();
    expect(surface?.className).toContain('tooltip-fade-in');
  });

  it('형제로 넘어가면 진입 모션을 재생하지 않는다', () => {
    openFirst();
    leaveAwayFromSubMenu();
    tick(0);

    const surface = surfaceOf('둘째');
    expect(surface).not.toBeNull();
    expect(surface?.className).not.toContain('tooltip-fade-in');
    expect(surfaceOf('첫째')).toBeNull();
  });

  it('서브메뉴로 향하는 커서는 형제 전환을 막는다', () => {
    openFirst();
    leaveTowardSubMenu();
    tick(0);

    expect(surfaceOf('첫째')).not.toBeNull();
    expect(surfaceOf('둘째')).toBeNull();
  });

  it('길목에 머무르면 유예 시간 뒤 형제가 넘겨받는다', () => {
    openFirst();
    leaveTowardSubMenu();
    tick(300);

    expect(surfaceOf('둘째')).not.toBeNull();
    expect(surfaceOf('첫째')).toBeNull();
  });

  // 길목으로 판정되면 기존 표면의 닫힘이 인계 뒤로 미뤄져야 한다.
  // 안 그러면 커서가 서브메뉴에 닿기 전에 닫혀 의도 판정이 무의미해진다
  it('길목을 지나는 동안 기존 표면이 닫히지 않는다', () => {
    openFirst();
    leaveTowardSubMenu();
    tick(250);

    expect(
      surfaceOf('첫째'),
      '닫힘 예산 200ms를 넘겨도 살아 있어야 한다',
    ).not.toBeNull();
  });

  // 어느 시점에도 표면이 하나는 떠 있어야 인계가 끊겨 보이지 않는다
  it('인계 도중 표면이 비는 순간이 없다', () => {
    openFirst();
    leaveTowardSubMenu();

    let elapsed = 0;
    for (const stop of [1, 100, 200, 250, 299, 300, 350, 400, 450]) {
      tick(stop - elapsed);
      elapsed = stop;
      const shown = surfaceOf('첫째') ?? surfaceOf('둘째');
      expect(shown, `${stop}ms`).not.toBeNull();
    }
  });

  it('길목을 지나쳐 행을 벗어나면 넘겨받지 않는다', () => {
    openFirst();
    leaveTowardSubMenu();
    leave('둘째');
    tick(300);

    expect(surfaceOf('둘째')).toBeNull();
  });

  it('열린 서브메뉴를 가진 행만 aria-expanded가 참이다', () => {
    openFirst();

    expect(rowOf('첫째').getAttribute('aria-expanded')).toBe('true');
    expect(rowOf('둘째').getAttribute('aria-expanded')).toBe('false');
  });

  // 팝업은 닫혀도 마운트를 유지하므로 형제 활성 상태가 다음 세션으로 샌다.
  // 새 세션의 첫 호버는 형제 전환이 아니라 첫 열림이어야 한다
  // 닫힘 애니메이션 동안 행은 살아 있어 예약된 호버 타이머가 뒤늦게 터진다.
  // 초기화가 닫는 순간에만 걸리면 그 타이머가 ref를 다시 채운다
  it('닫는 도중 남은 호버 타이머가 다음 세션을 오염시키지 않는다', async () => {
    enter('첫째', 50, 115);
    tick(50);
    await render(false);
    tick(300);
    await render(true);

    enter('둘째', 50, 115);
    tick(0);
    expect(surfaceOf('둘째'), '형제 전환으로 오인되면 즉시 열린다').toBeNull();

    tick(150);
    expect(surfaceOf('둘째')?.className).toContain('tooltip-fade-in');
  });

  it('닫았다 다시 열면 첫 호버가 형제 전환으로 오인되지 않는다', async () => {
    openFirst();
    await render(false);
    tick(300);
    await render(true);

    enter('둘째', 50, 115);
    tick(0);
    expect(surfaceOf('둘째'), '유예 없이 즉시 열리면 안 된다').toBeNull();

    tick(150);
    const surface = surfaceOf('둘째');
    expect(surface).not.toBeNull();
    expect(surface?.className).toContain('tooltip-fade-in');
  });
});
