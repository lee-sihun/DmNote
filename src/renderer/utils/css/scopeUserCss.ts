// 커스텀 CSS를 메인창 미리보기 영역에만 가두는 셀렉터 재작성.
// 최소 지원 WKWebView가 @scope를 모르므로 CSSOM을 걷어 접두사를 붙인다.
// 오버레이 창은 원문 주입을 유지하고 이 유틸을 거치지 않는다

export const USER_CSS_SCOPE_ATTR = 'data-dmn-user-css-scope';
// :where로 감싸 특이도 0 - 접두사가 오버레이와 다른 캐스케이드 결과를 내지 않게
export const USER_CSS_SCOPE_SELECTOR = ':where([data-dmn-user-css-scope])';

import {
  findBlockStart,
  scopeNestedSelectorText,
  scopeSelectorText,
  splitLeadingStatements,
} from './scopeUserCss/selectorScope';
import {
  collectGlobalRegistryRenames,
  collectKeyframeRenames,
  collectRegistryVariableState,
  createRegistryVariableState,
  FONT_FACE_AT_RULE,
  FONT_FEATURE_VALUES_AT_RULE,
  KEYFRAMES_AT_RULE,
  renameFontFaceRule,
  renameFontFeatureValuesRule,
  renameKeyframesRule,
  resolveRegistryVariableReferences,
  rewriteDeclarations,
} from './scopeUserCss/registryRewrite';
import type { ScopeContext } from './scopeUserCss/registryRewrite';

export {
  rewriteAnimationReferences,
  rewriteFontFaceCssText,
} from './scopeUserCss/registryRewrite';

// font는 앱 UI와 충돌하지 않게 이름을 격리한다. 나머지 전역 leaf at-rule은
// 기존 커스텀 CSS 호환을 위해 원문 통과한다
const PASSTHROUGH_LEAF_AT_RULE =
  /^@(counter-style|font-palette-values|layer)\b/i;
// 시트 머리에만 유효한 규칙 - 재조립 시 최상단으로 hoisting
const HEAD_AT_RULE = /^@namespace\b/i;
const IMPORT_AT_RULE = /^@import\b/i;

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
