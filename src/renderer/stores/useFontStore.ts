import { create } from "zustand";
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

// 모든 활성화된 폰트 CSS를 로드하는 함수
export function loadAllFontCSS(): void {
  const { getAllFonts } = useFontStore.getState();
  const fonts = getAllFonts();

  fonts.forEach((font) => {
    if (font.enabled && font.cssContent) {
      injectFontCSS(font.id, font.cssContent);
    }
  });
}
