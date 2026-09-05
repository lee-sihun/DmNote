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

vi.mock('@utils/media/assetProbe', () => ({
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
  let submitWebFont: (
    css: string,
    displayName: string,
    editingWebFontId: string | null,
  ) => boolean;

  const mount = () => {
    const Probe = (): null => {
      const library = useFontLibrary();
      // 렌더 중 외부 변수 재할당은 금지 - 커밋 이후에 꺼낸다
      useEffect(() => {
        addLocalFont = library.addLocalFont;
        submitWebFont = library.submitWebFont;
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

  it('사용 중인 웹 폰트의 font-family 이름 변경은 저장하지 않는다', () => {
    useFontStore.setState({
      customFonts: [
        {
          id: 'web-font',
          type: 'web',
          name: 'Stable Family',
          displayName: 'Stable Family',
          enabled: true,
          cssContent:
            "@font-face { font-family: 'Stable Family'; src: url(old.woff2); }",
          weightRanges: [{ min: 400, max: 400 }],
        },
      ],
    });

    const saved = submitWebFont(
      "@font-face { font-family: 'Changed Family'; src: url(new.woff2); }",
      'Changed Family',
      'web-font',
    );

    expect(saved).toBe(false);
    expect(useFontStore.getState().customFonts[0]?.name).toBe('Stable Family');
    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'webFontInput.familyChangeNotAllowed',
      { confirmText: 'common.ok' },
    );
  });

  it('편집 대상이 사라졌으면 저장 성공으로 처리하지 않는다', () => {
    useFontStore.setState({ customFonts: [] });

    const saved = submitWebFont(
      "@font-face { font-family: 'Gone'; src: url(gone.woff2); }",
      'Gone',
      'web-font',
    );

    expect(saved).toBe(false);
    expect(mocks.settingsUpdate).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith('fontPicker.editTargetMissing', {
      confirmText: 'common.ok',
    });
  });

  it('font-family를 유지하면 웹 폰트 CSS를 수정할 수 있다', () => {
    useFontStore.setState({
      customFonts: [
        {
          id: 'web-font',
          type: 'web',
          name: 'Stable Family',
          displayName: 'Stable Family',
          enabled: true,
          cssContent:
            "@font-face { font-family: 'Stable Family'; src: url(old.woff2); }",
          weightRanges: [{ min: 400, max: 400 }],
        },
      ],
    });

    const saved = submitWebFont(
      "@font-face { font-family: 'Stable Family'; src: url(new.woff2); font-weight: 700; }",
      'Stable Family',
      'web-font',
    );

    expect(saved).toBe(true);
    expect(useFontStore.getState().customFonts[0]).toMatchObject({
      id: 'web-font',
      name: 'Stable Family',
      weightRanges: [{ min: 700, max: 700 }],
    });
  });

  it('대소문자만 다른 font-family는 기존 참조 이름을 유지하며 수정한다', () => {
    useFontStore.setState({
      customFonts: [
        {
          id: 'web-font',
          type: 'web',
          name: 'Stable Family',
          displayName: 'Stable Family',
          enabled: true,
          cssContent:
            "@font-face { font-family: 'Stable Family'; src: url(old.woff2); }",
          weightRanges: [{ min: 400, max: 400 }],
        },
      ],
    });

    const saved = submitWebFont(
      "@font-face { font-family: 'stable family'; src: url(new.woff2); }",
      'stable family',
      'web-font',
    );

    expect(saved).toBe(true);
    expect(useFontStore.getState().customFonts[0]).toMatchObject({
      id: 'web-font',
      name: 'Stable Family',
      cssContent:
        "@font-face { font-family: 'stable family'; src: url(new.woff2); }",
    });
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
