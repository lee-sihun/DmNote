import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  childWindow: null as null | { window: Window; document: Document },
  panelProps: [] as Array<Record<string, unknown>>,
  mountCount: 0,
  applyNativeChrome: vi.fn(() =>
    Promise.resolve({ webRadius: 12, webRing: true }),
  ),
  readTokenColor: vi.fn((): [number, number, number, number] | null => null),
  startDragging: vi.fn((_x: number, _y: number) => Promise.resolve()),
  dock: vi.fn(() => Promise.resolve()),
  flushResult: true,
}));

vi.mock('@utils/panelWindow/panelChildWindow', () => ({
  getPanelChildWindow: () => mocks.childWindow,
}));
vi.mock('@api/modules/panelWindowApi', () => ({
  panelWindowApi: {
    applyNativeChrome: () => mocks.applyNativeChrome(),
    startDragging: (x: number, y: number) => mocks.startDragging(x, y),
    dragContext: () =>
      Promise.resolve({ mainFrame: null, mainContentOrigin: null }),
    moveTo: () => Promise.resolve(),
    presentAt: () => Promise.resolve(),
    dock: () => mocks.dock(),
  },
}));
vi.mock('@src/renderer/editor/runtime/lifecycleEditorFlush', () => ({
  flushFocusedEditor: () => Promise.resolve(mocks.flushResult),
}));
vi.mock('@src/renderer/editor/runtime/historyEditorFlushLock', () => ({
  isHistoryEditorFlushLocked: () => false,
}));
vi.mock('@utils/core/platform', () => ({
  isMac: () => false,
  isWindows: () => false,
}));
vi.mock('@utils/panelWindow/nativeChrome', () => ({
  readTokenColor: () => mocks.readTokenColor(),
}));
// 실제 패널 대신 로컬 state를 가진 스텁 - 이동 중 리마운트 여부를 state로 판별
vi.mock('@components/main/Grid/PropertiesPanel', () => ({
  default: function PanelStub(props: Record<string, unknown>) {
    mocks.panelProps.push(props);
    const [count, setCount] = useState(0);
    React.useEffect(() => {
      mocks.mountCount += 1;
    }, []);
    return (
      <div data-testid="panel-stub" data-variant={String(props.frameVariant)}>
        <button
          type="button"
          data-testid="bump"
          onClick={() => setCount((value) => value + 1)}
        >
          {count}
        </button>
        <button
          type="button"
          data-testid="detach-action"
          onClick={() => (props.onDetachAction as () => void)()}
        >
          {String(props.detachAction)}
        </button>
      </div>
    );
  },
}));

import PropertiesPanelHost from './PropertiesPanelHost';
import { usePanelHostStore } from '@stores/grid/usePanelHostStore';
import { registerPopupLayer } from '@components/main/Modal/popupLayer';

