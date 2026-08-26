// 커스텀 CSS를 메인창 미리보기 영역에만 가두는 셀렉터 재작성.
// 최소 지원 WKWebView가 @scope를 모르므로 CSSOM을 걷어 접두사를 붙인다.
// 오버레이 창은 원문 주입을 유지하고 이 유틸을 거치지 않는다

export const USER_CSS_SCOPE_ATTR = 'data-dmn-user-css-scope';
// :where로 감싸 특이도 0 - 접두사가 오버레이와 다른 캐스케이드 결과를 내지 않게
export const USER_CSS_SCOPE_SELECTOR = ':where([data-dmn-user-css-scope])';

// 유저 keyframes 이름 접두사 - 앱 내부 이름과 겹쳐 설정 UI 애니메이션이
// 바뀌는 것을 막는다. 참조(animation, animation-name)도 같이 재작성
const KEYFRAMES_PREFIX = 'dmnu-';
const FONT_FAMILY_PREFIX = 'dmnu-font-';

// keyframes 이름으로 쓰면 shorthand 참조 재작성이 모호해지는 키워드 -
// 이런 정의는 이름을 바꿀 수 없어 전역으로 흘리지 않고 버린다
const ANIMATION_KEYWORDS = new Set([
  'none',
  'initial',
  'inherit',
  'unset',
  'revert',
  'infinite',
  'alternate',
  'alternate-reverse',
  'normal',
  'reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
  'step-start',
  'step-end',
]);

// 이름을 안전하게 바꿔 참조까지 맞출 수 있는 단순 식별자만 지원
const SIMPLE_IDENT = /^-?[A-Za-z_][\w-]*$/;

// font는 앱 UI와 충돌하지 않게 이름을 격리한다. 나머지 전역 leaf at-rule은
// 기존 커스텀 CSS 호환을 위해 원문 통과한다
const PASSTHROUGH_LEAF_AT_RULE =
  /^@(counter-style|font-palette-values|layer)\b/i;
const KEYFRAMES_AT_RULE = /^@(?:-webkit-)?keyframes\b/i;
const FONT_FACE_AT_RULE = /^@font-face\b/i;
const FONT_FEATURE_VALUES_AT_RULE = /^@font-feature-values\b/i;
// 시트 머리에만 유효한 규칙 - 재조립 시 최상단으로 hoisting
const HEAD_AT_RULE = /^@namespace\b/i;
const IMPORT_AT_RULE = /^@import\b/i;
const LEADING_STATEMENT = /^@(charset|import|namespace|layer)\b/i;

const isWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';

// 시트 머리의 @charset/@import/@namespace 문(과 그 앞에 올 수 있는 @layer
// 순서문)만 원문 그대로 추출 - 접두사 래핑 후에도 유효 위치를 지키려면
// 최상단 hoisting이 필요하다. 블록 규칙이 나오면 중단 (그 뒤의 @import는
// 브라우저도 무시하므로 파서에 맡겨 자연 드롭)
const splitLeadingStatements = (
  css: string,
): { hoisted: string[]; body: string } => {
  const hoisted: string[] = [];
  let i = 0;
  const len = css.length;
  while (i < len) {
    if (isWhitespace(css[i])) {
      i += 1;
      continue;
    }
    // 주석 통과 - 주석 속 @import를 되살리지 않게 통째로 건너뜀
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    if (!LEADING_STATEMENT.test(css.slice(i, i + 12))) break;
    // 문자열·괄호·주석을 존중하며 종결 세미콜론까지 스캔. 블록이 먼저 열리면 문이 아니다
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
        // 문 중간의 주석 - 안의 ; { ( 는 구문이 아니다
        const end = css.indexOf('*/', j + 2);
        if (end === -1) break;
        j = end + 2;
        continue;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '(') {
        depth += 1;
      } else if (c === ')') {
        depth = depth > 0 ? depth - 1 : 0;
      } else if (c === '{' && depth === 0) {
        break;
      } else if (c === ';' && depth === 0) {
        terminated = true;
        break;
      }
      j += 1;
    }
    if (!terminated) break;
    hoisted.push(css.slice(i, j + 1));
    i = j + 1;
  }
  return { hoisted, body: css.slice(i) };
};

// 따옴표·이스케이프·괄호 밖의 첫 블록 시작 중괄호 - 셀렉터 문자열 속 `{` 무시
const findBlockStart = (text: string): number => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth = depth > 0 ? depth - 1 : 0;
      continue;
    }
    if (ch === '{' && depth === 0) return i;
  }
  return -1;
};

