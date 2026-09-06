import { convertFileSrc } from '@tauri-apps/api/core';
import { syncFontCSS, useFontStore } from '@stores/useFontStore';
import type { CustomFont } from '@src/types/settings/fonts';
import { buildDraftPreviewCss } from '@src/types/settings/fonts';

const PREVIEW_STYLE_PREFIX = 'fontpreview-';

const escapeCssString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const getFontFormatFromPath = (path: string): string => {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'otf':
      return 'opentype';
    case 'woff':
      return 'woff';
    case 'woff2':
      return 'woff2';
    case 'ttf':
    default:
      return 'truetype';
  }
};

export const getFontPickerPreviewFamily = (fontName: string): string =>
  `${fontName}__preview`;

const buildPreviewCSS = (font: CustomFont): string | null => {
  const previewFontFamily = getFontPickerPreviewFamily(font.name);

  if (font.type === 'local' && font.localPath) {
    const url = convertFileSrc(font.localPath);
    const ranges =
      font.weightRanges && font.weightRanges.length > 0
        ? font.weightRanges
        : [{ min: 400, max: 400 }];
    return ranges
      .map(({ min, max }) => {
        const weight = min === max ? String(min) : `${min} ${max}`;
        return `@font-face {\n  font-family: '${escapeCssString(
          previewFontFamily,
        )}';\n  src: url('${url}') format('${getFontFormatFromPath(
          font.localPath as string,
        )}');\n  font-weight: ${weight};\n  font-style: normal;\n  font-display: swap;\n}`;
      })
      .join('\n');
  }

  if (font.type === 'web' && font.cssContent) {
    // 저장 경로 validator와 같은 추출기로 전역 규칙을 제외한 face만 사용
    return (
      buildDraftPreviewCss(
        font.cssContent,
        escapeCssString(previewFontFamily),
      ) || null
    );
  }

  return null;
};

export const syncFontPickerPreviewCSS = (
  customFonts: CustomFont[],
  targetDocument: Document = document,
): void => {
  const desiredIds = new Set<string>();

  customFonts
    .filter((font) => !font.enabled)
    .forEach((font) => {
      const css = buildPreviewCSS(font);
      if (!css) return;

      const styleId = `${PREVIEW_STYLE_PREFIX}${font.id}`;
      const existing = targetDocument.getElementById(styleId);
      if (existing) {
        if (existing.textContent !== css) existing.textContent = css;
      } else {
        const style = targetDocument.createElement('style');
        style.id = styleId;
        style.textContent = css;
        targetDocument.head.appendChild(style);
      }
      desiredIds.add(font.id);
    });

  targetDocument
    .querySelectorAll<HTMLStyleElement>(`style[id^='${PREVIEW_STYLE_PREFIX}']`)
    .forEach((style) => {
      const id = style.id.slice(PREVIEW_STYLE_PREFIX.length);
      if (!desiredIds.has(id)) style.remove();
    });
};

interface FontLoadTarget {
  family: string;
  text: string;
}

const getFontLoadTargets = (fonts: CustomFont[]): FontLoadTarget[] =>
  fonts.flatMap((font) => {
    if (font.type === 'local' && !font.localPath) return [];
    if (font.type === 'web' && !font.cssContent) return [];

    return [
      {
        family: font.enabled
          ? font.name
          : getFontPickerPreviewFamily(font.name),
        text: font.displayName,
      },
    ];
  });

interface FontPreloadEntry {
  signature: string;
  promise: Promise<void>;
}

const preloadByDocument = new WeakMap<Document, FontPreloadEntry>();

export const preloadFontPickerFonts = (
  targetDocument: Document = document,
): Promise<void> => {
  const { getAllFonts, customFonts } = useFontStore.getState();
  const fonts = getAllFonts();
  const signature = JSON.stringify(fonts);
  const existing = preloadByDocument.get(targetDocument);
  if (existing?.signature === signature) return existing.promise;

  // 활성 폰트 face와 비활성 목록 미리보기 face를 로드 전에 동기화
  syncFontCSS();
  syncFontPickerPreviewCSS(customFonts);

  const promise = (async () => {
    // 분리 패널에는 메인 문서의 동적 style이 MutationObserver로 복제됨
    await Promise.resolve();
    const fontSet = targetDocument.fonts;
    if (!fontSet?.load) return;

    await Promise.all(
      getFontLoadTargets(fonts).map(async ({ family, text }) => {
        try {
          await fontSet.load(`400 16px ${JSON.stringify(family)}`, text);
        } catch {
          // 손상되거나 접근할 수 없는 개별 폰트가 페이지 열기를 막지 않음
        }
      }),
    );
  })();

  const entry = { signature, promise };
  preloadByDocument.set(targetDocument, entry);
  const clearEntry = () => {
    if (preloadByDocument.get(targetDocument) === entry) {
      preloadByDocument.delete(targetDocument);
    }
  };
  void promise.then(clearEntry, clearEntry);
  return promise;
};
