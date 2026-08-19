// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openRemoteSheet: vi.fn<(spec: unknown) => Promise<Record<string, unknown>>>(),
}));

vi.mock('@stores/grid/useRemoteSheetStore', () => ({
  openRemoteSheet: (spec: unknown) => mocks.openRemoteSheet(spec),
}));

import { useRemoteSheetOpener } from './useRemoteSheetOpener';

const Harness = ({ onSaved }: { onSaved: (path: string) => void }) => {
  const sheet = useRemoteSheetOpener('soundTrim', (result) => {
    onSaved(result.soundPath);
  });
  return (
    <button
      data-panel={sheet.isPanel}
      onClick={() =>
        void sheet.open({ kind: 'soundTrim', mode: 'create', previewVolume: 1 })
      }
    >
      open
    </button>
  );
};

describe('useRemoteSheetOpener', () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalWindowType = window.__dmn_window_type;

  const render = (onSaved: (path: string) => void) => {
    act(() => root.render(<Harness onSaved={onSaved} />));
    return host.querySelector('button')!;
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.openRemoteSheet.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.__dmn_window_type = originalWindowType;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('창 종류를 그대로 알려준다', () => {
    window.__dmn_window_type = 'panel';
    expect(render(vi.fn()).dataset.panel).toBe('true');

    window.__dmn_window_type = 'main';
    expect(render(vi.fn()).dataset.panel).toBe('false');
  });

  it('저장 결과는 돌아온 시점의 최신 핸들러로 넘긴다', async () => {
    let resolveSheet: (result: Record<string, unknown>) => void = () => {};
    mocks.openRemoteSheet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSheet = resolve;
        }),
    );
    const stale = vi.fn();
    const latest = vi.fn();
    const button = render(stale);

    act(() => button.click());
    expect(mocks.openRemoteSheet).toHaveBeenCalledWith({
      kind: 'soundTrim',
      mode: 'create',
      previewVolume: 1,
    });

    render(latest);
    await act(async () => {
      resolveSheet({
        requestId: 'r1',
        status: 'saved',
        kind: 'soundTrim',
        soundPath: 'sounds/new.wav',
      });
    });
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith('sounds/new.wav');
  });

  it('취소와 다른 종류의 결과는 버린다', async () => {
    const onSaved = vi.fn();
    const button = render(onSaved);

    mocks.openRemoteSheet.mockResolvedValue({
      requestId: 'r2',
      status: 'cancelled',
    });
    await act(async () => button.click());

    mocks.openRemoteSheet.mockResolvedValue({
      requestId: 'r3',
      status: 'saved',
      kind: 'webFont',
    });
    await act(async () => button.click());

    expect(onSaved).not.toHaveBeenCalled();
  });
});