// 최상위 콤마 분리 - 괄호·대괄호·따옴표·이스케이프 안 콤마는 구분자가 아니다
const splitSelectorList = (selectorText: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < selectorText.length; i += 1) {
    const ch = selectorText[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth = depth > 0 ? depth - 1 : 0;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(selectorText.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selectorText.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
};

// 따옴표·이스케이프 밖에서 조건을 만족하는 첫 위치 (괄호 깊이 조건부)
const findTopLevel = (
  text: string,
  start: number,
  isHit: (index: number) => boolean,
  ignoreBrackets: boolean,
): number => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth = depth > 0 ? depth - 1 : 0;
      continue;
    }
    if ((ignoreBrackets || depth === 0) && isHit(i)) return i;
  }
  return -1;
};

// compound 셀렉터의 끝 - 괄호·대괄호·따옴표 밖 첫 공백 또는 결합자 위치
const scanCompoundEnd = (selector: string, start: number): number => {
  const end = findTopLevel(
    selector,
    start,
    (i) => {
      const ch = selector[i];
      return isWhitespace(ch) || ch === '>' || ch === '+' || ch === '~';
    },
    false,
  );
  return end === -1 ? selector.length : end;
};

// 중첩 셀렉터에서 `&`가 :not()/:is()/:has() 같은 괄호 안에만 있는지 - 그런
// 형태는 대상이 부모 밖으로 확장될 수 있다. 최상위 compound에 `&`가 있으면
// (body.dark &, & .child, &:hover) 대상이 부모 또는 그 주변으로 고정된다
const hasEscapingAmpersand = (selector: string): boolean => {
  const isAmpersand = (i: number) => selector[i] === '&';
  return (
    findTopLevel(selector, 0, isAmpersand, true) !== -1 &&
    findTopLevel(selector, 0, isAmpersand, false) === -1
  );
};

// compound 안 가상 요소 시작 위치 (::x 또는 구형 :before/:after 계열)
const LEGACY_PSEUDO_ELEMENT =
  /^:(before|after|first-line|first-letter)(?![\w-])/i;
const findPseudoElementStart = (compound: string): number =>
  findTopLevel(
    compound,
    0,
    (i) =>
      compound[i] === ':' &&
      (compound[i + 1] === ':' ||
        LEGACY_PSEUDO_ELEMENT.test(compound.slice(i))),
    false,
  );

// 식별자 경계 강제 - body-card 같은 커스텀 요소를 body로 오인하지 않게
// namespace-qualified type selector도 local name이 html/body면 문서 루트다.
// 반대로 body|div는 namespace 접두사일 뿐이므로 루트로 보지 않는다
const ROOT_TOKEN =
  /^(?::root(?![\w-])|(?:(?:[\w-]+|\*)?\|)?(?:html|body)(?![\w-]|\|))/i;

interface FunctionalRootInfo {
  length: number;
  rootBranches: string[];
  allBranchesAreRoots: boolean;
}

