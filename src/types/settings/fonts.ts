import { z } from 'zod';

// 폰트 타입 스키마
export const fontTypeSchema = z.union([
  z.literal('builtin'),
  z.literal('local'),
  z.literal('web'),
]);

export type FontType = z.infer<typeof fontTypeSchema>;

export const fontWeightRangeSchema = z
  .object({
    min: z.number().int().min(1).max(1000),
    max: z.number().int().min(1).max(1000),
  })
  .refine(({ min, max }) => min <= max);

export type FontWeightRange = z.infer<typeof fontWeightRangeSchema>;

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
  // 실제 폰트 파일/CSS가 제공하는 굵기 범위
  weightRanges: z.array(fontWeightRangeSchema).optional(),
});

export type CustomFont = z.infer<typeof customFontSchema>;

// 폰트 설정 스키마 (저장용)
export const fontSettingsSchema = z.object({
  customFonts: z.array(customFontSchema),
});

export type FontSettings = z.infer<typeof fontSettingsSchema>;

export type WebFontCssValidationStatus =
  | 'idle'
  | 'ready'
  | 'invalidCss'
  | 'missingFontFace'
  | 'missingFontFamily'
  | 'missingSrc'
  | 'multipleFamilies';

export interface WebFontCssValidationResult {
  status: WebFontCssValidationStatus;
  detectedFontFamily: string | null;
  familyNames: string[];
  detectedWeights: FontWeightRange[];
}

// 앱 기본 폰트 (전역 로드 — global.css @font-face)
export const DEFAULT_FONT_FAMILY = 'Pretendard Variable';

// 내장 폰트 목록 (기본 제공)
export const BUILTIN_FONTS: CustomFont[] = [
  {
    id: 'pretendard-variable',
    type: 'builtin',
    name: DEFAULT_FONT_FAMILY,
    displayName: 'Pretendard Variable',
    enabled: true,
    weightRanges: [{ min: 45, max: 920 }],
  },
  {
    id: 'suit',
    type: 'builtin',
    name: 'SUIT-Regular',
    displayName: 'SUIT',
    enabled: true,
    weightRanges: [{ min: 400, max: 400 }],
    cssContent: `@font-face {
  font-family: 'SUIT-Regular';
  src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_suit@1.0/SUIT-Regular.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}`,
  },
  {
    id: 'isyun',
    type: 'builtin',
    name: 'IsYun',
    displayName: '이서윤체',
    enabled: true,
    weightRanges: [{ min: 400, max: 400 }],
    cssContent: `@font-face {
      font-family: 'IsYun';
      src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2202-2@1.0/LeeSeoyun.woff') format('woff');
      font-weight: normal;
      font-display: swap;
    }`,
  },
  {
    id: 'rounded-fixedsys',
    type: 'builtin',
    name: 'RoundedFixedsys',
    displayName: '둥근모꼴',
    enabled: true,
    weightRanges: [{ min: 400, max: 400 }],
    cssContent: `@font-face {
      font-family: 'RoundedFixedsys';
      src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/DungGeunMo.woff') format('woff');
      font-weight: normal;
      font-display: swap;
    }`,
  },
];

import { getDefaultFontSettings } from '@src/renderer/defaults';

/** @deprecated Use getDefaultFontSettings() from @src/renderer/defaults */
export const DEFAULT_FONT_SETTINGS: FontSettings = getDefaultFontSettings();

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function normalizeFontFamilyName(value: string): string {
  return value
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .toLowerCase();
}

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

function consumeCssLiteral(
  css: string,
  cursor: number,
  state: CssLexState,
): number | null {
  const char = css[cursor];
  const next = css[cursor + 1];

  if (state.inComment) {
    if (char === '*' && next === '/') {
      state.inComment = false;
      return cursor + 2;
    }
    return cursor + 1;
  }

  if (state.inSingleQuote) {
    if (char === '\\') {
      return Math.min(css.length, cursor + 2);
    }
    if (char === "'") {
      state.inSingleQuote = false;
    }
    return cursor + 1;
  }

  if (state.inDoubleQuote) {
    if (char === '\\') {
      return Math.min(css.length, cursor + 2);
    }
    if (char === '"') {
      state.inDoubleQuote = false;
    }
    return cursor + 1;
  }

  // 따옴표 밖 escape — \{ 같은 escaped code point를 실제 구분자로 세지 않음
  // (브라우저 토크나이저와 중괄호 계산이 어긋나면 블록 경계 우회가 생김)
  if (char === '\\') {
    return Math.min(css.length, cursor + 2);
  }

  if (char === '/' && next === '*') {
    state.inComment = true;
    return cursor + 2;
  }

  if (char === "'") {
    state.inSingleQuote = true;
    return cursor + 1;
  }

  if (char === '"') {
    state.inDoubleQuote = true;
    return cursor + 1;
  }

  return null;
}

