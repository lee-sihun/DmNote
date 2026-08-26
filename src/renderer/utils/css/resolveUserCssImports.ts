// 메인창 커스텀 CSS의 @import를 시트 본문으로 바꿔 넣는다.
// 스코퍼(scopeUserCss)는 @import를 다시 스코프할 수 없어 버리므로, 그 전에
// 시트를 받아 인라인해 그리드 미리보기에 규칙이 그대로 적용되게 한다.
// 오버레이·OBS는 원문을 쓰므로 이 단계를 거치지 않는다

export interface CssImportFetchResult {
  finalUrl: string;
  text: string;
}

export type CssImportFetcher = (url: string) => Promise<CssImportFetchResult>;

export interface ResolveUserCssImportsOptions {
  // 중첩 @import 깊이 상한 (최상위 시트 = 0)
  maxDepth?: number;
  // 한 원문이 유발할 수 있는 총 요청 수
  maxRequests?: number;
  // 받은 시트 본문 누적 상한 (문자 수)
  maxTotalChars?: number;
  // 전체 해석 제한 시간
  deadlineMs?: number;
  // 원문이 바뀌어 낡아진 해석을 중단
  signal?: AbortSignal;
  now?: () => number;
}

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_REQUESTS = 20;
const DEFAULT_MAX_TOTAL_CHARS = 4 * 1024 * 1024;
const DEFAULT_DEADLINE_MS = 15_000;
const LEADING_STATEMENT = /^@(charset|import|namespace|layer)\b/i;
const IMPORT_AT_RULE = /^@import\b/i;
const CHARSET_AT_RULE = /^@charset\b/i;
const NAMESPACE_AT_RULE = /^@namespace\b/i;
const ABSOLUTE_OR_SPECIAL_URL = /^(?:[a-z][a-z0-9+.-]*:|#)/i;

const isWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';

interface LeadingSplit {
  statements: string[];
  body: string;
}

// 시트 머리의 문(@charset/@import/@namespace/@layer 순서문)을 잘라낸다.
// scopeUserCss.splitLeadingStatements와 같은 규칙 - 주석 속 @import는 되살리지 않고
// 문자열·괄호 안의 세미콜론은 종결로 보지 않는다
const splitLeadingStatements = (css: string): LeadingSplit => {
  const statements: string[] = [];
  let i = 0;
  const len = css.length;
  while (i < len) {
    if (isWhitespace(css[i])) {
      i += 1;
      continue;
    }
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    if (!LEADING_STATEMENT.test(css.slice(i, i + 12))) break;
    let j = i;
    let quote: string | null = null;
    let depth = 0;
    let terminated = false;
    while (j < len) {
      const c = css[j];
      if (quote) {
        if (c === '\\') j += 1;
        else if (c === quote) quote = null;
      } else if (c === '/' && css[j + 1] === '*') {
        const end = css.indexOf('*/', j + 2);
        if (end === -1) break;
        j = end + 1;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '(') {
        depth += 1;
      } else if (c === ')') {
        depth = Math.max(0, depth - 1);
      } else if (c === '{') {
        break;
      } else if (c === ';' && depth === 0) {
        terminated = true;
        break;
      }
      j += 1;
    }
    if (!terminated) break;
    statements.push(css.slice(i, j + 1).trim());
    i = j + 1;
  }
  return { statements, body: css.slice(i) };
};

interface ParsedImport {
  href: string;
  layer: string | null; // '' = 익명 레이어
  supports: string | null;
  media: string | null;
}

// @import <url> [layer|layer(name)] [supports(cond)] [media-query-list];
const parseImportStatement = (statement: string): ParsedImport | null => {
  const withoutComments = statement.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const match = withoutComments.match(
    /^@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*?))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);?\s*$/i,
  );
  if (!match) return null;
  const href = (
    match[1] ??
    match[2] ??
    match[3] ??
    match[4] ??
    match[5] ??
    ''
  ).trim();
  if (!href) return null;
  let rest = match[6].trim();
  let layer: string | null = null;
  let supports: string | null = null;
  const layerMatch = rest.match(/^layer(?:\(([^)]*)\))?(?=\s|$)/i);
  if (layerMatch) {
    layer = (layerMatch[1] ?? '').trim();
    rest = rest.slice(layerMatch[0].length).trim();
  }
  if (/^supports\(/i.test(rest)) {
    // supports(...) 뒤에 미디어가 올 수 있어 짝이 맞는 닫는 괄호를 찾는다
    const open = rest.indexOf('(');
    let depth = 0;
    let close = -1;
    for (let k = open; k < rest.length; k += 1) {
      if (rest[k] === '(') depth += 1;
      else if (rest[k] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = k;
          break;
        }
      }
    }
    if (close === -1) return null;
    supports = rest.slice(open + 1, close).trim();
    rest = rest.slice(close + 1).trim();
  }
  const media = rest ? rest : null;
  return { href, layer, supports, media };
};

const isIdentChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\w-]/.test(ch);

