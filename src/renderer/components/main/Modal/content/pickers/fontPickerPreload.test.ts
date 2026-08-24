// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_FONTS, type CustomFont } from '@src/types/settings/fonts';
import { useFontStore } from '@stores/useFontStore';
import {
  getFontPickerPreviewFamily,
  preloadFontPickerFonts,
  syncFontPickerPreviewCSS,
} from './fontPickerPreload';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const enabledLocalFont: CustomFont = {
  id: 'enabled-local',
  type: 'local',
  name: 'Enabled Local',
  displayName: 'Enabled specimen',
  enabled: true,
  localPath: '/fonts/enabled.woff2',
};

const disabledWebFont: CustomFont = {
  id: 'disabled-web',
  type: 'web',
  name: 'Disabled Web',
  displayName: '비활성 미리보기',
  enabled: false,
  cssContent: `@font-face {
    font-family: 'Disabled Web';
    src: url('https://example.com/disabled.woff2') format('woff2');
  }`,
};

describe('fontPickerPreload', () => {
  let originalFontsDescriptor: PropertyDescriptor | undefined;
  let load: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFontsDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'fonts',
    );
    load = vi.fn().mockResolvedValue([{}]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    });
    useFontStore.setState({
      builtinFonts: [],
      customFonts: [enabledLocalFont, disabledWebFont],
    });
  });

  afterEach(() => {
    document
      .querySelectorAll("style[id^='font-'], style[id^='fontpreview-']")
      .forEach((style) => style.remove());
    useFontStore.setState({ builtinFonts: BUILTIN_FONTS, customFonts: [] });
    if (originalFontsDescriptor) {
      Object.defineProperty(document, 'fonts', originalFontsDescriptor);
    } else {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('비활성 폰트의 격리된 preview face를 미리 주입한다', () => {
    syncFontPickerPreviewCSS([disabledWebFont]);

    const style = document.getElementById('fontpreview-disabled-web');
    expect(style?.textContent).toContain(
      `font-family: '${getFontPickerPreviewFamily(disabledWebFont.name)}'`,
    );
    expect(style?.textContent).not.toContain("font-family: 'Disabled Web'");

    syncFontPickerPreviewCSS([]);
    expect(document.getElementById('fontpreview-disabled-web')).toBeNull();
  });

  it('목록에 표시할 실제 문자열까지 로드한 뒤 완료한다', async () => {
    await preloadFontPickerFonts(document);

    expect(load).toHaveBeenCalledWith(
      '400 16px "Enabled Local"',
      enabledLocalFont.displayName,
    );
    expect(load).toHaveBeenCalledWith(
      `400 16px "${getFontPickerPreviewFamily(disabledWebFont.name)}"`,
      disabledWebFont.displayName,
    );
    expect(document.getElementById('font-enabled-local')).not.toBeNull();
    expect(document.getElementById('fontpreview-disabled-web')).not.toBeNull();
  });
});