// :is(body, html)처럼 문서 루트가 포함된 함수형 compound의 분기 정보
function functionalRootInfo(selector: string): FunctionalRootInfo | null {
  const match = /^:(is|where)\(/i.exec(selector);
  if (!match) return null;
  const open = match[0].length - 1;
  let depth = 1;
  let quote: string | null = null;
  let close = -1;
  for (let i = open + 1; i < selector.length; i += 1) {
    const ch = selector[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;
  const branches = splitSelectorList(selector.slice(open + 1, close));
  if (!branches.length) return null;
  const rootBranches = branches.filter((branch) => {
    const tokenLength = leadingPotentialRootTokenLength(branch);
    return (
      tokenLength !== null &&
      scanCompoundEnd(branch, tokenLength) === branch.length
    );
  });
  if (!rootBranches.length) return null;
  return {
    length: close + 1,
    rootBranches,
    allBranchesAreRoots: rootBranches.length === branches.length,
  };
}

function functionalRootTokenLength(selector: string): number | null {
  const info = functionalRootInfo(selector);
  return info?.allBranchesAreRoots ? info.length : null;
}

function leadingRootTokenLength(selector: string): number | null {
  const token = ROOT_TOKEN.exec(selector);
  return token?.[0].length ?? functionalRootTokenLength(selector);
}

function leadingPotentialRootTokenLength(selector: string): number | null {
  const token = ROOT_TOKEN.exec(selector);
  return token?.[0].length ?? functionalRootInfo(selector)?.length ?? null;
}

type RootRemap =
  | { kind: 'none' }
  | { kind: 'drop' }
  | { kind: 'remap'; selector: string };

// 선행 :root/html/body 체인은 조상 조건으로 그대로 두고 실제 대상만 스코프
// 안으로 옮긴다 (`:root .x` → `:root scope .x`, `body` → `body scope`,
// `body::before` → `body scope::before`). 루트를 지우지 않아 원래 특이도가
// 유지되고, 유저 CSS의 전역 변수·배경 관례는 스코프 요소에 실려 미리보기에
// 상속된다. 루트의 형제 결합자(+, ~)는 스코프 자손으로 표현할 수 없어 드롭
const remapLeadingRootChainWith = (
  selector: string,
  scope: string,
  findRootToken: (selector: string) => number | null,
): RootRemap => {
  let pos = 0;
  let matched = false;
  let chainEnd = 0;
  let lastCompoundStart = 0;
  let combinator = '';
  let afterIndex = selector.length;
  for (;;) {
    const tokenLength = findRootToken(selector.slice(pos));
    if (tokenLength === null) break;
    matched = true;
    lastCompoundStart = pos;
    chainEnd = scanCompoundEnd(selector, pos + tokenLength);
    let j = chainEnd;
    while (j < selector.length && isWhitespace(selector[j])) j += 1;
    let comb = '';
    if (j < selector.length && '>+~'.includes(selector[j])) {
      comb = selector[j];
      j += 1;
      while (j < selector.length && isWhitespace(selector[j])) j += 1;
    }
    if (j >= selector.length) {
      afterIndex = selector.length;
      break;
    }
    if (findRootToken(selector.slice(j)) !== null) {
      // html > body 처럼 루트끼리 이어진 체인은 통째로 조상 조건
      pos = j;
      continue;
    }
    combinator = comb;
    afterIndex = j;
    break;
  }
  if (!matched) return { kind: 'none' };
  if (combinator === '+' || combinator === '~') return { kind: 'drop' };

  // 마지막 루트 compound의 가상 요소는 스코프 요소 쪽으로 옮긴다 -
  // 가상 요소는 자손을 가질 수 없어 그대로 두면 절대 매치되지 않는다
  const lastCompound = selector.slice(lastCompoundStart, chainEnd);
  const pseudoAt = findPseudoElementStart(lastCompound);
  let chain = selector.slice(0, chainEnd).trim();
  let pseudo = '';
  if (pseudoAt !== -1) {
    pseudo = lastCompound.slice(pseudoAt);
    chain = selector.slice(0, lastCompoundStart + pseudoAt).trim();
  }
  const rest = selector.slice(afterIndex).trim();
  if (pseudo && rest) return { kind: 'drop' };
  const trailing = combinator ? ` ${combinator} ` : ' ';
  return {
    kind: 'remap',
    selector: rest
      ? `${chain} ${scope}${trailing}${rest}`
      : `${chain} ${scope}${pseudo}`,
  };
};

const remapLeadingRootChain = (selector: string, scope: string): RootRemap =>
  remapLeadingRootChainWith(selector, scope, leadingRootTokenLength);

const remapMixedFunctionalRoot = (selector: string, scope: string): RootRemap =>
  remapLeadingRootChainWith(selector, scope, leadingPotentialRootTokenLength);

// 최상위 규칙의 스코프된 셀렉터 리스트 - 전부 드롭되면 null (규칙을 버린다)
const scopeSelectorText = (
  selectorText: string,
  scope: string,
): string | null => {
  const scoped: string[] = [];
  for (const selector of splitSelectorList(selectorText)) {
    const remap = remapLeadingRootChain(selector, scope);
    if (remap.kind === 'drop') continue;
    if (remap.kind === 'remap') {
      scoped.push(remap.selector);
      continue;
    }

    scoped.push(`${scope} ${selector}`);
    const functional = functionalRootInfo(selector);
    if (!functional || functional.allBranchesAreRoots) continue;
    // 함수 자체를 조상 조건으로 유지해 :is의 최대 분기 특이도와 :where의
    // 0 특이도를 보존한다. 대상은 scope 뒤에만 있어 메인 UI로 빠지지 않는다
    const rootRemap = remapMixedFunctionalRoot(selector, scope);
    if (rootRemap.kind === 'remap' && !scoped.includes(rootRemap.selector)) {
      scoped.push(rootRemap.selector);
    }
  }
  return scoped.length ? scoped.join(', ') : null;
};

// 부모의 형제로 빠져나가는 중첩 셀렉터 - 선두 `+`/`~`(암묵 &의 형제) 또는
// 최상위 `&` compound 바로 뒤의 `+`/`~`. 부모가 루트 치환으로 스코프 요소
// 자체가 되면 그 형제는 미리보기 밖 앱 UI다
const hasSiblingEscape = (selector: string): boolean => {
  const first = selector[0];
  if (first === '+' || first === '~') return true;
  let from = 0;
  for (;;) {
    const amp = findTopLevel(selector, from, (i) => selector[i] === '&', false);
    if (amp === -1) return false;
    let j = scanCompoundEnd(selector, amp + 1);
    while (j < selector.length && isWhitespace(selector[j])) j += 1;
    if (selector[j] === '+' || selector[j] === '~') return true;
    from = amp + 1;
  }
};

// 중첩 규칙의 셀렉터 - `&`가 없거나 최상위에 있으면 부모(이미 스코프 안)에
// 고정이라 그대로. 괄호 안에만 있거나(:not(&)·:is(x, &)·.x:has(&)) 부모의
// 형제로 나가면 스코프 접두사를 붙여 대상이 스코프 자손임을 강제한다.
// 접두사를 붙일 때 `&`가 없는 상대 셀렉터는 `&`를 명시해 의미를 유지
const scopeNestedSelectorText = (selectorText: string, scope: string): string =>
  splitSelectorList(selectorText)
    .map((selector) => {
      if (!hasEscapingAmpersand(selector) && !hasSiblingEscape(selector)) {
        return selector;
      }
      const hasAmpersand =
        findTopLevel(selector, 0, (i) => selector[i] === '&', true) !== -1;
      return hasAmpersand ? `${scope} ${selector}` : `${scope} & ${selector}`;
    })
    .join(', ');

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 시트 안에서 정의한 keyframes 이름 → 접두사 이름 (그룹·중첩 내부 포함).
// 단순 식별자가 아니거나 키워드면 매핑하지 않는다 → 정의는 버려진다
const collectKeyframeRenames = (
  rules: CSSRuleList,
  out: Map<string, string>,
): void => {
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (KEYFRAMES_AT_RULE.test(rule.cssText)) {
      const name = (rule as CSSKeyframesRule).name;
      if (
        name &&
        SIMPLE_IDENT.test(name) &&
        !ANIMATION_KEYWORDS.has(name.toLowerCase())
      ) {
        out.set(name, `${KEYFRAMES_PREFIX}${name}`);
      }
      continue;
    }
    const childRules = (rule as CSSGroupingRule).cssRules;
    if (childRules) collectKeyframeRenames(childRules, out);
  }
};

const decodeCssEscapes = (value: string): string => {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== '\\') {
      out += value[i];
      continue;
    }
    i += 1;
    if (i >= value.length) break;
    if (value[i] === '\n' || value[i] === '\f') continue;
    if (value[i] === '\r') {
      if (value[i + 1] === '\n') i += 1;
      continue;
    }
    const hex = value.slice(i).match(/^[0-9a-f]{1,6}/i)?.[0];
    if (!hex) {
      out += value[i];
      continue;
    }
    const codePoint = Number.parseInt(hex, 16);
    out +=
      codePoint === 0 || codePoint > 0x10ffff
        ? '\ufffd'
        : String.fromCodePoint(codePoint);
    i += hex.length - 1;
    if (isWhitespace(value[i + 1])) i += 1;
  }
  return out;
};

