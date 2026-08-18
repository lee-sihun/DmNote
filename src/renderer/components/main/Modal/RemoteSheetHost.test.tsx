import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  request: null as null | ((request: unknown) => void),
  visibility: null as null | ((payload: { visible: boolean }) => void),
  accept: vi.fn((_requestId: string) => Promise.resolve()),
  close: vi.fn((_result: unknown) => Promise.resolve()),
  hostReady: vi.fn(() => Promise.resolve()),
  preload: vi.fn(),
  webFontDone: null as null | ((outcome: string) => void),
  counterSaved: null as null | ((payload: unknown) => void),
  counterClose: null as null | (() => void),
  soundSaved: null as null | ((soundPath: string) => void),
  soundClose: null as null | (() => void),
  soundProps: null as null | Record<string, unknown>,
  panelStatus: 'detached',
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@api/modules/remoteSheetApi', () => ({
  remoteSheetApi: {
    onRequest: (listener: (request: unknown) => void) => {
      mocks.request = listener;
      return () => {};
    },
    accept: (requestId: string) => mocks.accept(requestId),
    close: (result: unknown) => mocks.close(result),
    announceHostReady: () => mocks.hostReady(),
  },
}));
vi.mock('@api/modules/selectionSessionApi', () => ({
  panelWindowApi: {
    onVisibility: (listener: (payload: { visible: boolean }) => void) => {
      mocks.visibility = listener;
      return () => {};
    },
  },
}));
vi.mock('@stores/grid/usePanelWindowStore', () => ({
  usePanelWindowStore: (selector: (state: { status: string }) => unknown) =>
    selector({ status: mocks.panelStatus }),
}));
vi.mock('./content/pickers/webFontEditorLoader', () => ({
  preloadWebFontEditor: () => mocks.preload(),
}));
vi.mock('./content/pickers/WebFontEditorSheet', () => ({
  default: ({
    editingId,
    onDone,
  }: {
    editingId: string | null;
    onDone: (outcome: string) => void;
  }) => {
    mocks.webFontDone = onDone;
    return <div data-testid="web-font-sheet" data-editing-id={editingId} />;
  },
}));
vi.mock('./content/editors/CounterAnimationEditorModal', () => ({
  default: ({
    onSaved,
    onClose,
    mode,
  }: {
    onSaved: (payload: unknown) => void;
    onClose: () => void;
    mode: string;
  }) => {
    mocks.counterSaved = onSaved;
    mocks.counterClose = onClose;
    return <div data-testid="counter-sheet" data-mode={mode} />;
  },
}));
vi.mock('./content/managers/SoundTrimModal', () => ({
  default: (props: {
    onSaved: (soundPath: string) => void;
    onClose: () => void;
  }) => {
    mocks.soundSaved = props.onSaved;
    mocks.soundClose = props.onClose;
    mocks.soundProps = props;
    return <div data-testid="sound-sheet" />;
  },
}));

import RemoteSheetHost from './RemoteSheetHost';