const consumeCssEscape = (
  value: string,
  slashIndex: number,
): { decoded: string; next: number } | null => {
  if (value[slashIndex] !== '\\' || slashIndex + 1 >= value.length) return null;
  const first = value[slashIndex + 1];
  if (first === '\n' || first === '\f') {
    return { decoded: '', next: slashIndex + 2 };
  }
  if (first === '\r') {
    return {
      decoded: '',
      next: slashIndex + (value[slashIndex + 2] === '\n' ? 3 : 2),
    };
  }
  if (/[0-9a-f]/i.test(first)) {
    let end = slashIndex + 1;
    while (
      end < value.length &&
      end < slashIndex + 7 &&
      /[0-9a-f]/i.test(value[end])
    ) {
      end += 1;
    }
    const codePoint = Number.parseInt(value.slice(slashIndex + 1, end), 16);
    if (end < value.length && isWhitespace(value[end])) end += 1;
    const decoded =
      codePoint === 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? '\uFFFD'
        : String.fromCodePoint(codePoint);
    return { decoded, next: end };
  }
  return { decoded: first, next: slashIndex + 2 };
};

const decodeCssEscapes = (value: string): string | null => {
  let decoded = '';
  for (let i = 0; i < value.length; ) {
    if (value[i] !== '\\') {
      decoded += value[i];
      i += 1;
      continue;
    }
    const escape = consumeCssEscape(value, i);
    if (!escape) return null;
    decoded += escape.decoded;
    i = escape.next;
  }
  return decoded;
};

const cssString = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?|\n|\f/g, (lineBreak) =>
      [...lineBreak]
        .map((char) => `\\${char.codePointAt(0)!.toString(16)} `)
        .join(''),
    );

