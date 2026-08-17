import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FloatingPopup from './FloatingPopup';

const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;
const MENU_WIDTH = 200;
const MENU_HEIGHT = 300;
const PADDING = 5;

// 지연 마운트 팝업은 내용이 붙기 전에는 폭이 거의 0이다.
// 프로덕션 기본값이 'after-paint'라 그 상태로 위치를 굳히면 경계 밖으로 잘린다
let grown = false;

const stubSurfaceSize = () => {
  const isSurface = (element: HTMLElement) =>
    element.getAttribute('role') === 'dialog';
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (!isSurface(this)) return 0;
      if (!this.textContent?.includes('내용')) return 8;
      return grown ? MENU_WIDTH * 2 : MENU_WIDTH;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (!isSurface(this)) return 0;
      return this.textContent?.includes('내용') ? MENU_HEIGHT : 8;
    },
  );
};

// jsdom에는 ResizeObserver가 없다. 스텁하지 않으면 재측정 분기가 통째로 죽는다
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  constructor(private callback: () => void) {
    ResizeObserverStub.instances.push(this);
  }
  observe() {}
  disconnect() {}
  fire() {
    this.callback();
  }
}

describe('FloatingPopup 화면 경계 보정', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('innerWidth', VIEWPORT_WIDTH);
    vi.stubGlobal('innerHeight', VIEWPORT_HEIGHT);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
    grown = false;
    ResizeObserverStub.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    stubSurfaceSize();
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
  });

  const surface = () =>
    document.querySelector<HTMLElement>('[aria-label="경계 팝업"]');

  // 프로덕션과 같은 지연 마운트 - 내용이 붙은 뒤 다시 재는지가 핵심
  const openAt = async (x: number, y: number) => {
    await act(async () => {
      root.render(
        <FloatingPopup
          open
          ariaLabel="경계 팝업"
          fixedX={x}
          fixedY={y}
          animate={false}
          contentMountStrategy="after-paint"
          onClose={() => {}}
        >
          <button type="button">내용</button>
        </FloatingPopup>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  it('오른쪽 경계를 넘으면 안쪽으로 당긴다', async () => {
    await openAt(VIEWPORT_WIDTH - 20, 100);

    expect(surface()?.style.left).toBe(
      `${VIEWPORT_WIDTH - MENU_WIDTH - PADDING}px`,
    );
  });

  it('아래쪽 경계를 넘으면 위로 당긴다', async () => {
    await openAt(100, VIEWPORT_HEIGHT - 20);

    expect(surface()?.style.top).toBe(
      `${VIEWPORT_HEIGHT - MENU_HEIGHT - PADDING}px`,
    );
  });

  it('양쪽을 동시에 넘어도 둘 다 보정한다', async () => {
    await openAt(VIEWPORT_WIDTH - 10, VIEWPORT_HEIGHT - 10);

    expect(surface()?.style.left).toBe(
      `${VIEWPORT_WIDTH - MENU_WIDTH - PADDING}px`,
    );
    expect(surface()?.style.top).toBe(
      `${VIEWPORT_HEIGHT - MENU_HEIGHT - PADDING}px`,
    );
  });

  it('경계 안이면 요청한 좌표를 그대로 쓴다', async () => {
    await openAt(120, 80);

    expect(surface()?.style.left).toBe('120px');
    expect(surface()?.style.top).toBe('80px');
  });

  it('음수 좌표는 최소 패딩으로 올린다', async () => {
    await openAt(-50, -50);

    expect(surface()?.style.left).toBe(`${PADDING}px`);
    expect(surface()?.style.top).toBe(`${PADDING}px`);
  });

  // 비동기 로드나 폰트 스왑으로 내용이 나중에 커지는 경우
  it('마운트 뒤 크기가 커지면 다시 재서 안쪽으로 당긴다', async () => {
    await openAt(VIEWPORT_WIDTH - 20, 100);
    const settled = surface()?.style.left;

    grown = true;
    await act(async () => {
      ResizeObserverStub.instances.forEach((instance) => instance.fire());
    });

    expect(surface()?.style.left).not.toBe(settled);
    expect(surface()?.style.left).toBe(
      `${VIEWPORT_WIDTH - MENU_WIDTH * 2 - PADDING}px`,
    );
  });
});