describe('RemoteSheetHost', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.accept.mockClear();
    mocks.close.mockClear();
    mocks.hostReady.mockClear();
    mocks.preload.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<RemoteSheetHost />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('마운트하면 호스트 준비를 알리고, 패널이 분리돼 있으면 편집기를 예열한다', () => {
    expect(mocks.hostReady).toHaveBeenCalledTimes(1);
    expect(mocks.preload).toHaveBeenCalledTimes(1);
  });

  it('패널이 붙어 있으면 예열하지 않는다', async () => {
    await act(async () => root.unmount());
    mocks.preload.mockClear();
    mocks.panelStatus = 'attached';
    root = createRoot(host);
    await act(async () => root.render(<RemoteSheetHost />));
    expect(mocks.preload).not.toHaveBeenCalled();
    mocks.panelStatus = 'detached';
  });

  it('웹폰트 요청을 수락하고 시트를 띄운 뒤 결과를 돌려준다', async () => {
    await act(async () =>
      mocks.request?.({ requestId: 'r1', kind: 'webFont', editingId: 'f1' }),
    );
    expect(mocks.accept).toHaveBeenCalledWith('r1');
    const sheet = host.querySelector('[data-testid="web-font-sheet"]');
    expect(sheet?.getAttribute('data-editing-id')).toBe('f1');

    await act(async () => mocks.webFontDone?.('saved'));
    expect(mocks.close).toHaveBeenCalledWith({
      requestId: 'r1',
      status: 'saved',
      kind: 'webFont',
    });
    expect(host.querySelector('[data-testid="web-font-sheet"]')).toBeNull();
  });

  it('모션 편집은 저장 결과를 붙잡았다가 닫힘에서 한 번만 보낸다', async () => {
    await act(async () =>
      mocks.request?.({
        requestId: 'r2',
        kind: 'counterAnimation',
        mode: 'create',
        preset: null,
      }),
    );
    expect(host.querySelector('[data-testid="counter-sheet"]')).not.toBeNull();
    const payload = {
      preset: { id: 'p1' },
      mode: 'create',
      affectedUsageCount: 0,
    };
    await act(async () => {
      mocks.counterSaved?.(payload);
      mocks.counterClose?.();
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledWith({
      requestId: 'r2',
      status: 'saved',
      kind: 'counterAnimation',
      payload,
    });
  });

  it('모션 편집을 저장 없이 닫으면 취소로 보낸다', async () => {
    await act(async () =>
      mocks.request?.({
        requestId: 'r3',
        kind: 'counterAnimation',
        mode: 'edit',
        preset: { id: 'p1' },
      }),
    );
    await act(async () => mocks.counterClose?.());
    expect(mocks.close).toHaveBeenCalledWith({
      requestId: 'r3',
      status: 'cancelled',
    });
  });

  it('사운드 트림은 파일 없이 편집 필드만 넘기고, 저장 뒤 닫힘은 중복 전송하지 않는다', async () => {
    await act(async () =>
      mocks.request?.({
        requestId: 'r4',
        kind: 'soundTrim',
        mode: 'edit',
        previewVolume: 0.5,
        item: {
          soundPath: 'sounds/a.wav',
          trimStartRatio: 0.1,
          trimEndRatio: 0.9,
          displayName: 'A',
        },
      }),
    );
    expect(mocks.soundProps).toMatchObject({
      editingSoundPath: 'sounds/a.wav',
      editingTrimStartRatio: 0.1,
      editingTrimEndRatio: 0.9,
      editingDisplayName: 'A',
      previewVolume: 0.5,
      initialFile: null,
    });
    await act(async () => {
      mocks.soundSaved?.('sounds/a.wav');
      mocks.soundClose?.();
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledWith({
      requestId: 'r4',
      status: 'saved',
      kind: 'soundTrim',
      soundPath: 'sounds/a.wav',
    });
  });

  it('새 요청이 오면 이전 시트를 취소로 정리하고 교체한다', async () => {
    await act(async () =>
      mocks.request?.({ requestId: 'r5', kind: 'webFont', editingId: null }),
    );
    await act(async () =>
      mocks.request?.({ requestId: 'r6', kind: 'soundTrim', mode: 'create' }),
    );
    expect(mocks.close).toHaveBeenCalledWith({
      requestId: 'r5',
      status: 'cancelled',
    });
    expect(host.querySelector('[data-testid="sound-sheet"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="web-font-sheet"]')).toBeNull();
  });

  it('패널 창이 사라지면 시트를 내린다', async () => {
    await act(async () =>
      mocks.request?.({ requestId: 'r7', kind: 'webFont', editingId: null }),
    );
    await act(async () => mocks.visibility?.({ visible: false }));
    expect(host.querySelector('[data-testid="web-font-sheet"]')).toBeNull();
  });
});
