import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openRemoteSheet: vi.fn(() => Promise.resolve({ status: 'cancelled' })),
  selectMenuItem: null as null | ((id: string) => void),
  sheetProps: null as null | { editingId: string | null },
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
vi.mock('@stores/grid/useRemoteSheetStore', () => ({
  openRemoteSheet: mocks.openRemoteSheet,
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
vi.mock('./WebFontEditorSheet', () => ({
  default: (props: { editingId: string | null }) => {
    mocks.sheetProps = props;
    return <div data-testid="web-font-sheet" />;
  },
}));

import FontPicker from './FontPicker';

describe('FontPicker 웹폰트 시트 열기', () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalWindowType = window.__dmn_window_type;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.openRemoteSheet.mockClear();
    mocks.sheetProps = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    window.__dmn_window_type = originalWindowType;
  });

  const openWebFontFromAddMenu = async () => {
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
    const addButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="add-font"]',
    )!;
    await act(async () => addButton.click());
    await act(async () => mocks.selectMenuItem?.('web'));
  };

  it('도킹 창에서는 자기 창에 시트를 띄운다', async () => {
    window.__dmn_window_type = 'main';
    await openWebFontFromAddMenu();

    expect(
      document.querySelector('[data-testid="web-font-sheet"]'),
    ).not.toBeNull();
    expect(mocks.sheetProps).toEqual({
      editingId: null,
      onDone: expect.any(Function),
    });
    expect(mocks.openRemoteSheet).not.toHaveBeenCalled();
  });

  it('분리 패널 창에서는 메인 창에 시트를 요청하고 로컬에는 띄우지 않는다', async () => {
    window.__dmn_window_type = 'panel';
    await openWebFontFromAddMenu();

    expect(mocks.openRemoteSheet).toHaveBeenCalledWith({
      kind: 'webFont',
      editingId: null,
    });
    expect(document.querySelector('[data-testid="web-font-sheet"]')).toBeNull();
  });
});