const createChild = () => {
  const doc = document.implementation.createHTMLDocument('child');
  const win = {
    document: doc,
    closed: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window;
  return { window: win, document: doc };
};

describe('PropertiesPanelHost', () => {
  let container: HTMLDivElement;
  let root: Root;
  const layerCleanups: Array<() => void> = [];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.childWindow = null;
    mocks.panelProps = [];
    mocks.mountCount = 0;
    mocks.applyNativeChrome.mockClear();
    mocks.readTokenColor.mockReturnValue(null);
    mocks.dock.mockReset();
    mocks.dock.mockResolvedValue(undefined);
    mocks.flushResult = true;
    usePanelHostStore.setState({ placement: 'docked', transition: 'idle' });
  });

  afterEach(async () => {
    await act(async () =>
      layerCleanups
        .splice(0)
        .reverse()
        .forEach((cleanup) => cleanup()),
    );
    await act(async () => root.unmount());
    container.remove();
    document
      .querySelectorAll('[data-dmn-modal-backdrop="true"]')
      .forEach((element) => element.remove());
  });

  const render = async () => {
    await act(async () => {
      root.render(<PropertiesPanelHost />);
    });
  };

  const hostElement = () =>
    document.querySelector('[data-dmn-panel-host]') ??
    mocks.childWindow?.document.querySelector('[data-dmn-panel-host]') ??
    null;

  it('mounts the panel into a host element inside the slot while docked', async () => {
    await render();
    const slot = container.querySelector('[data-dmn-panel-slot]')!;
    const host = hostElement()!;
    expect(host.parentElement).toBe(slot);
    expect(host.querySelector('[data-testid="panel-stub"]')).not.toBeNull();
    expect(mocks.panelProps.at(-1)).toMatchObject({
      frameVariant: 'inline',
      detachAction: 'detach',
    });
  });

  it('moves the same host element into the child document without remounting the panel', async () => {
    await render();
    const bump = () =>
      hostElement()!.querySelector('[data-testid="bump"]') as HTMLButtonElement;
    await act(async () => bump().click());
    expect(bump().textContent).toBe('1');
    const hostBefore = hostElement();

    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });

    const hostAfter = mocks.childWindow.document.querySelector(
      '[data-dmn-panel-host]',
    );
    expect(hostAfter).toBe(hostBefore);
    expect(hostAfter!.parentElement).toBe(mocks.childWindow.document.body);
    expect(hostAfter!.ownerDocument).toBe(mocks.childWindow.document);
    // 로컬 state가 살아 있고 마운트는 한 번뿐
    expect(bump().textContent).toBe('1');
    expect(mocks.mountCount).toBe(1);
    expect(mocks.panelProps.at(-1)).toMatchObject({
      frameVariant: 'window',
      detachAction: 'reattach',
    });
    // 옮겨간 뒤에도 React 이벤트가 동작한다
    await act(async () => bump().click());
    expect(bump().textContent).toBe('2');

    await act(async () => {
      usePanelHostStore.getState().setPlacement('docked');
    });
    const slot = container.querySelector('[data-dmn-panel-slot]')!;
    expect(hostElement()!.parentElement).toBe(slot);
    expect(hostElement()!.ownerDocument).toBe(document);
    expect(bump().textContent).toBe('2');
    expect(mocks.mountCount).toBe(1);
  });

  it('falls back to docked when the child window is gone', async () => {
    await render();
    mocks.childWindow = null;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    expect(usePanelHostStore.getState().placement).toBe('docked');
    const slot = container.querySelector('[data-dmn-panel-slot]')!;
    expect(hostElement()!.parentElement).toBe(slot);
  });

  it('wires child-window keyboard and blur listeners only while detached', async () => {
    await render();
    mocks.childWindow = createChild();
    const add = mocks.childWindow.window
      .addEventListener as unknown as ReturnType<typeof vi.fn>;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });
    const events = add.mock.calls.map((call) => call[0]);
    expect(events).toEqual(expect.arrayContaining(['keydown', 'blur']));
    const remove = mocks.childWindow.window
      .removeEventListener as unknown as ReturnType<typeof vi.fn>;
    await act(async () => {
      usePanelHostStore.getState().setPlacement('docked');
    });
    expect(remove.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['keydown', 'blur']),
    );
  });

  it('활성 모달 동안 분리 문서 전체를 잠그고 종료 후 복원한다', async () => {
    await render();
    mocks.childWindow = createChild();
    await act(async () => {
      usePanelHostStore.getState().setPlacement('detached');
    });

    const modal = document.createElement('div');
    modal.dataset.dmnModalBackdrop = 'true';
    document.body.appendChild(modal);
    let unregister = () => {};
    await act(async () => {
      unregister = registerPopupLayer(modal);
      layerCleanups.push(unregister);
    });

    const childBody = mocks.childWindow.document.body;
    const panelRoot = childBody.querySelector<HTMLElement>(
      '[data-dmn-panel-host] > div',
    )!;
    expect(childBody.inert).toBe(true);
    expect(childBody.dataset.dmnModalLocked).toBe('true');
    expect(childBody.style.opacity).toBe('0.4');
    expect(panelRoot.hasAttribute('inert')).toBe(true);

    await act(async () => unregister());

    expect(childBody.inert).toBeUndefined();
    expect(childBody.dataset.dmnModalLocked).toBeUndefined();
    expect(childBody.style.opacity).toBe('');
    expect(panelRoot.hasAttribute('inert')).toBe(false);
  });

  describe('네이티브 창 크롬', () => {
    const detachedRoot = () =>
      mocks.childWindow!.document.querySelector<HTMLElement>(
        '[data-dmn-panel-host] > div',
      )!;
    const ring = () =>
      mocks.childWindow!.document.querySelector(
        '[data-dmn-panel-host] [aria-hidden="true"]',
      );
    // head MutationObserver → rAF 코얼레싱을 태워 sync를 한 번 돌린다
    const pokeCustomCss = async () => {
      await act(async () => {
        document.head.appendChild(document.createElement('style'));
      });
      await act(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });
    };

    it('백엔드가 정한 반경·링을 그대로 반영한다', async () => {
      mocks.readTokenColor.mockReturnValue([0.1, 0.1, 0.12, 1]);
      mocks.applyNativeChrome.mockResolvedValue({
        webRadius: 0,
        webRing: false,
      });
      await render();
      mocks.childWindow = createChild();
      await act(async () => {
        usePanelHostStore.getState().setPlacement('detached');
      });

      expect(mocks.applyNativeChrome).toHaveBeenCalledTimes(1);
      expect(
        detachedRoot().style.getPropertyValue('--dmn-panel-window-radius'),
      ).toBe('0px');
      // 네이티브가 라인을 그리므로 CSS 링은 없어야 한다 (겹치면 진해짐)
      expect(ring()).toBeNull();
    });

    it('토큰을 못 읽으면 CSS 링으로 물러나고, 색이 돌아오면 다시 요청한다', async () => {
      const color: [number, number, number, number] = [0.1, 0.1, 0.12, 1];
      mocks.readTokenColor.mockReturnValue(color);
      mocks.applyNativeChrome.mockResolvedValue({
        webRadius: 0,
        webRing: false,
      });
      await render();
      mocks.childWindow = createChild();
      await act(async () => {
        usePanelHostStore.getState().setPlacement('detached');
      });
      expect(mocks.applyNativeChrome).toHaveBeenCalledTimes(1);

      // 커스텀 CSS를 타이핑하다 토큰이 잠깐 색으로 해석되지 않는 구간
      mocks.readTokenColor.mockReturnValue(null);
      await pokeCustomCss();
      expect(
        detachedRoot().style.getPropertyValue('--dmn-panel-window-radius'),
      ).toBe('12px');
      expect(ring()).not.toBeNull();

      // 같은 색으로 되돌아왔다 - 시그니처가 같아도 재요청해야 한다 (dedupe 고착 방지)
      mocks.readTokenColor.mockReturnValue(color);
      await pokeCustomCss();
      expect(mocks.applyNativeChrome).toHaveBeenCalledTimes(2);
      expect(
        detachedRoot().style.getPropertyValue('--dmn-panel-window-radius'),
      ).toBe('0px');
      expect(ring()).toBeNull();
    });
  });
});