const normalizeCssName = (value: string): string => {
  const trimmed = value.trim();
  const first = trimmed[0];
  const inner =
    (first === '"' || first === "'") && trimmed.at(-1) === first
      ? trimmed.slice(1, -1)
      : trimmed;
  return decodeCssEscapes(inner).replace(/\s+/g, ' ').trim();
};

// 읽을 수 있는 이름 뒤에 짧은 hash를 붙여 devtools에서 원래 family를 알아보게
const registryAlias = (prefix: string, name: string): string => {
  let hash = 0x811c9dc5;
  for (const character of name) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const readable = name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${prefix}${readable ? `${readable}-` : ''}${hash
    .toString(16)
    .padStart(8, '0')}`;
};

const collectGlobalRegistryRenames = (
  rules: CSSRuleList,
  fonts: Map<string, string>,
): void => {
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    const cssText = rule.cssText;
    const style = (rule as unknown as { style?: CSSStyleDeclaration }).style;
    if (FONT_FACE_AT_RULE.test(cssText) && style) {
      const family = normalizeCssName(style.getPropertyValue('font-family'));
      if (family) {
        fonts.set(
          family.toLowerCase(),
          registryAlias(FONT_FAMILY_PREFIX, family.toLowerCase()),
        );
      }
      continue;
    }
    const childRules = (rule as CSSGroupingRule).cssRules;
    if (childRules) {
      collectGlobalRegistryRenames(childRules, fonts);
    }
  }
};

const rewriteNameList = (
  value: string,
  renames: Map<string, string>,
  caseInsensitive = true,
): string =>
  splitSelectorList(value)
    .map((name) => {
      const normalized = normalizeCssName(name);
      return (
        renames.get(caseInsensitive ? normalized.toLowerCase() : normalized) ??
        name
      );
    })
    .join(', ');

// 이름 토큰 재작성 - 따옴표 문자열은 내용 전체가, 따옴표 없는 family는
// 공백으로 이어진 ident 묶음 전체가 등록된 이름과 일치할 때만 바꾼다.
// 부분 토큰 치환은 "Pixel Art" 같은 별개 family를 망가뜨린다
const FAMILY_IDENT_CHARS = 'A-Za-z0-9_\\u0080-\\uFFFF-';
const FAMILY_RUN_PATTERN = new RegExp(
  `[${FAMILY_IDENT_CHARS}]+(?:\\s+[${FAMILY_IDENT_CHARS}]+)*`,
  'g',
);
const QUOTED_STRING_PATTERN = /"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'/g;

const rewriteNamedTokens = (
  value: string,
  renames: Map<string, string>,
  caseInsensitive = false,
): string => {
  const lookup = (name: string): string | undefined =>
    renames.get(caseInsensitive ? name.toLowerCase() : name);
  const rewriteRun = (run: string): string => {
    const collapsed = run.replace(/\s+/g, ' ');
    const whole = lookup(collapsed);
    if (whole !== undefined) return whole;
    // 정적 변수에 담긴 font 축약형(`700 24px Pixel`) - family는 마지막 size
    // 토큰 뒤에 온다. `/` 뒤 line-height 키워드 normal도 family가 아니다
    const words = collapsed.split(' ');
    let familyStart = 0;
    words.forEach((word, index) => {
      if (/^[0-9.+-]/.test(word)) familyStart = index + 1;
    });
    if (familyStart === 0 && /^normal$/i.test(words[0])) familyStart = 1;
    if (familyStart === 0 || familyStart >= words.length) return run;
    const alias = lookup(words.slice(familyStart).join(' '));
    return alias === undefined
      ? run
      : `${words.slice(0, familyStart).join(' ')} ${alias}`;
  };
  const rewriteUnquoted = (segment: string): string =>
    segment.replace(FAMILY_RUN_PATTERN, rewriteRun);
  const quoted = new RegExp(QUOTED_STRING_PATTERN.source, 'g');
  let out = '';
  let last = 0;
  for (let match = quoted.exec(value); match; match = quoted.exec(value)) {
    out += rewriteUnquoted(value.slice(last, match.index));
    const quote = match[0][0];
    const alias = lookup(match[0].slice(1, -1));
    out += alias ? `${quote}${alias}${quote}` : match[0];
    last = match.index + match[0].length;
  }
  return out + rewriteUnquoted(value.slice(last));
};

const collectVarNames = (value: string, out: Set<string>): void => {
  const pattern = /var\(\s*(--[\w-]+)/gi;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    out.add(match[1]);
  }
};

interface RegistryVariableState {
  references: Set<string>;
  customValues: Map<string, string[]>;
}

const createRegistryVariableState = (): RegistryVariableState => ({
  references: new Set(),
  customValues: new Map(),
});

const collectRegistryVariableState = (
  rules: CSSRuleList,
  state: RegistryVariableState,
): void => {
  const walk = (current: CSSRuleList): void => {
    for (let i = 0; i < current.length; i += 1) {
      const rule = current[i];
      const selectorText = (rule as CSSStyleRule).selectorText;
      const style = (rule as unknown as { style?: CSSStyleDeclaration }).style;
      if (typeof selectorText === 'string' && selectorText && style) {
        collectVarNames(
          `${style.getPropertyValue('font')} ${style.getPropertyValue(
            'font-family',
          )}`,
          state.references,
        );
        for (let index = 0; index < style.length; index += 1) {
          const property = style.item(index);
          if (!property.startsWith('--')) continue;
          const values = state.customValues.get(property) ?? [];
          values.push(style.getPropertyValue(property));
          state.customValues.set(property, values);
        }
      }
      const childRules = (rule as CSSGroupingRule).cssRules;
      if (childRules) walk(childRules);
    }
  };
  walk(rules);
};

const resolveRegistryVariableReferences = (
  state: RegistryVariableState,
): Set<string> => {
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...state.references]) {
      for (const value of state.customValues.get(name) ?? []) {
        const before = state.references.size;
        collectVarNames(value, state.references);
        if (state.references.size !== before) changed = true;
      }
    }
  }
  return state.references;
};

const ANIMATION_PROPERTY =
  /^(\s*(?:-webkit-)?animation(?:-name)?\s*:\s*)([\s\S]*)$/i;

// animation 값 안의 이름 참조를 한 번의 치환으로 - 생성된 이름을 다시 바꾸지
// 않도록 원본 이름 전체를 한 alternation에 담는다 (긴 이름 우선).
// var()로 전달한 이름은 값에 나타나지 않아 재작성 대상이 아니다 (문서화된 한계)
const buildReferencePatterns = (renames: Map<string, string>) => {
  const alternation = [...renames.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return {
    identifier: new RegExp(`(^|[\\s,])(${alternation})(?=$|[\\s,])`, 'g'),
    quoted: new RegExp(`(["'])(${alternation})\\1`, 'g'),
  };
};

// 선언 문자열을 top-level `;` 단위로 걸으며 animation 참조를 재작성.
// 문자열·함수·custom property의 중괄호 블록 안은 건드리지 않는다
// (jsdom이 못 파싱하는 입력을 검증할 수 있게 export)
export const rewriteAnimationReferences = (
  declarations: string,
  renames: Map<string, string>,
): string => {
  if (!renames.size || !declarations) return declarations;
  const { identifier, quoted } = buildReferencePatterns(renames);
  const rewriteSegment = (segment: string): string => {
    const match = ANIMATION_PROPERTY.exec(segment);
    if (!match) return segment;
    const value = match[2]
      .replace(
        quoted,
        (_m, q: string, name: string) => `${q}${renames.get(name)}${q}`,
      )
      .replace(
        identifier,
        (_m, lead: string, name: string) => `${lead}${renames.get(name)}`,
      );
    return `${match[1]}${value}`;
  };
  let out = '';
  let segmentStart = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let quote: string | null = null;
  for (let i = 0; i < declarations.length; i += 1) {
    const ch = declarations[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth = parenDepth > 0 ? parenDepth - 1 : 0;
    else if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth = braceDepth > 0 ? braceDepth - 1 : 0;
    else if (ch === ';' && parenDepth === 0 && braceDepth === 0) {
      out += rewriteSegment(declarations.slice(segmentStart, i)) + ch;
      segmentStart = i + 1;
    }
  }
  return out + rewriteSegment(declarations.slice(segmentStart));
};

// keyframes 정의는 매핑된 이름으로만 내보낸다 - 바꿀 수 없는 이름은 전역
// 레지스트리에 남기지 않고 버린다 (fail-closed)
const renameKeyframesRule = (
  rule: CSSRule,
  renames: Map<string, string>,
): string | null => {
  const cssText = rule.cssText;
  const renamed = renames.get((rule as CSSKeyframesRule).name);
  if (!renamed) return null;
  const brace = findBlockStart(cssText);
  if (brace === -1) return null;
  const prelude = cssText.slice(0, brace).trim();
  const at = prelude.match(/^(@(?:-webkit-)?keyframes)\s+/i);
  if (!at) return null;
  return `${at[1]} ${renamed} ${cssText.slice(brace)}`;
};

const serializeDeclaration = (
  property: string,
  value: string,
  priority: string,
): string => `${property}: ${value}${priority ? ` !${priority}` : ''};`;

const serializeRuleStyle = (
  style: CSSStyleDeclaration,
  overrides: Map<string, string>,
): string => {
  const declarations: string[] = [];
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index);
    declarations.push(
      serializeDeclaration(
        property,
        overrides.get(property) ?? style.getPropertyValue(property),
        style.getPropertyPriority(property),
      ),
    );
  }
  return declarations.join(' ');
};

