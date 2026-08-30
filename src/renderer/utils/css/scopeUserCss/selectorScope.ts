const LEADING_STATEMENT = /^@(charset|import|namespace|layer)\b/i;

export const isWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';

// 시트 머리의 @charset/@import/@namespace 문(과 그 앞에 올 수 있는 @layer
// 순서문)만 원문 그대로 추출 - 접두사 래핑 후에도 유효 위치를 지키려면
// 최상단 hoisting이 필요하다. 블록 규칙이 나오면 중단 (그 뒤의 @import는
// 브라우저도 무시하므로 파서에 맡겨 자연 드롭)
export const splitLeadingStatements = (
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
export const findBlockStart = (text: string): number => {
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
export const splitSelectorList = (selectorText: string): string[] => {
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
export const scopeSelectorText = (
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
export const scopeNestedSelectorText = (
  selectorText: string,
  scope: string,
): string =>
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
