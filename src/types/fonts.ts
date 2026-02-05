import { z } from "zod";

// 폰트 타입 스키마
export const fontTypeSchema = z.union([
  z.literal("builtin"),
  z.literal("local"),
  z.literal("web"),
]);

export type FontType = z.infer<typeof fontTypeSchema>;

// 커스텀 폰트 스키마
export const customFontSchema = z.object({
  id: z.string(),
  type: fontTypeSchema,
  name: z.string(), // font-family 이름
  displayName: z.string(), // UI에 표시할 이름
  enabled: z.boolean(), // 폰트 선택 모달에 표시 여부
  // 로컬 폰트 전용
  localPath: z.string().optional(),
  // 웹폰트 전용
  cssContent: z.string().optional(),
});

export type CustomFont = z.infer<typeof customFontSchema>;

// 폰트 설정 스키마 (저장용)
export const fontSettingsSchema = z.object({
  customFonts: z.array(customFontSchema),
});

export type FontSettings = z.infer<typeof fontSettingsSchema>;

// 내장 폰트 목록 (기본 제공)
export const BUILTIN_FONTS: CustomFont[] = [
  {
    id: "suit",
    type: "builtin",
    name: "SUIT-Regular",
    displayName: "SUIT",
    enabled: true,
  },
  {
    id: "pretendard",
    type: "builtin",
    name: "Pretendard",
    displayName: "Pretendard",
    enabled: true,
    cssContent: `@font-face {
  font-family: 'Pretendard';
  src: url('https://fastly.jsdelivr.net/gh/Project-Noonnu/noonfonts_2107@1.1/Pretendard-Regular.woff') format('woff');
  font-weight: 400;
  font-style: normal;
}`,
  },
  {
    id: "isyun",
    type: "builtin",
    name: "IsYun",
    displayName: "이서윤체",
    enabled: true,
    cssContent: `@font-face {
      font-family: 'IsYun';
      src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2202-2@1.0/LeeSeoyun.woff') format('woff');
      font-weight: normal;
      font-display: swap;
    }`,
  },
  {
    id: "rounded-fixedsys",
    type: "builtin",
    name: "RoundedFixedsys",
    displayName: "둥근모꼴",
    enabled: true,
    cssContent: `@font-face {
      font-family: 'RoundedFixedsys';
      src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/DungGeunMo.woff') format('woff');
      font-weight: normal;
      font-display: swap;
    }`,
  },
];

// 기본 폰트 설정
export const DEFAULT_FONT_SETTINGS: FontSettings = {
  customFonts: [],
};

// 폰트 설정 정규화 함수
export function normalizeFontSettings(raw: unknown): FontSettings {
  const parsed = fontSettingsSchema.safeParse({
    ...DEFAULT_FONT_SETTINGS,
    ...(typeof raw === "object" && raw !== null ? raw : {}),
  });
  return parsed.success ? parsed.data : DEFAULT_FONT_SETTINGS;
}

// CSS에서 font-family 이름 추출
export function extractFontFamilyFromCSS(css: string): string | null {
  const match = css.match(/font-family:\s*['"]?([^'";]+)['"]?\s*;/i);
  return match ? match[1].trim() : null;
}

// 고유 ID 생성
export function generateFontId(): string {
  return `font_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
