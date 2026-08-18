import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  // true면 편집기 청크가 렌더 시점에 실패한 것으로 친다
  editorBroken: false,
  alert: vi.fn<() => Promise<void>>(),
  selectMenuItem: null as null | ((id: string) => void),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
}));
vi.mock('@stores/useFontStore', () => ({
  useFontStore: () => ({ builtinFonts: [], customFonts: [] }),
}));
vi.mock('@hooks/useFontLibrary', () => ({
  useFontLibrary: () => ({
    submitWebFont: vi.fn(),
    isDuplicateFontFamily: () => false,
  }),
}));
vi.mock('@hooks/usePickerItemMenu', () => ({
  usePickerItemMenu: () => ({
    menuKey: null,
    renderKey: null,
    renderPosition: null,
    open: vi.fn(),
    openFromButton: vi.fn(),
    close: vi.fn(),
  }),
}));
// 추가 버튼만 남긴다. 실제 좌표는 팝업 mock이 쓰지 않는다
vi.mock('./CommonListPickerPage', () => ({
  default: ({
    onAdd,
  }: {
    onAdd: (event: React.MouseEvent<HTMLButtonElement>) => void;
  }) => (
    <button
      type="button"
      data-testid="add-font"
      onClick={() =>
        onAdd({
          currentTarget: {
            getBoundingClientRect: () => ({ right: 0, top: 0 }),
          },
        } as unknown as React.MouseEvent<HTMLButtonElement>)
      }
    >
      add
    </button>
  ),
}));
vi.mock('@components/main/Modal/ListPopup', () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => {
    mocks.selectMenuItem = onSelect;
    return null;
  },
}));
vi.mock('./WebFontInputModal', () => ({
  default: () => {
    if (mocks.editorBroken) {
      throw new TypeError('Importing a module script failed.');
    }
    return <div data-testid="web-font-editor">editor</div>;
  },
}));

import FontPicker from './FontPicker';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const editorNode = () =>
  document.querySelector('[data-testid="web-font-editor"]');

describe('FontPicker 웹폰트 편집기 지연 로드 실패', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.editorBroken = false;
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

  const renderPicker = async () => {
    await act(async () => {
      root.render(
        <FontPicker
          open
          selectedFont={null}
          onFontSelect={() => undefined}
          pageTitle="Fonts"
          onBack={() => undefined}
        />,
      );
    });
  };

  const openWebFontEditor = async () => {
    const addButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="add-font"]',
    );
    expect(addButton).not.toBeNull();
    await act(async () => addButton!.click());
    expect(mocks.selectMenuItem).not.toBeNull();
    await act(async () => mocks.selectMenuItem?.('web'));
    await flush();
  };

  it('편집기를 못 띄우면 피커를 살려 둔 채 안내만 띄운다', async () => {
    mocks.editorBroken = true;
    await renderPicker();

    await openWebFontEditor();

    expect(mocks.alert).toHaveBeenCalledWith('fontPicker.editorLoadFailed', {
      confirmText: 'common.ok',
    });
    expect(editorNode()).toBeNull();
    // 피커 트리는 언마운트되지 않는다
    expect(host.querySelector('[data-testid="add-font"]')).not.toBeNull();
  });

  it('실패 뒤 다시 열면 새로 시도해 편집기를 띄운다', async () => {
    mocks.editorBroken = true;
    await renderPicker();

    await openWebFontEditor();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(editorNode()).toBeNull();

    mocks.editorBroken = false;
    await openWebFontEditor();
    expect(editorNode()).not.toBeNull();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
  });
});
