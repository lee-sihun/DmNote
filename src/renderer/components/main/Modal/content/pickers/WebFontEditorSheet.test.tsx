import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  // true면 편집기 청크가 렌더 시점에 실패한 것으로 친다
  editorBroken: false,
  submitWebFont: vi.fn<() => boolean>(),
  alert: vi.fn<() => Promise<void>>(),
  submitFromEditor: null as null | ((css: string, name: string) => void),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@stores/useFontStore', () => ({
  useFontStore: () => ({ builtinFonts: [], customFonts: [] }),
}));
vi.mock('@hooks/useFontLibrary', () => ({
  useFontLibrary: () => ({
    submitWebFont: mocks.submitWebFont,
    isDuplicateFontFamily: () => false,
  }),
}));
vi.mock('./WebFontInputModal', () => ({
  default: ({
    onSubmit,
  }: {
    onSubmit: (css: string, displayName: string) => void;
  }) => {
    if (mocks.editorBroken) {
      throw new TypeError('Importing a module script failed.');
    }
    mocks.submitFromEditor = onSubmit;
    return <div data-testid="web-font-editor">editor</div>;
  },
}));

import WebFontEditorSheet from './WebFontEditorSheet';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const editorNode = () =>
  document.querySelector('[data-testid="web-font-editor"]');

describe('WebFontEditorSheet', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onDone: ReturnType<typeof vi.fn<(outcome: string) => void>>;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onDone = vi.fn<(outcome: string) => void>();
    mocks.editorBroken = false;
    mocks.submitFromEditor = null;
    mocks.submitWebFont.mockReset();
    mocks.alert.mockResolvedValue(undefined);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { dialog: { alert: mocks.alert } } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    mocks.alert.mockReset();
    vi.restoreAllMocks();
  });

  const renderSheet = async () => {
    await act(async () => {
      root.render(<WebFontEditorSheet editingId={null} onDone={onDone} />);
    });
    await flush();
  };

  it('편집기를 못 띄우면 안내하고 failed로 접는다. 창 트리는 산다', async () => {
    mocks.editorBroken = true;
    await renderSheet();

    expect(mocks.alert).toHaveBeenCalledWith('fontPicker.editorLoadFailed', {
      confirmText: 'common.ok',
    });
    expect(onDone).toHaveBeenCalledWith('failed');
    expect(editorNode()).toBeNull();
    expect(host.isConnected).toBe(true);
  });

  it('저장이 성공해야 saved로 닫고, 거절되면 열어 둔다', async () => {
    await renderSheet();
    expect(editorNode()).not.toBeNull();

    mocks.submitWebFont.mockReturnValueOnce(false);
    await act(async () => mocks.submitFromEditor?.('css', 'Dup'));
    expect(onDone).not.toHaveBeenCalled();

    mocks.submitWebFont.mockReturnValueOnce(true);
    await act(async () => mocks.submitFromEditor?.('css', 'Fresh'));
    expect(mocks.submitWebFont).toHaveBeenLastCalledWith('css', 'Fresh', null);
    expect(onDone).toHaveBeenCalledWith('saved');
  });
});