const FONT_FACE_FAMILY_DESCRIPTOR = /(^|[{;\s])(font-family\s*:\s*)[^;}]*/i;

/**
 * @font-face 원문 텍스트에서 font-family descriptor만 격리 이름으로 바꾼다.
 * CSSOM 열거로 재조립하면 엔진이 열거하지 않는 descriptor(src·font-display·
 * unicode-range)가 빠지므로 텍스트를 유지한다. descriptor를 못 찾으면 null
 */
export const rewriteFontFaceCssText = (
  cssText: string,
  alias: string,
): string | null => {
  const brace = findBlockStart(cssText);
  if (brace === -1) return null;
  const block = cssText.slice(brace);
  const rewritten = block.replace(
    FONT_FACE_FAMILY_DESCRIPTOR,
    (_match, lead: string, property: string) => `${lead}${property}"${alias}"`,
  );
  return rewritten === block ? null : `@font-face ${rewritten}`;
};

const renameFontFaceRule = (
  rule: CSSRule,
  renames: Map<string, string>,
): string | null => {
  const style = (rule as unknown as { style?: CSSStyleDeclaration }).style;
  if (!style) return null;
  const family = normalizeCssName(style.getPropertyValue('font-family'));
  const alias = renames.get(family.toLowerCase());
  if (!alias) return null;
  return (
    rewriteFontFaceCssText(rule.cssText, alias) ??
    `@font-face { ${serializeRuleStyle(
      style,
      new Map([['font-family', `"${alias}"`]]),
    )} }`
  );
};

