import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  ackClose: vi.fn((_requestId: string) => Promise.resolve(true)),
  closeListener: null as null | ((payload: { requestId: string }) => void),
  closeUnsubscribe: vi.fn(),
  dock: vi.fn(() => Promise.resolve()),
  flushResult: true,
}));

vi.mock('@api/modules/panelWindowApi', () => ({
  panelWindowApi: {
    ackClose: (requestId: string) => mocks.ackClose(requestId),
    dock: () => mocks.dock(),
    onCloseRequested: (listener: (payload: { requestId: string }) => void) => {
      mocks.closeListener = listener;
      return mocks.closeUnsubscribe;
    },
  },
}));
vi.mock('@hooks/pendingOptimisticCommits', () => ({
  drainPendingOptimisticCommits: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/lifecycleEditorFlush', () => ({
  flushFocusedEditor: () => Promise.resolve(mocks.flushResult),
}));
vi.mock('@utils/panelWindow/panelChildWindow', () => ({
  getPanelChildWindow: () => ({ window: window, document }),
  openPanelChildWindow: vi.fn(),
}));

import { usePanelCloseRequest } from './usePanelCloseRequest';
import { usePanelHostStore } from '@stores/grid/usePanelHostStore';

interface HarnessProps {
  onFailure?: () => void;
  settingsOpen?: boolean;
}

const Harness = ({ onFailure, settingsOpen = false }: HarnessProps) => {
  usePanelCloseRequest(onFailure);
  return <div>{settingsOpen ? 'settings' : 'canvas'}</div>;
};

describe('usePanelCloseRequest', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.ackClose.mockReset();
    mocks.ackClose.mockResolvedValue(true);
    mocks.closeListener = null;
    mocks.closeUnsubscribe.mockClear();
    mocks.dock.mockReset();
    mocks.dock.mockResolvedValue(undefined);
    mocks.flushResult = true;
    usePanelHostStore.setState({
      placement: 'detached',
      attachedPlacement: null,
      transition: 'idle',
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async (props: HarnessProps = {}) => {
    await act(async () => {
      root.render(<Harness {...props} />);
    });
  };

  it('설정 화면으로 전환한 뒤에도 fallback을 ack하고 도킹한다', async () => {
    await render();
    await render({ settingsOpen: true });

    expect(mocks.closeUnsubscribe).not.toHaveBeenCalled();
    await act(async () => {
      mocks.closeListener?.({ requestId: 'close-settings' });
      await vi.waitFor(() => expect(mocks.dock).toHaveBeenCalledTimes(1));
    });

    expect(mocks.ackClose).toHaveBeenCalledWith('close-settings');
    expect(mocks.ackClose.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dock.mock.invocationCallOrder[0],
    );
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });

  it('진행 중 전환이 끝나면 닫기 요청을 다시 도킹한다', async () => {
    await render();
    usePanelHostStore.getState().setTransition('detaching');

    await act(async () => {
      mocks.closeListener?.({ requestId: 'close-busy' });
      await Promise.resolve();
      usePanelHostStore.getState().setTransition('idle');
      await vi.waitFor(() => expect(mocks.dock).toHaveBeenCalledTimes(1));
    });

    expect(mocks.ackClose).toHaveBeenCalledWith('close-busy');
    expect(usePanelHostStore.getState().placement).toBe('docked');
  });

  it('편집 정산이 막히면 fallback을 ack하고 실패 콜백을 호출한다', async () => {
    mocks.flushResult = false;
    const onFailure = vi.fn();
    await render({ onFailure });

    await act(async () => {
      mocks.closeListener?.({ requestId: 'close-blocked' });
      await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    });

    expect(mocks.dock).not.toHaveBeenCalled();
    expect(mocks.ackClose).toHaveBeenCalledWith('close-blocked');
    expect(usePanelHostStore.getState().placement).toBe('detached');
  });

  it('창 감추기가 실패하면 ack하고 실패 콜백을 호출한다', async () => {
    mocks.dock.mockRejectedValueOnce(new Error('hide failed'));
    const onFailure = vi.fn();
    await render({ onFailure });

    await act(async () => {
      mocks.closeListener?.({ requestId: 'close-failed' });
      await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    });

    expect(mocks.ackClose).toHaveBeenCalledWith('close-failed');
    expect(usePanelHostStore.getState().placement).toBe('detached');
  });
});
