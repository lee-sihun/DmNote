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

export type WebFontCssValidationStatus =
  | "idle"
  | "ready"
  | "invalidCss"
  | "missingFontFace"
  | "missingFontFamily"
  | "missingSrc"
  | "multipleFamilies";

export interface WebFontCssValidationResult {
  status: WebFontCssValidationStatus;
  detectedFontFamily: string | null;
  familyNames: string[];
}

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

import { getDefaultFontSettings } from "@src/renderer/defaults";

/** @deprecated Use getDefaultFontSettings() from @src/renderer/defaults */
export const DEFAULT_FONT_SETTINGS: FontSettings = getDefaultFontSettings();

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function normalizeFontFamilyName(value: string): string {
  return value.trim().replace(/^['"]+|['"]+$/g, "").trim().toLowerCase();
}

const FONT_FAMILY_DECLARATION_REGEX = /font-family\s*:\s*([^;]+?)(?:;|$)/i;
const SRC_DECLARATION_REGEX = /src\s*:\s*([^;]+?)(?:;|$)/i;
const CSS_BLOCK_COMMENT_REGEX = /\/\*[\s\S]*?\*\//g;

interface CssLexState {
  inSingleQuote: boolean;
  inDoubleQuote: boolean;
  inComment: boolean;
}

function createCssLexState(): CssLexState {
  return {
    inSingleQuote: false,
    inDoubleQuote: false,
    inComment: false,
  };
}

function consumeCssLiteral(css: string, cursor: number, state: CssLexState): number | null {
  const char = css[cursor];
  const next = css[cursor + 1];

  if (state.inComment) {
    if (char === "*" && next === "/") {
      state.inComment = false;
      return cursor + 2;
    }
    return cursor + 1;
  }

  if (state.inSingleQuote) {
    if (char === "\\") {
      return Math.min(css.length, cursor + 2);
    }
    if (char === "'") {
      state.inSingleQuote = false;
    }
    return cursor + 1;
  }

  if (state.inDoubleQuote) {
    if (char === "\\") {
      return Math.min(css.length, cursor + 2);
    }
    if (char === "\"") {
      state.inDoubleQuote = false;
    }
    return cursor + 1;
  }

  if (char === "/" && next === "*") {
    state.inComment = true;
    return cursor + 2;
  }

  if (char === "'") {
    state.inSingleQuote = true;
    return cursor + 1;
  }

  if (char === "\"") {
    state.inDoubleQuote = true;
    return cursor + 1;
  }

  return null;
}

function matchesTokenIgnoreCase(source: string, cursor: number, token: string): boolean {
  if (cursor + token.length > source.length) {
    return false;
  }

  for (let index = 0; index < token.length; index += 1) {
    const sourceCode = source.charCodeAt(cursor + index);
    const normalizedSourceCode =
      sourceCode >= 65 && sourceCode <= 90 ? sourceCode + 32 : sourceCode;
    if (normalizedSourceCode !== token.charCodeAt(index)) {
      return false;
    }
  }

  return true;
}

function isCssStructurallyBalanced(css: string): boolean {
  let braceDepth = 0;
  const state = createCssLexState();

  for (let cursor = 0; cursor < css.length;) {
    const nextCursor = consumeCssLiteral(css, cursor, state);
    if (nextCursor !== null) {
      cursor = nextCursor;
      continue;
    }

    const char = css[cursor];
    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth -= 1;
      if (braceDepth < 0) {
        return false;
      }
    }

    cursor += 1;
  }

  return (
    !state.inSingleQuote &&
    !state.inDoubleQuote &&
    !state.inComment &&
    braceDepth === 0
  );
}

function extractFontFaceBodies(css: string): { bodies: string[]; malformed: boolean } {
  const bodies: string[] = [];
  const token = "@font-face";
  let cursor = 0;
  const state = createCssLexState();

  while (cursor < css.length) {
    const nextCursor = consumeCssLiteral(css, cursor, state);
    if (nextCursor !== null) {
      cursor = nextCursor;
      continue;
    }

    if (!matchesTokenIgnoreCase(css, cursor, token)) {
      cursor += 1;
      continue;
    }

    let blockStart = cursor + token.length;
    while (blockStart < css.length && /\s/.test(css[blockStart])) {
      blockStart += 1;
    }

    if (css[blockStart] !== "{") {
      return { bodies, malformed: true };
    }

    const bodyStart = blockStart + 1;
    let bodyCursor = bodyStart;
    let depth = 1;
    const bodyState = createCssLexState();

    while (bodyCursor < css.length) {
      const nextBodyCursor = consumeCssLiteral(css, bodyCursor, bodyState);
      if (nextBodyCursor !== null) {
        bodyCursor = nextBodyCursor;
        continue;
      }

      const bodyChar = css[bodyCursor];
      if (bodyChar === "{") {
        depth += 1;
        bodyCursor += 1;
        continue;
      }

      if (bodyChar === "}") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }

      bodyCursor += 1;
    }

    if (
      depth !== 0 ||
      bodyState.inSingleQuote ||
      bodyState.inDoubleQuote ||
      bodyState.inComment
    ) {
      return { bodies, malformed: true };
    }

    bodies.push(css.slice(bodyStart, bodyCursor));
    cursor = bodyCursor + 1;
  }

  return { bodies, malformed: false };
}