const renameFontFeatureValuesRule = (
  rule: CSSRule,
  renames: Map<string, string>,
): string | null => {
  const cssText = rule.cssText;
  const brace = findBlockStart(cssText);
  if (brace === -1) return null;
  const prelude = cssText.slice(0, brace).trim();
  const match = prelude.match(/^(@font-feature-values\s+)([\s\S]+)$/i);
  if (!match) return null;
  const families = rewriteNameList(match[2], renames);
  if (families === match[2]) return null;
  return `${match[1]}${families} ${cssText.slice(brace)}`;
};

interface ScopeContext {
  scope: string;
  renames: Map<string, string>;
  fontRenames: Map<string, string>;
  fontVariables: Set<string>;
  hoisted: string[];
  namespacesHoisted: boolean;
}

// 선언부 재작성 - animation 이름, font-family 목록·var() fallback, font 참조 변수.
// 스타일 규칙 본문과 중첩 규칙 뒤의 선언 묶음이 같은 경로를 쓴다
const rewriteDeclarations = (
  style: CSSStyleDeclaration,
  ctx: ScopeContext,
): string => {
  let declarations = rewriteAnimationReferences(style.cssText, ctx.renames);
  const additions: string[] = [];
  const fontFamily = style.getPropertyValue('font-family');
  if (fontFamily) {
    // 목록 항목 단위로 바꾼 뒤 var() fallback 안의 이름도 토큰 단위로 재작성
    const rewritten = rewriteNamedTokens(
      rewriteNameList(fontFamily, ctx.fontRenames),
      ctx.fontRenames,
      true,
    );
    if (rewritten !== fontFamily) {
      additions.push(
        serializeDeclaration(
          'font-family',
          rewritten,
          style.getPropertyPriority('font-family'),
        ),
      );
    }
  }
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index);
    if (!property.startsWith('--')) continue;
    let rewritten = style.getPropertyValue(property);
    if (ctx.fontVariables.has(property)) {
      rewritten = rewriteNamedTokens(rewritten, ctx.fontRenames, true);
    }
    if (rewritten !== style.getPropertyValue(property)) {
      additions.push(
        serializeDeclaration(
          property,
          rewritten,
          style.getPropertyPriority(property),
        ),
      );
    }
  }
  if (additions.length) declarations = `${declarations} ${additions.join(' ')}`;
  return declarations;
};