function matchesTokenIgnoreCase(
  source: string,
  cursor: number,
  token: string,
): boolean {
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

  for (let cursor = 0; cursor < css.length; ) {
    const nextCursor = consumeCssLiteral(css, cursor, state);
    if (nextCursor !== null) {
      cursor = nextCursor;
      continue;
    }

    const char = css[cursor];
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
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

function extractFontFaceBodies(css: string): {
  bodies: string[];
  malformed: boolean;
} {
  const bodies: string[] = [];
  const token = '@font-face';
  let cursor = 0;
  let braceDepth = 0;
  const state = createCssLexState();

  while (cursor < css.length) {
    const nextCursor = consumeCssLiteral(css, cursor, state);
    if (nextCursor !== null) {
      cursor = nextCursor;
      continue;
    }

    // 최상위 @font-face만 수집 — @media 등 조건부 안의 face를 승격하면
    // 미리보기와 저장 후 실제 적용 결과가 달라짐
    if (braceDepth > 0 || !matchesTokenIgnoreCase(css, cursor, token)) {
      const skippedChar = css[cursor];
      if (skippedChar === '{') {
        braceDepth += 1;
      } else if (skippedChar === '}') {
        braceDepth -= 1;
      }
      cursor += 1;
      continue;
    }

    let blockStart = cursor + token.length;
    while (blockStart < css.length && /\s/.test(css[blockStart])) {
      blockStart += 1;
    }

    if (css[blockStart] !== '{') {
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
      if (bodyChar === '{') {
        depth += 1;
        bodyCursor += 1;
        continue;
      }

      if (bodyChar === '}') {
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
    ...(typeof raw === 'object' && raw !== null ? raw : {}),
  });
  return parsed.success ? parsed.data : defaults;
}

function parseFontWeightToken(token: string): number | null {
  const lower = token.toLowerCase();
  if (lower === 'normal') return 400;
  if (lower === 'bold') return 700;
  const parsed = Number(lower);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) return null;
  return parsed;
}

// 선언 누락·해석 불가 값은 브라우저 기본과 같은 400 취급
function parseFontWeightValue(value: string | null): FontWeightRange {
  if (!value) return { min: 400, max: 400 };

  const tokens = value.trim().split(/\s+/);
  const first = parseFontWeightToken(tokens[0] ?? '');
  if (first === null) return { min: 400, max: 400 };

  const second = tokens.length > 1 ? parseFontWeightToken(tokens[1]) : null;
  if (second === null) return { min: first, max: first };
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

// 선언 분리 — 문자열·주석·escape를 렉서로 존중하며 세미콜론 단위 분할.
// 문자열 값 안의 'font-family:' 텍스트에 속지 않는 파싱 기준점
function splitTopLevelDeclarations(body: string): string[] {
  const declarations: string[] = [];
  const state = createCssLexState();
  let start = 0;

  for (let cursor = 0; cursor < body.length; ) {
    const nextCursor = consumeCssLiteral(body, cursor, state);
    if (nextCursor !== null) {
      cursor = nextCursor;
      continue;
    }

    if (body[cursor] === ';') {
      declarations.push(body.slice(start, cursor));
      start = cursor + 1;
    }
    cursor += 1;
  }

  declarations.push(body.slice(start));
  return declarations;
}

function declarationProperty(declaration: string): string {
  const cleaned = declaration.replace(CSS_BLOCK_COMMENT_REGEX, ' ');
  const colonIndex = cleaned.indexOf(':');
  if (colonIndex === -1) return '';
  return cleaned.slice(0, colonIndex).trim().toLowerCase();
}

function findDeclarationValue(
  declarations: string[],
  property: string,
): string | null {
  for (const declaration of declarations) {
    if (declarationProperty(declaration) !== property) continue;
    const cleaned = declaration.replace(CSS_BLOCK_COMMENT_REGEX, ' ');
    return cleaned.slice(cleaned.indexOf(':') + 1).trim();
  }
  return null;
}

function createValidationResult(
  status: WebFontCssValidationStatus,
  options?: {
    detectedFontFamily?: string | null;
    familyNames?: string[];
    detectedWeights?: FontWeightRange[];
  },
): WebFontCssValidationResult {
  return {
    status,
    detectedFontFamily: options?.detectedFontFamily ?? null,
    familyNames: options?.familyNames ?? [],
    detectedWeights: options?.detectedWeights ?? [],
  };
}

export function validateWebFontFaceCss(
  css: string,
): WebFontCssValidationResult {
  const trimmed = css.trim();
  if (!trimmed) {
    return createValidationResult('idle');
  }

  if (!isCssStructurallyBalanced(trimmed)) {
    return createValidationResult('invalidCss');
  }

  const { bodies, malformed } = extractFontFaceBodies(trimmed);
  if (malformed) {
    return createValidationResult('invalidCss');
  }

  if (bodies.length === 0) {
    return createValidationResult('missingFontFace');
  }

  const familyMap = new Map<string, string>();
  const weightMap = new Map<string, FontWeightRange>();

  for (const body of bodies) {
    const declarations = splitTopLevelDeclarations(body);

    const familyValue = findDeclarationValue(declarations, 'font-family');
    if (familyValue === null) {
      return createValidationResult('missingFontFamily');
    }

    const rawFamily = familyValue.split(',')[0] || '';
    const familyName = stripOuterQuotes(rawFamily).trim();
    const normalizedFamilyName = normalizeFontFamilyName(familyName);
    if (!normalizedFamilyName) {
      return createValidationResult('missingFontFamily');
    }

    const srcValue = findDeclarationValue(declarations, 'src');
    if (srcValue === null || !/url\s*\(/i.test(srcValue)) {
      return createValidationResult('missingSrc', {
        familyNames: Array.from(familyMap.values()),
      });
    }

    if (!familyMap.has(normalizedFamilyName)) {
      familyMap.set(normalizedFamilyName, familyName);
    }

    const weightRange = parseFontWeightValue(
      findDeclarationValue(declarations, 'font-weight'),
    );
    weightMap.set(`${weightRange.min}:${weightRange.max}`, weightRange);
  }

  const familyNames = Array.from(familyMap.values());
  if (familyMap.size > 1) {
    return createValidationResult('multipleFamilies', { familyNames });
  }

  const detectedWeights = Array.from(weightMap.values()).sort(
    (a, b) => a.min - b.min || a.max - b.max,
  );

  return createValidationResult('ready', {
    detectedFontFamily: familyNames[0] || null,
    familyNames,
    detectedWeights,
  });
}

// CSS에서 font-family 이름 추출
export function extractFontFamilyFromCSS(css: string): string | null {
  return validateWebFontFaceCss(css).detectedFontFamily;
}

// 미리보기 초안 CSS 생성 — 최상위 @font-face 블록만 추출해 family를 초안 이름으로 치환
// 블록 밖 규칙은 버려서 미리보기 주입이 앱 전역 스타일을 오염시키지 못함.
// 문법 허용 범위는 validator와 동일 — 렉서·선언 파서를 공유하고,
// 치환은 선언 단위라 src: local(...) 등 문자열 값 안의 텍스트를 건드리지 않음
export function buildDraftPreviewCss(css: string, draftFamily: string): string {
  const trimmed = css.trim();
  if (!trimmed || !isCssStructurallyBalanced(trimmed)) {
    return '';
  }

  const { bodies, malformed } = extractFontFaceBodies(trimmed);
  if (malformed) {
    return '';
  }

  return bodies
    .map((body) => {
      const replaced = splitTopLevelDeclarations(body)
        .map((declaration) =>
          declarationProperty(declaration) === 'font-family'
            ? ` font-family: '${draftFamily}'`
            : declaration,
        )
        .join(';');
      return `@font-face {${replaced}}`;
    })
    .join('\n');
}

// 고유 ID 생성
export function generateFontId(): string {
  return `font_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
