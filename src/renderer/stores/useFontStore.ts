import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  BUILTIN_FONTS,
  DEFAULT_FONT_SETTINGS,
  type CustomFont,
  type FontSettings,
  type FontType,
  generateFontId,
  extractFontFamilyFromCSS,
} from "@src/types/fonts";

interface FontState {
  // 내장 폰트 (항상 존재)
  builtinFonts: CustomFont[];
  // 사용자 추가 폰트 (로컬/웹)
  customFonts: CustomFont[];
  // 로딩된 폰트 CSS (DOM에 주입됨)
  loadedFontCSS: Map<string, string>;
  // 선택된 폰트 (키/카운터별로 다를 수 있음)
  selectedKeyFont: string | null;
  selectedCounterFont: string | null;

  // Actions
  setAll: (fonts: CustomFont[]) => void;
  addFont: (font: Omit<CustomFont, "id">) => CustomFont;
  removeFont: (id: string) => void;
  toggleFont: (id: string, enabled: boolean) => void;
  setSelectedKeyFont: (fontName: string | null) => void;
  setSelectedCounterFont: (fontName: string | null) => void;

  // Computed
  getAllFonts: () => CustomFont[];
  getEnabledFonts: () => CustomFont[];
  getFontsByType: (type: FontType | "all") => CustomFont[];
}

export const useFontStore = create<FontState>((set, get) => ({
  builtinFonts: BUILTIN_FONTS,
  customFonts: [],
  loadedFontCSS: new Map(),
  selectedKeyFont: null,
  selectedCounterFont: null,

  setAll: (fonts) => set({ customFonts: fonts }),

  addFont: (fontData) => {
    const newFont: CustomFont = {
      ...fontData,
      id: generateFontId(),
    };
    set((state) => ({
      customFonts: [...state.customFonts, newFont],
    }));
    return newFont;
  },

  removeFont: (id) => {
    set((state) => ({
      customFonts: state.customFonts.filter((f) => f.id !== id),
    }));
  },

  toggleFont: (id, enabled) => {
    set((state) => ({
      // 내장 폰트 토글
      builtinFonts: state.builtinFonts.map((f) =>
        f.id === id ? { ...f, enabled } : f,
      ),
      // 사용자 폰트 토글
      customFonts: state.customFonts.map((f) =>
        f.id === id ? { ...f, enabled } : f,
      ),
    }));
  },

  setSelectedKeyFont: (fontName) => set({ selectedKeyFont: fontName }),
  setSelectedCounterFont: (fontName) => set({ selectedCounterFont: fontName }),

  getAllFonts: () => {
    const state = get();
    return [...state.builtinFonts, ...state.customFonts];
  },

  getEnabledFonts: () => {
    const state = get();
    return [...state.builtinFonts, ...state.customFonts].filter(
      (f) => f.enabled,
    );
  },

  getFontsByType: (type) => {
    const state = get();
    const allFonts = [...state.builtinFonts, ...state.customFonts];
    if (type === "all") return allFonts;
    return allFonts.filter((f) => f.type === type);
  },
}));

// 폰트 CSS를 DOM에 주입하는 헬퍼 함수
export function injectFontCSS(fontId: string, css: string): void {
  const existingStyle = document.getElementById(`font-${fontId}`);
  if (existingStyle) {
    existingStyle.textContent = css;
  } else {
    const style = document.createElement("style");
    style.id = `font-${fontId}`;
    style.textContent = css;
    document.head.appendChild(style);
  }
}

// 폰트 CSS를 DOM에서 제거하는 헬퍼 함수
export function removeFontCSS(fontId: string): void {
  const style = document.getElementById(`font-${fontId}`);
  if (style) {
    style.remove();
  }
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getFontFormatFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "otf":
      return "opentype";
    case "woff":
      return "woff";
    case "woff2":
      return "woff2";
    case "ttf":
    default:
      return "truetype";
  }
}

function buildLocalFontFaceCSS(fontFamily: string, localPath: string): string {
  const safeFamily = escapeCssString(fontFamily);
  const url = convertFileSrc(localPath);
  const format = getFontFormatFromPath(localPath);
  return `@font-face {\n  font-family: '${safeFamily}';\n  src: url('${url}') format('${format}');\n  font-weight: normal;\n  font-style: normal;\n  font-display: swap;\n}`;
}

// 활성화된 폰트 CSS를 DOM과 동기화 (추가/제거 모두)
export function syncFontCSS(): void {
  if (typeof document === "undefined") return;
  const { getAllFonts } = useFontStore.getState();
  const fonts = getAllFonts().filter((font) => {
    if (!font.enabled) return false;
    if (font.type === "local") return !!font.localPath;
    return !!font.cssContent;
  });

  const desiredIds = new Set<string>();
  fonts.forEach((font) => {
    const css =
      font.type === "local" && font.localPath
        ? buildLocalFontFaceCSS(font.name, font.localPath)
        : (font.cssContent as string);
    injectFontCSS(font.id, css);
    desiredIds.add(font.id);
  });

  document.querySelectorAll("style[id^='font-']").forEach((el) => {
    const id = el.id.slice("font-".length);
    if (!desiredIds.has(id)) {
      el.remove();
    }
  });

  // Warm up font faces to minimize FOUT when opening the picker or applying fonts.
  void preloadFontFaces(fonts.map((font) => font.name));
}

const loadedFontFamilies = new Set<string>();

async function preloadFontFaces(families: Array<string | undefined | null>) {
  if (typeof document === "undefined") return;
  if (!("fonts" in document)) return;
  const fontSet = (document as Document & { fonts: FontFaceSet }).fonts;
  const pending = families
    .filter((name): name is string => !!name && !loadedFontFamilies.has(name))
    .map((name) =>
      fontSet
        .load(`16px "${name}"`)
        .then(() => {
          loadedFontFamilies.add(name);
        })
        .catch(() => {}),
    );

  if (pending.length) {
    await Promise.all(pending);
  }
}

// 모든 활성화된 폰트 CSS를 로드하는 함수
export function loadAllFontCSS(): void {
  syncFontCSS();
}