// 스타일 규칙 재구성 - 선언부는 CSSOM 직렬화, 중첩 규칙은 재귀 스코프.
// 원문 블록을 통째로 보존하면 중첩 `&` 확장이 스코프 밖으로 새므로 재구성한다
const scopeStyleRule = (
  rule: CSSStyleRule,
  selectorText: string,
  ctx: ScopeContext,
): string => {
  const declarations = rewriteDeclarations(rule.style, ctx);
  const childRules = (rule as unknown as CSSGroupingRule).cssRules;
  const nested = childRules ? scopeRuleList(childRules, ctx, true) : '';
  const body = [declarations, nested].filter(Boolean).join('\n');
  return `${selectorText} {\n${body}\n}`;
};

const scopeRuleList = (
  rules: CSSRuleList,
  ctx: ScopeContext,
  nested: boolean,
): string => {
  const out: string[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    const cssText = rule.cssText;
    if (KEYFRAMES_AT_RULE.test(cssText)) {
      const renamed = renameKeyframesRule(rule, ctx.renames);
      if (renamed) out.push(renamed);
      continue;
    }
    if (FONT_FACE_AT_RULE.test(cssText)) {
      const renamed = renameFontFaceRule(rule, ctx.fontRenames);
      if (renamed) out.push(renamed);
      continue;
    }
    if (!nested && FONT_FEATURE_VALUES_AT_RULE.test(cssText)) {
      out.push(renameFontFeatureValuesRule(rule, ctx.fontRenames) ?? cssText);
      continue;
    }
    const childRules = (rule as CSSGroupingRule).cssRules;
    if (!nested && PASSTHROUGH_LEAF_AT_RULE.test(cssText) && !childRules) {
      out.push(cssText);
      continue;
    }
    const selectorText = (rule as CSSStyleRule).selectorText;
    if (typeof selectorText === 'string' && selectorText) {
      const scoped = nested
        ? scopeNestedSelectorText(selectorText, ctx.scope)
        : scopeSelectorText(selectorText, ctx.scope);
      if (scoped === null) continue;
      out.push(scopeStyleRule(rule as CSSStyleRule, scoped, ctx));
      continue;
    }
    // escaped at-keyword도 CSSOM에서는 @import로 정규화된다
    if (!nested && IMPORT_AT_RULE.test(cssText)) continue;
    if (!nested && HEAD_AT_RULE.test(cssText)) {
      // 파서가 유효 위치로 받아들인 @namespace - 최상단으로.
      // 텍스트 단계에서 이미 hoisting했다면 파싱 입력의 사본은 중복 출력하지 않는다
      if (!(ctx.namespacesHoisted && /^@namespace\b/i.test(cssText))) {
        ctx.hoisted.push(cssText);
      }
      continue;
    }
    if (childRules) {
      // 조건 그룹(@media/@supports/@layer/@container) - prelude 보존, 내부 재귀.
      // @layer를 통과시키면 내부 규칙이 비스코프로 새므로 반드시 재귀 대상
      const brace = findBlockStart(cssText);
      if (brace === -1) continue;
      const prelude = cssText.slice(0, brace).trim();
      const inner = scopeRuleList(childRules, ctx, nested);
      if (inner) out.push(`${prelude} {\n${inner}\n}`);
      continue;
    }
    const style = (rule as CSSStyleRule).style;
    if (nested && style) {
      // 중첩 규칙 뒤에 오는 선언 묶음 - 부모 스코프 안이라 선언만 재작성
      out.push(rewriteDeclarations(style, ctx));
      continue;
    }
    // 격리할 수 없는 나머지 문서 전역 leaf at-rule은 버린다
  }
  return out.join('\n');
};

