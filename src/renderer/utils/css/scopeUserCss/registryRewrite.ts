import {
  findBlockStart,
  isWhitespace,
  splitSelectorList,
} from './selectorScope';

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

export const KEYFRAMES_AT_RULE = /^@(?:-webkit-)?keyframes\b/i;
export const FONT_FACE_AT_RULE = /^@font-face\b/i;
export const FONT_FEATURE_VALUES_AT_RULE = /^@font-feature-values\b/i;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 시트 안에서 정의한 keyframes 이름 → 접두사 이름 (그룹·중첩 내부 포함).
// 단순 식별자가 아니거나 키워드면 매핑하지 않는다 → 정의는 버려진다
export const collectKeyframeRenames = (
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

export const collectGlobalRegistryRenames = (
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

export const createRegistryVariableState = (): RegistryVariableState => ({
  references: new Set(),
  customValues: new Map(),
});

export const collectRegistryVariableState = (
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

export const resolveRegistryVariableReferences = (
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
export const renameKeyframesRule = (
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

export const renameFontFaceRule = (
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

export const renameFontFeatureValuesRule = (
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

export interface ScopeContext {
  scope: string;
  renames: Map<string, string>;
  fontRenames: Map<string, string>;
  fontVariables: Set<string>;
  hoisted: string[];
  namespacesHoisted: boolean;
}

// 선언부 재작성 - animation 이름, font-family 목록·var() fallback, font 참조 변수.
// 스타일 규칙 본문과 중첩 규칙 뒤의 선언 묶음이 같은 경로를 쓴다
export const rewriteDeclarations = (
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