// 시트 안의 상대 url()을 시트 위치 기준 절대 경로로. 인라인되면 문서 기준으로
// 해석되어 글꼴·이미지가 깨지기 때문. 주석과 따옴표 문자열 안의 url( 텍스트는
// 토큰이 아니라 건드리지 않는다
export const absolutizeCssUrls = (css: string, baseUrl: string): string => {
  let out = '';
  let i = 0;
  const len = css.length;
  while (i < len) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? len : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < len) {
        if (css[j] === '\\') j += 2;
        else if (css[j] === c) {
          j += 1;
          break;
        } else if (css[j] === '\n') break;
        else j += 1;
      }
      out += css.slice(i, j);
      i = j;
      continue;
    }
    if (
      (c === 'u' || c === 'U') &&
      /^url\(/i.test(css.slice(i, i + 4)) &&
      !isIdentChar(css[i - 1])
    ) {
      // url( 안: 따옴표가 있으면 문자열, 없으면 ) 까지가 값
      let j = i + 4;
      while (j < len && isWhitespace(css[j])) j += 1;
      const quote = css[j] === '"' || css[j] === "'" ? css[j] : null;
      let valueStart = quote ? j + 1 : j;
      let valueEnd = valueStart;
      if (quote) {
        while (valueEnd < len && css[valueEnd] !== quote) {
          if (css[valueEnd] === '\\') {
            const escape = consumeCssEscape(css, valueEnd);
            valueEnd = escape?.next ?? len;
          } else {
            valueEnd += 1;
          }
        }
      } else {
        while (valueEnd < len && css[valueEnd] !== ')') {
          if (css[valueEnd] === '\\') {
            const escape = consumeCssEscape(css, valueEnd);
            valueEnd = escape?.next ?? len;
          } else {
            valueEnd += 1;
          }
        }
      }
      const close = css.indexOf(')', quote ? valueEnd + 1 : valueEnd);
      if (close === -1) {
        out += css.slice(i);
        break;
      }
      const raw = css.slice(valueStart, valueEnd).trim();
      let replaced: string | null = null;
      const decoded = decodeCssEscapes(raw);
      if (decoded && !ABSOLUTE_OR_SPECIAL_URL.test(decoded)) {
        try {
          replaced = `url("${cssString(new URL(decoded, baseUrl).href)}")`;
        } catch {
          replaced = null;
        }
      } else if (decoded && decoded !== raw) {
        replaced = `url("${cssString(decoded)}")`;
      }
      out += replaced ?? css.slice(i, close + 1);
      i = close + 1;
      valueStart = 0;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
};

const wrapImported = (parsed: ParsedImport, inner: string): string => {
  let out = inner;
  if (parsed.media) out = `@media ${parsed.media} {\n${out}\n}`;
  if (parsed.supports) out = `@supports (${parsed.supports}) {\n${out}\n}`;
  if (parsed.layer !== null) {
    out = parsed.layer
      ? `@layer ${parsed.layer} {\n${out}\n}`
      : `@layer {\n${out}\n}`;
  }
  return out;
};

export const hasLeadingImports = (css: string): boolean =>
  splitLeadingStatements(css).statements.some((statement) =>
    IMPORT_AT_RULE.test(statement),
  );

interface Budget {
  maxDepth: number;
  requestsLeft: number;
  charsLeft: number;
  deadline: number;
  now: () => number;
  signal?: AbortSignal;
  // 가져온 시트를 더 받지 않는다 (예산 소진·중단). 이미 받은 것은 반영
  exhausted: boolean;
}

interface ResolvedSheet {
  // @namespace 선언 - 규칙보다 앞에 와야 하므로 최상단으로 모은다
  namespaces: string[];
  rules: string;
}

const namespacePrefix = (statement: string): string => {
  const match = statement
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .match(/^@namespace\s+([^\s"'(]+)?/i);
  return match?.[1] ?? '';
};

const resolveSheet = async (
  css: string,
  baseUrl: string | null,
  fetchImport: CssImportFetcher,
  depth: number,
  visiting: Set<string>,
  budget: Budget,
): Promise<ResolvedSheet> => {
  const { statements, body } = splitLeadingStatements(css);
  // 이 시트의 선언이 가져온 시트의 선언보다 앞선다 (같은 접두사면 부모가 이김)
  const ownNamespaces: string[] = [];
  const importedNamespaces: string[] = [];
  const out: string[] = [];
  for (const statement of statements) {
    if (CHARSET_AT_RULE.test(statement)) continue;
    if (NAMESPACE_AT_RULE.test(statement)) {
      ownNamespaces.push(statement);
      continue;
    }
    if (!IMPORT_AT_RULE.test(statement)) {
      out.push(statement);
      continue;
    }
    const parsed = parseImportStatement(statement);
    if (!parsed) continue;
    let absolute: string;
    try {
      absolute = baseUrl
        ? new URL(parsed.href, baseUrl).href
        : new URL(parsed.href).href;
    } catch {
      console.warn(
        '[custom-css] @import with unresolvable URL dropped',
        parsed.href,
      );
      continue;
    }
    if (depth >= budget.maxDepth || visiting.has(absolute)) {
      console.warn('[custom-css] @import skipped (depth or cycle)', absolute);
      continue;
    }
    if (budget.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (
      budget.exhausted ||
      budget.requestsLeft <= 0 ||
      budget.now() > budget.deadline
    ) {
      budget.exhausted = true;
      console.warn('[custom-css] @import skipped (budget exhausted)', absolute);
      continue;
    }
    budget.requestsLeft -= 1;
    let fetched: CssImportFetchResult;
    try {
      fetched = await fetchImport(absolute);
    } catch (error) {
      console.warn(
        '[custom-css] @import fetch failed, dropped',
        absolute,
        error,
      );
      continue;
    }
    if (budget.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (fetched.text.length > budget.charsLeft) {
      budget.exhausted = true;
      console.warn('[custom-css] @import skipped (size budget)', absolute);
      continue;
    }
    budget.charsLeft -= fetched.text.length;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(absolute);
    const inner = await resolveSheet(
      absolutizeCssUrls(fetched.text, fetched.finalUrl),
      fetched.finalUrl,
      fetchImport,
      depth + 1,
      nextVisiting,
      budget,
    );
    importedNamespaces.push(...inner.namespaces);
    if (inner.rules.trim()) out.push(wrapImported(parsed, inner.rules));
  }
  if (body.trim()) out.push(body);
  return {
    namespaces: [...ownNamespaces, ...importedNamespaces],
    rules: out.join('\n'),
  };
};

/**
 * 최상위 시트의 @import를 재귀적으로 인라인한 CSS를 돌려준다. 받지 못한 시트는
 * 경고만 남기고 건너뛰고, 예산(요청 수·누적 크기·제한 시간)을 넘기면 그 뒤의
 * 시트는 받지 않는다. signal이 중단되면 AbortError로 거부한다.
 * @import가 없으면 입력을 그대로 돌려준다
 */
export const resolveUserCssImports = async (
  css: string,
  fetchImport: CssImportFetcher,
  options: ResolveUserCssImportsOptions = {},
): Promise<string> => {
  if (!hasLeadingImports(css)) return css;
  const now = options.now ?? (() => Date.now());
  const budget: Budget = {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    requestsLeft: options.maxRequests ?? DEFAULT_MAX_REQUESTS,
    charsLeft: options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS,
    deadline: now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS),
    now,
    signal: options.signal,
    exhausted: false,
  };
  const resolved = await resolveSheet(
    css,
    null,
    fetchImport,
    0,
    new Set(),
    budget,
  );
  // 같은 접두사는 먼저 선언한 시트(부모)가 이긴다 - 다른 URI로 다시 선언한
  // 자식 시트의 namespace는 버리고 경고
  const seen = new Set<string>();
  const heads: string[] = [];
  for (const statement of resolved.namespaces) {
    const prefix = namespacePrefix(statement);
    if (seen.has(prefix)) {
      console.warn('[custom-css] conflicting @namespace dropped', statement);
      continue;
    }
    seen.add(prefix);
    heads.push(statement);
  }
  return [...heads, resolved.rules].filter(Boolean).join('\n');
};
