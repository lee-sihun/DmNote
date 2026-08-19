import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  childWindow: null as null | { window: Window; document: Document },
  panelProps: [] as Array<Record<string, unknown>>,
  mountCount: 0,
  applyNativeChrome: vi.fn(() => Promise.resolve(false)),
  startDragging: vi.fn((_x: number, _y: number) => Promise.resolve()),
}));

vi.mock('@utils/panelWindow/panelChildWindow', () => ({
  getPanelChildWindow: () => mocks.childWindow,
}));
vi.mock('@api/modules/panelWindowApi', () => ({
  panelWindowApi: {
    applyNativeChrome: () => mocks.applyNativeChrome(),
    startDragging: (x: number, y: number) => mocks.startDragging(x, y),
    mainWindowFrame: () => Promise.resolve(null),
    moveTo: () => Promise.resolve(),
    presentAt: () => Promise.resolve(),
  },
}));
vi.mock('@src/renderer/editor/runtime/lifecycleEditorFlush', () => ({
  flushFocusedEditor: () => Promise.resolve(true),
}));
vi.mock('@src/renderer/editor/runtime/historyEditorFlushLock', () => ({
  isHistoryEditorFlushLocked: () => false,
}));
vi.mock('@utils/core/platform', () => ({ isMac: () => false }));
vi.mock('@utils/panelWindow/nativeChrome', () => ({
  readTokenColor: () => null,
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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.childWindow = null;
    mocks.panelProps = [];
    mocks.mountCount = 0;
    usePanelHostStore.setState({ placement: 'docked', transition: 'idle' });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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
});
