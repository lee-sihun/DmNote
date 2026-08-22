import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  present: vi.fn(() => Promise.resolve()),
  dock: vi.fn(() => Promise.resolve()),
  flushFocusedEditor: vi.fn(() => Promise.resolve(true)),
  openPanelChildWindow: vi.fn(() => Promise.resolve({})),
  getPanelChildWindow: vi.fn((): unknown => null),
}));

vi.mock('@api/modules/panelWindowApi', () => ({
  panelWindowApi: {
    present: () => mocks.present(),
    dock: () => mocks.dock(),
  },
}));
vi.mock('@src/renderer/editor/runtime/lifecycleEditorFlush', () => ({
  flushFocusedEditor: () => mocks.flushFocusedEditor(),
}));
vi.mock('@utils/panelWindow/panelChildWindow', () => ({
  openPanelChildWindow: () => mocks.openPanelChildWindow(),
  getPanelChildWindow: () => mocks.getPanelChildWindow(),
}));

import {
  detachPropertiesPanel,
  dockPropertiesPanel,
  notePanelWindowHidden,
  usePanelHostStore,
} from './usePanelHostStore';

describe('usePanelHostStore transitions', () => {
  let stopAttachmentMirror: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.present.mockClear().mockImplementation(() => Promise.resolve());
    mocks.dock.mockClear().mockImplementation(() => Promise.resolve());
    mocks.flushFocusedEditor
      .mockClear()
      .mockImplementation(() => Promise.resolve(true));
    mocks.openPanelChildWindow
      .mockClear()
      .mockImplementation(() => Promise.resolve({}));
    mocks.getPanelChildWindow.mockClear().mockReturnValue(null);
    usePanelHostStore.setState({
      placement: 'docked',
      attachedPlacement: 'docked',
      transition: 'idle',
    });
    stopAttachmentMirror = usePanelHostStore.subscribe((state, previous) => {
      if (state.placement === previous.placement) return;
      setTimeout(() => {
        usePanelHostStore
          .getState()
          .setAttachedPlacement(usePanelHostStore.getState().placement);
      }, 0);
    });
  });

  afterEach(() => {
    stopAttachmentMirror();
    vi.useRealTimers();
  });

  const run = async (task: Promise<unknown>) => {
    await vi.runAllTimersAsync();
    return task;
  };

  it('detach moves the host before presenting the window', async () => {
    const order: string[] = [];
    mocks.openPanelChildWindow.mockImplementation(async () => {
      order.push('open');
      return {};
    });
    mocks.present.mockImplementation(async () => {
      order.push(`present:${usePanelHostStore.getState().placement}`);
    });

    const outcome = await run(detachPropertiesPanel());

    expect(outcome).toBe('done');
    expect(order).toEqual(['open', 'present:detached']);
    expect(usePanelHostStore.getState()).toMatchObject({
      placement: 'detached',
      transition: 'idle',
    });
  });

  it('does not present until the host is attached to the child document', async () => {
    stopAttachmentMirror();
    usePanelHostStore.getState().setAttachedPlacement(null);
    const task = detachPropertiesPanel();

    await vi.advanceTimersByTimeAsync(0);
    expect(usePanelHostStore.getState().placement).toBe('detached');
    expect(mocks.present).not.toHaveBeenCalled();

    usePanelHostStore.getState().setAttachedPlacement('detached');
    expect(await task).toBe('done');
    expect(mocks.present).toHaveBeenCalledOnce();
  });

  it('returns to the dock without presenting when host attachment times out', async () => {
    stopAttachmentMirror();

    expect(await run(detachPropertiesPanel())).toBe('failed');
    expect(mocks.present).not.toHaveBeenCalled();
    expect(usePanelHostStore.getState()).toMatchObject({
      placement: 'docked',
      attachedPlacement: 'docked',
      transition: 'idle',
    });
  });

  it('detach is blocked when the focused edit cannot be settled', async () => {
    mocks.flushFocusedEditor.mockResolvedValue(false);
    expect(await run(detachPropertiesPanel())).toBe('blocked');
    expect(mocks.openPanelChildWindow).not.toHaveBeenCalled();
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });

  it('detach reverts to docked when present fails', async () => {
    mocks.present.mockRejectedValue(new Error('no window'));
    expect(await run(detachPropertiesPanel())).toBe('failed');
    expect(usePanelHostStore.getState()).toMatchObject({
      placement: 'docked',
      transition: 'idle',
    });
  });

  it('detach fails when the child window cannot be opened', async () => {
    mocks.openPanelChildWindow.mockRejectedValue(new Error('denied'));
    expect(await run(detachPropertiesPanel())).toBe('failed');
    expect(mocks.present).not.toHaveBeenCalled();
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });

  it('dock moves the host back before hiding the window', async () => {
    usePanelHostStore.setState({ placement: 'detached' });
    const order: string[] = [];
    mocks.dock.mockImplementation(async () => {
      order.push(`dock:${usePanelHostStore.getState().placement}`);
    });

    expect(await run(dockPropertiesPanel())).toBe('done');
    expect(order).toEqual(['dock:docked']);
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });

  it('dock hides the child window when the panel host is unmounted', async () => {
    stopAttachmentMirror();
    usePanelHostStore.setState({
      placement: 'detached',
      attachedPlacement: null,
    });

    expect(await run(dockPropertiesPanel())).toBe('done');
    expect(mocks.dock).toHaveBeenCalledOnce();
    expect(usePanelHostStore.getState()).toMatchObject({
      placement: 'docked',
      attachedPlacement: null,
    });
  });

  it('dock still hides the child window when host attachment times out', async () => {
    stopAttachmentMirror();
    usePanelHostStore.setState({
      placement: 'detached',
      attachedPlacement: 'detached',
    });

    expect(await run(dockPropertiesPanel())).toBe('done');
    expect(mocks.dock).toHaveBeenCalledOnce();
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });

  it('dock restores the detached host when hiding fails and the window is alive', async () => {
    usePanelHostStore.setState({ placement: 'detached' });
    mocks.dock.mockRejectedValue(new Error('hide failed'));
    mocks.getPanelChildWindow.mockReturnValue({});
    expect(await run(dockPropertiesPanel())).toBe('failed');
    expect(usePanelHostStore.getState().placement).toBe('detached');
  });

  it('reports busy while another transition is in flight and done when already there', async () => {
    usePanelHostStore.setState({ transition: 'docking' });
    expect(await detachPropertiesPanel()).toBe('busy');
    usePanelHostStore.setState({ transition: 'idle', placement: 'detached' });
    expect(await detachPropertiesPanel()).toBe('done');
    usePanelHostStore.setState({ placement: 'docked' });
    expect(await dockPropertiesPanel()).toBe('done');
  });

  it('notePanelWindowHidden docks the host only when idle', () => {
    usePanelHostStore.setState({
      placement: 'detached',
      transition: 'detaching',
    });
    notePanelWindowHidden();
    expect(usePanelHostStore.getState().placement).toBe('detached');
    usePanelHostStore.setState({ transition: 'idle' });
    notePanelWindowHidden();
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });
});