// 파싱 호스트: detached 문서 우선(서브리소스 미로드·옵저버 소음 없음),
// 미지원 환경은 비적용 상태로 본문서 body에 잠깐 붙였다 뗀다
// (head가 아닌 body인 이유: 분리 패널 미러가 head만 관찰한다)
const withParsedRules = <T>(
  cssText: string,
  fn: (rules: CSSRuleList) => T,
): T | null => {
  try {
    const doc = document.implementation.createHTMLDocument('');
    const style = doc.createElement('style');
    style.textContent = cssText;
    doc.head.appendChild(style);
    if (style.sheet) return fn(style.sheet.cssRules);
  } catch {
    // detached 파싱 미지원 - 아래 폴백
  }
  const style = document.createElement('style');
  style.media = 'not all';
  style.textContent = cssText;
  document.body.appendChild(style);
  try {
    return style.sheet ? fn(style.sheet.cssRules) : null;
  } finally {
    style.remove();
  }
};

/**
 * 유저 CSS의 모든 셀렉터를 scopeSelector 하위로 가둔다.
 * 알려진 한계: 인라인되지 않은 @import와 @property는 버리며, 단순 식별자가
 * 아닌 keyframes 이름과 var()로 전달한 animation 이름은 지원하지 않는다
 */
export function scopeUserCss(css: string, scopeSelector: string): string {
  if (!css || !css.trim()) return '';
  try {
    const { hoisted, body } = splitLeadingStatements(css);
    // @import는 이 함수에 오기 전에 resolveUserCssImports가 시트를 받아 인라인한다.
    // 여기까지 남은 @import는 받지 못한 것이라 버린다 (스코프 불가한 외부 규칙이
    // 설정 UI로 새는 것을 막는다). 오버레이와 OBS는 이 변환기를 거치지 않는다
    const safeHoisted = hoisted.filter(
      (statement) => !IMPORT_AT_RULE.test(statement),
    );
    if (!body.trim()) return safeHoisted.join('\n');
    // @namespace는 같은 시트 안에 선언이 있어야 svg|a 같은 접두 셀렉터가
    // 파싱되므로 파싱 입력에도 넣는다 (@import는 폴백 파싱 시 실제 로드를
    // 유발하므로 제외)
    const namespaces = safeHoisted.filter((statement) =>
      /^@namespace\b/i.test(statement),
    );
    const parseInput = namespaces.length
      ? `${namespaces.join('\n')}\n${body}`
      : body;
    // default namespace가 있으면 스코프 compound의 암묵 universal에도 그
    // namespace가 붙어 HTML 스코프 요소를 못 잡는다 - 명시적으로 무관하게.
    // 키워드와 URI 사이의 주석은 걷어내고 첫 토큰이 접두사인지 URI인지 본다
    const hasDefaultNamespace = namespaces.some((statement) =>
      /^@namespace\s+(url\(|["'])/i.test(
        statement.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' '),
      ),
    );
    const ctx: ScopeContext = {
      scope: hasDefaultNamespace ? `*|*${scopeSelector}` : scopeSelector,
      renames: new Map(),
      fontRenames: new Map(),
      fontVariables: new Set(),
      hoisted: [],
      namespacesHoisted: namespaces.length > 0,
    };
    const scoped = withParsedRules(parseInput, (rules) => {
      collectKeyframeRenames(rules, ctx.renames);
      collectGlobalRegistryRenames(rules, ctx.fontRenames);
      const variableState = createRegistryVariableState();
      collectRegistryVariableState(rules, variableState);
      ctx.fontVariables = resolveRegistryVariableReferences(variableState);
      return scopeRuleList(rules, ctx, false);
    });
    if (scoped === null) {
      // 파싱 실패 시 원문을 흘리지 않는다 - 에디터 크롬 보호가 우선
      console.error('[custom-css] failed to parse stylesheet for scoping');
      return safeHoisted.join('\n');
    }
    return [...safeHoisted, ...ctx.hoisted, scoped].filter(Boolean).join('\n');
  } catch (error) {
    console.error('[custom-css] scoping failed', error);
    return '';
  }
}
