import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { detachPropertiesPanel, dragContext, setDragCursor } = vi.hoisted(
  () => ({
    detachPropertiesPanel: vi.fn(() => Promise.resolve('done')),
    dragContext: vi.fn(() => Promise.resolve(null)),
    setDragCursor: vi.fn(() => Promise.resolve()),
  }),
);

vi.mock('@api/modules/window/panelWindowApi', () => ({
  panelWindowApi: {
    dragContext,
    moveTo: vi.fn(() => Promise.resolve()),
    setDragCursor,
  },
}));

vi.mock(
  '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock',
  () => ({
    isHistoryEditorFlushLocked: () => false,
  }),
);

vi.mock('@stores/grid/usePanelHostStore', () => ({
  detachPropertiesPanel,
  dockPropertiesPanel: vi.fn(),
  usePanelHostStore: {
    getState: () => ({ placement: 'docked', transition: 'idle' }),
  },
}));

import { usePanelHeaderDrag } from './usePanelHeaderDrag';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const Harness = () => {
  const dockAreaRef = useRef<HTMLDivElement>(null);
  usePanelHeaderDrag({
    hostDocument: document,
    hostWindow: window,
    dockAreaRef,
  });

  return (
    <div ref={dockAreaRef} data-dmn-panel-frame>
      <div className="dmn-panel-header" data-testid="panel-header" />
    </div>
  );
};

describe('usePanelHeaderDrag cursor contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    document.body.classList.remove('dmn-dragging');
    dragContext.mockClear();
    detachPropertiesPanel.mockClear();
    setDragCursor.mockClear();

    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.classList.remove('dmn-dragging');
  });

  it('유효한 헤더 press부터 네이티브 커서를 고정하고 놓으면 해제한다', async () => {
    const header = container.querySelector<HTMLElement>(
      '[data-testid="panel-header"]',
    )!;

    act(() => {
      header.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 20,
          clientY: 10,
          screenX: 120,
          screenY: 110,
        }),
      );
    });

    expect(setDragCursor).toHaveBeenCalledWith(true);
    expect(document.body.classList.contains('dmn-dragging')).toBe(false);

    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          screenX: 120,
          screenY: 110,
        }),
      );
      await Promise.resolve();
    });

    expect(setDragCursor.mock.calls).toEqual([[true], [false]]);
    expect(document.body.classList.contains('dmn-dragging')).toBe(false);
  });

  it('빠르게 놓아도 커서 고정 완료 뒤에 해제한다', async () => {
    let finishActivation: (() => void) | undefined;
    setDragCursor.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishActivation = resolve;
      }),
    );
    const header = container.querySelector<HTMLElement>(
      '[data-testid="panel-header"]',
    )!;

    act(() => {
      header.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 20,
          clientY: 10,
          screenX: 120,
          screenY: 110,
        }),
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          screenX: 120,
          screenY: 110,
        }),
      );
    });

    expect(setDragCursor.mock.calls).toEqual([[true]]);

    await act(async () => {
      finishActivation?.();
      await Promise.resolve();
    });

    expect(setDragCursor.mock.calls).toEqual([[true], [false]]);
  });

  it('tear-off 드래그 종료 시 분리 창의 네이티브 커서를 해제한다', async () => {
    const header = container.querySelector<HTMLElement>(
      '[data-testid="panel-header"]',
    )!;

    act(() => {
      header.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 20,
          clientY: 10,
          screenX: 120,
          screenY: 110,
        }),
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          screenX: 140,
          screenY: 110,
        }),
      );
      await Promise.resolve();
    });

    expect(detachPropertiesPanel).toHaveBeenCalledOnce();

    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          screenX: 140,
          screenY: 110,
        }),
      );
      await Promise.resolve();
    });

    expect(setDragCursor).toHaveBeenCalledWith(false);
  });
});