// 폰트 설정 정규화 함수
export function normalizeFontSettings(raw: unknown): FontSettings {
  const defaults = getDefaultFontSettings();
  const parsed = fontSettingsSchema.safeParse({
    ...defaults,
    ...(typeof raw === "object" && raw !== null ? raw : {}),
  });
  return parsed.success ? parsed.data : defaults;
}

function createValidationResult(
  status: WebFontCssValidationStatus,
  options?: {
    detectedFontFamily?: string | null;
    familyNames?: string[];
  },
): WebFontCssValidationResult {
  return {
    status,
    detectedFontFamily: options?.detectedFontFamily ?? null,
    familyNames: options?.familyNames ?? [],
  };
}

export function validateWebFontFaceCss(css: string): WebFontCssValidationResult {
  const trimmed = css.trim();
  if (!trimmed) {
    return createValidationResult("idle");
  }

  if (!isCssStructurallyBalanced(trimmed)) {
    return createValidationResult("invalidCss");
  }

  const { bodies, malformed } = extractFontFaceBodies(trimmed);
  if (malformed) {
    return createValidationResult("invalidCss");
  }

  if (bodies.length === 0) {
    return createValidationResult("missingFontFace");
  }

  const familyMap = new Map<string, string>();

  for (const body of bodies) {
    const bodyWithoutComments = body.replace(CSS_BLOCK_COMMENT_REGEX, " ");
    const familyMatch = bodyWithoutComments.match(FONT_FAMILY_DECLARATION_REGEX);
    if (!familyMatch) {
      return createValidationResult("missingFontFamily");
    }

    const rawFamily = familyMatch[1].split(",")[0] || "";
    const familyName = stripOuterQuotes(rawFamily).trim();
    const normalizedFamilyName = normalizeFontFamilyName(familyName);
    if (!normalizedFamilyName) {
      return createValidationResult("missingFontFamily");
    }

    const srcMatch = bodyWithoutComments.match(SRC_DECLARATION_REGEX);
    if (!srcMatch || !/url\s*\(/i.test(srcMatch[1])) {
      return createValidationResult("missingSrc", {
        familyNames: Array.from(familyMap.values()),
      });
    }

    if (!familyMap.has(normalizedFamilyName)) {
      familyMap.set(normalizedFamilyName, familyName);
    }
  }

  const familyNames = Array.from(familyMap.values());
  if (familyMap.size > 1) {
    return createValidationResult("multipleFamilies", { familyNames });
  }

  return createValidationResult("ready", {
    detectedFontFamily: familyNames[0] || null,
    familyNames,
  });
}

// CSS에서 font-family 이름 추출
export function extractFontFamilyFromCSS(css: string): string | null {
  return validateWebFontFaceCss(css).detectedFontFamily;
}

// 고유 ID 생성
export function generateFontId(): string {
  return `font_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
