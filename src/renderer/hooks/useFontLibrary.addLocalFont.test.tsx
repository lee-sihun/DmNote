// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFontStore } from '@stores/useFontStore';
import { useFontLibrary } from './useFontLibrary';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  fontLoad: vi.fn(),
  canLoadFont: vi.fn(),
  settingsUpdate: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('@api/modules/resourceApi', () => ({
  fontApi: { load: (...args: unknown[]) => mocks.fontLoad(...args) },
}));

vi.mock('@utils/core/assetProbe', () => ({
  canLoadFont: (...args: unknown[]) => mocks.canLoadFont(...args),
}));

vi.mock('@api/modules/settingsApi', () => ({
  settingsApi: {
    update: (...args: unknown[]) => mocks.settingsUpdate(...args),
  },
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@stores/useFontStore', async () => {
  const actual = await vi.importActual<typeof import('@stores/useFontStore')>(
    '@stores/useFontStore',
  );
  return { ...actual, syncFontCSS: vi.fn() };
});

const localFonts = () =>
  useFontStore.getState().customFonts.filter((font) => font.type === 'local');

describe('useFontLibrary 로컬 폰트 추가', () => {
  let container: HTMLDivElement;
  let root: Root;
  let addLocalFont: () => Promise<void>;

  const mount = () => {
    const Probe = (): null => {
      const library = useFontLibrary();
      // 렌더 중 외부 변수 재할당은 금지 - 커밋 이후에 꺼낸다
      useEffect(() => {
        addLocalFont = library.addLocalFont;
      });
      return null;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Probe />));
  };

  beforeEach(() => {
    mocks.fontLoad.mockReset();
    mocks.canLoadFont.mockReset().mockResolvedValue(true);
    mocks.settingsUpdate.mockReset().mockResolvedValue(undefined);
    mocks.alert.mockReset().mockResolvedValue(undefined);
    (window as unknown as { api: unknown }).api = {
      ui: { dialog: { alert: mocks.alert } },
    };
    useFontStore.setState({ customFonts: [] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('로드에 성공한 폰트만 목록에 넣는다', async () => {
    mocks.fontLoad.mockResolvedValue({
      success: true,
      fontName: 'Good Font',
      fontPath: '/tmp/good.woff2',
    });

    await act(async () => {
      await addLocalFont();
    });

    expect(localFonts()).toHaveLength(1);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('브라우저가 로드하지 못한 폰트는 넣지 않고 알린다', async () => {
    mocks.fontLoad.mockResolvedValue({
      success: true,
      fontName: 'Broken Font',
      fontPath: '/tmp/broken.woff2',
    });
    mocks.canLoadFont.mockResolvedValue(false);

    await act(async () => {
      await addLocalFont();
    });

    expect(localFonts()).toHaveLength(0);
    expect(mocks.alert).toHaveBeenCalled();
  });

  it('백엔드가 errorCode로 거절하면 알린다', async () => {
    mocks.fontLoad.mockResolvedValue({
      success: false,
      errorCode: 'invalid-font-content',
    });

    await act(async () => {
      await addLocalFont();
    });

    expect(localFonts()).toHaveLength(0);
    expect(mocks.alert).toHaveBeenCalled();
  });

  it('사용자 취소는 조용히 무시한다', async () => {
    mocks.fontLoad.mockResolvedValue({ success: false });

    await act(async () => {
      await addLocalFont();
    });

    expect(localFonts()).toHaveLength(0);
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
