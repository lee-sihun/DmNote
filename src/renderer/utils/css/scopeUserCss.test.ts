import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  USER_CSS_SCOPE_SELECTOR,
  rewriteAnimationReferences,
  rewriteFontFaceCssText,
  scopeUserCss,
} from './scopeUserCss';

const SCOPE = '[data-dmn-user-css-scope]';

// 공백 차이를 무시하고 비교
const compact = (css: string) => css.replace(/\s+/g, ' ').trim();

// 앱 스타일 + 스코프된 유저 스타일을 문서에 올리고 스코프 안팎 요소를 돌려준다
const mountCascade = (appCss: string, userCss: string, innerHtml: string) => {
  const appStyle = document.createElement('style');
  appStyle.textContent = appCss;
  document.head.appendChild(appStyle);
  const userStyle = document.createElement('style');
  userStyle.textContent = scopeUserCss(userCss, USER_CSS_SCOPE_SELECTOR);
  document.head.appendChild(userStyle);
  document.body.innerHTML = `<div data-dmn-user-css-scope="">${innerHtml}</div><div id="outside">${innerHtml}</div>`;
};

describe('scopeUserCss', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('기본 스코프 셀렉터는 :where로 특이도 0을 유지한다', () => {
    expect(USER_CSS_SCOPE_SELECTOR).toBe(':where([data-dmn-user-css-scope])');
  });

  it('모든 스타일 규칙 셀렉터 앞에 스코프를 붙인다', () => {
    const out = scopeUserCss('.counter { color: red; }', SCOPE);
    expect(compact(out)).toBe(`${SCOPE} .counter { color: red; }`);
  });

  it('콤마 리스트는 항목마다 스코프를 붙인다', () => {
    const out = scopeUserCss(
      '[data-state="active"], .foo .counter { opacity: 1; }',
      SCOPE,
    );
    expect(compact(out)).toBe(
      `${SCOPE} [data-state="active"], ${SCOPE} .foo .counter { opacity: 1; }`,
    );
  });

  it('속성값·괄호·이스케이프 안 콤마는 셀렉터 구분자로 보지 않는다', () => {
    const out = scopeUserCss(
      '[data-text="a,b"]:not(.x, .y) { color: red; }',
      SCOPE,
    );
    expect(compact(out)).toBe(
      `${SCOPE} [data-text="a,b"]:not(.x, .y) { color: red; }`,
    );
    const escaped = scopeUserCss('.foo\\,bar { color: red; }', SCOPE);
    expect(compact(escaped)).toBe(`${SCOPE} .foo\\,bar { color: red; }`);
  });

  it('셀렉터 문자열 속 중괄호를 블록 시작으로 오인하지 않는다', () => {
    const out = scopeUserCss("[data-x='{'] { color: red; }", SCOPE);
    expect(compact(out)).toBe(`${SCOPE} [data-x="{"] { color: red; }`);
  });

  it('선행 :root/html/body는 조상 조건으로 두고 대상만 스코프 안으로 옮긴다', () => {
    expect(compact(scopeUserCss(':root { --k: 1; }', SCOPE))).toBe(
      `:root ${SCOPE} { --k: 1; }`,
    );
    expect(compact(scopeUserCss('body .counter { color: red; }', SCOPE))).toBe(
      `body ${SCOPE} .counter { color: red; }`,
    );
    expect(
      compact(scopeUserCss('html body > .counter { color: red; }', SCOPE)),
    ).toBe(`html body ${SCOPE} > .counter { color: red; }`);
  });

  it('모든 분기가 루트인 :is와 :where도 루트 조건으로 보존한다', () => {
    expect(
      compact(scopeUserCss(':is(body, html) .counter { color: red; }', SCOPE)),
    ).toBe(`:is(body, html) ${SCOPE} .counter { color: red; }`);
    expect(
      compact(
        scopeUserCss(
          ':where(:root, body.dark) > .counter { color: red; }',
          SCOPE,
        ),
      ),
    ).toBe(`:where(:root, body.dark) ${SCOPE} > .counter { color: red; }`);
    expect(
      compact(
        scopeUserCss(
          ':is(:where(body, html), :root) .counter { color: red; }',
          SCOPE,
        ),
      ),
    ).toBe(`:is(:where(body, html), :root) ${SCOPE} .counter { color: red; }`);
  });

  it('혼합 함수형 셀렉터는 루트 분기의 안쪽 적용만 복원하고 나머지는 가둔다', () => {
    const out = scopeUserCss(
      ':is(body, #settings) .counter { color: red; }',
      SCOPE,
    );
    expect(compact(out)).toBe(
      `${SCOPE} :is(body, #settings) .counter, :is(body, #settings) ${SCOPE} .counter { color: red; }`,
    );

    mountCascade(
      '.counter.special { color: blue; }',
      ':is(body, #settings) .counter { color: red; }',
      '<span class="counter special">C</span>',
    );
    const inside = document.querySelector(
      `[data-dmn-user-css-scope] .counter`,
    ) as HTMLElement;
    const outside = document.querySelector('#outside .counter') as HTMLElement;
    expect(getComputedStyle(inside).color).toBe('rgb(255, 0, 0)');
    expect(getComputedStyle(outside).color).not.toBe('rgb(255, 0, 0)');
  });

  it('중첩 혼합 함수와 뒤따르는 루트 체인도 마지막 루트 뒤로 옮긴다', () => {
    expect(
      compact(
        scopeUserCss(
          ':is(:where(body, #settings), #other) .counter { color: red; }',
          SCOPE,
        ),
      ),
    ).toBe(
      `${SCOPE} :is(:where(body, #settings), #other) .counter, :is(:where(body, #settings), #other) ${SCOPE} .counter { color: red; }`,
    );
    expect(
      compact(
        scopeUserCss(
          ':is(html, #settings) body .counter { color: red; }',
          SCOPE,
        ),
      ),
    ).toBe(
      `${SCOPE} :is(html, #settings) body .counter, :is(html, #settings) body ${SCOPE} .counter { color: red; }`,
    );
  });

  it('루트 compound와 속성값 속 결합자는 원문 그대로 보존한다', () => {
    expect(
      compact(scopeUserCss('body.dark .counter { color: red; }', SCOPE)),
    ).toBe(`body.dark ${SCOPE} .counter { color: red; }`);
    expect(
      compact(
        scopeUserCss('body[data-x="a>b"] .counter { color: red; }', SCOPE),
      ),
    ).toBe(`body[data-x="a>b"] ${SCOPE} .counter { color: red; }`);
  });

  it('body-card 같은 커스텀 요소는 루트 토큰으로 오인하지 않는다', () => {
    expect(compact(scopeUserCss('body-card { color: red; }', SCOPE))).toBe(
      `${SCOPE} body-card { color: red; }`,
    );
  });

  it('루트의 형제 결합자는 격리 불가라 해당 셀렉터를 버린다', () => {
    expect(scopeUserCss('body + .settings { color: red; }', SCOPE)).toBe('');
    expect(
      compact(
        scopeUserCss('body ~ .settings, .counter { color: red; }', SCOPE),
      ),
    ).toBe(`${SCOPE} .counter { color: red; }`);
  });

  it('@media·@supports 그룹은 prelude를 보존하고 내부만 스코프한다', () => {
    const out = scopeUserCss(
      '@media screen and (min-width: 100px) { .counter { color: red; } }',
      SCOPE,
    );
    expect(compact(out)).toBe(
      `@media screen and (min-width: 100px) { ${SCOPE} .counter { color: red; } }`,
    );
    const supports = scopeUserCss(
      '@supports (display: grid) { .counter { color: red; } }',
      SCOPE,
    );
    expect(compact(supports)).toBe(
      `@supports (display: grid) { ${SCOPE} .counter { color: red; } }`,
    );
  });

  it('@layer 블록 내부는 스코프하고 @layer 순서문은 보존한다', () => {
    const out = scopeUserCss(
      '@layer base, theme;\n@layer theme { .counter { color: red; } }',
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toContain('@layer base, theme;');
    expect(flat).toContain(
      `@layer theme { ${SCOPE} .counter { color: red; } }`,
    );
  });

  it('@keyframes 이름에 접두사를 붙이고 animation 참조도 함께 바꾼다', () => {
    const out = scopeUserCss(
      [
        '@keyframes pop { from { opacity: 0; } to { opacity: 1; } }',
        '.counter { animation: pop 1s ease infinite; }',
        '.label { animation-name: pop; -webkit-animation-name: pop; }',
        '.quoted { animation-name: "pop"; }',
        '.other { animation: linear 1s; }',
      ].join('\n'),
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toContain('@keyframes dmnu-pop {');
    expect(flat).toContain('from { opacity: 0; }');
    expect(flat).toContain('animation: dmnu-pop 1s ease infinite;');
    expect(flat).toContain('animation-name: dmnu-pop;');
    expect(flat).toContain('-webkit-animation-name: dmnu-pop;');
    expect(flat).toContain('animation-name: "dmnu-pop";');
    // 정의하지 않은 이름과 키워드는 건드리지 않는다
    expect(flat).toContain('animation: linear 1s;');
    expect(flat).not.toContain('@keyframes pop {');
  });

  it('@media 안의 @keyframes도 이름을 바꾼다', () => {
    const out = scopeUserCss(
      '@media (min-width: 1px) { @keyframes pop { to { opacity: 1; } } .counter { animation-name: pop; } }',
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toContain('@keyframes dmnu-pop {');
    expect(flat).toContain('animation-name: dmnu-pop;');
  });

  it('접두사 이름과 겹치는 keyframes도 한 번만 치환한다', () => {
    const out = scopeUserCss(
      [
        '@keyframes chain { to { opacity: 1; } }',
        '@keyframes dmnu-chain { to { opacity: 0; } }',
        '.a { animation-name: chain; }',
        '.b { animation-name: dmnu-chain; }',
      ].join('\n'),
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toContain('@keyframes dmnu-chain {');
    expect(flat).toContain('@keyframes dmnu-dmnu-chain {');
    expect(flat).toContain('.a { animation-name: dmnu-chain; }');
    expect(flat).toContain('.b { animation-name: dmnu-dmnu-chain; }');
  });

  it('문자열·custom property 값과 다른 animation-* 속성은 건드리지 않는다', () => {
    const out = scopeUserCss(
      [
        '@keyframes pop { to { opacity: 1; } }',
        ".x { content: ' animation: pop '; --anim: pop; animation-timing-function: ease; }",
        '.y { animation: var(--anim) 1s; }',
      ].join('\n'),
      SCOPE,
    );
    const flat = compact(out);
    // 직렬화가 따옴표 종류를 바꿀 수 있어 내용만 확인
    expect(flat).toMatch(/content: ["'] animation: pop ["'];/);
    expect(flat).toContain('--anim: pop;');
    expect(flat).toContain('animation-timing-function: ease;');
    // var()로 전달한 이름은 재작성 대상이 아니다 (문서화된 한계)
    expect(flat).toContain('animation: var(--anim) 1s;');
  });

  it('@font-face 이름과 참조를 바꾸고 격리 불가한 기타 at-rule은 버린다', () => {
    const out = scopeUserCss(
      [
        '@font-face { font-family: "Pixel"; src: url("a.woff2"); }',
        "@property --dmn-fade-top { syntax: '<color>'; inherits: false; initial-value: red; }",
        '@page { margin: 0; }',
        '.counter { font: 12px "Pixel"; color: red; }',
      ].join('\n'),
      SCOPE,
    );
    const flat = compact(out);
    // 원래 family를 등록하지 않아 같은 이름을 쓰는 메인 UI가 바뀌지 않게
    expect(flat).toContain('@font-face {');
    const alias = flat.match(/font-family: ["']?(dmnu-font-[\w-]+)/)?.[1];
    expect(alias).toBeTruthy();
    expect(flat).not.toMatch(/@font-face \{[^}]*font-family: ["']Pixel["']/);
    expect(flat).not.toContain('@property');
    expect(flat).not.toContain('@page');
    expect(flat).toContain(`${SCOPE} .counter {`);
    expect(flat).toContain(`font-family: ${alias};`);
  });

  it('font custom property 체인도 격리된 family로 바꾼다', () => {
    const out = scopeUserCss(
      [
        '@font-face { font-family: Pixel; src: url("a.woff2"); }',
        ':root { --face-base: Pixel; --face: var(--face-base); --unrelated: Pixel; }',
        '.counter { font-family: var(--face); }',
      ].join('\n'),
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toMatch(/--face-base: dmnu-font-[\w-]+;/);
    expect(flat).toContain('--face: var(--face-base);');
    expect(flat).toContain('--unrelated: Pixel;');
  });

  it('font-family의 var() fallback 안 이름도 격리된 family로 바꾼다', () => {
    const out = compact(
      scopeUserCss(
        [
          '@font-face { font-family: Pixel; src: url("a.woff2"); }',
          '.counter { font-family: var(--face, Pixel); }',
          '.quoted { font-family: var(--face, "Pixel"), sans-serif; }',
        ].join('\n'),
        SCOPE,
      ),
    );
    const alias = out.match(/font-family: ["']?(dmnu-font-[\w-]+)/)?.[1];

    expect(alias).toBeTruthy();
    expect(out).toContain(`font-family: var(--face, ${alias});`);
    expect(out).toContain(`font-family: var(--face, "${alias}"), sans-serif;`);
  });

  it('인라인한 import의 font 이름과 부모 규칙 참조를 같은 이름으로 바꾼다', () => {
    const scoped = compact(
      scopeUserCss(
        [
          '@font-face { font-family: ImportedPixel; src: url("a.woff2"); }',
          ':root { --imported-face: ImportedPixel; } .direct { font: 12px ImportedPixel; } .variable { font-family: var(--imported-face); }',
        ].join('\n'),
        SCOPE,
      ),
    );
    const alias = scoped.match(/font-family: ["']?(dmnu-font-[\w-]+)/)?.[1];

    expect(alias).toBeTruthy();
    expect(scoped).toContain(`font-family: ${alias};`);
    expect(scoped).toContain(`--imported-face: ${alias};`);
  });

  it('격리할 이름이 없는 font feature와 counter style도 보존한다', () => {
    const out = compact(
      scopeUserCss(
        [
          '@font-feature-values "System Font" { @styleset { fancy: 1; } }',
          '@counter-style custom-counter { system: cyclic; symbols: "x"; }',
        ].join('\n'),
        SCOPE,
      ),
    );

    expect(out).toContain('@font-feature-values');
    expect(out).toContain('@counter-style');
  });

  it('격리한 font family를 참조하는 font feature 이름도 같이 바꾼다', () => {
    const out = compact(
      scopeUserCss(
        [
          '@font-face { font-family: Pixel; src: url("a.woff2"); }',
          '@font-feature-values Pixel { @styleset { fancy: 1; } }',
        ].join('\n'),
        SCOPE,
      ),
    );
    const alias = out.match(/font-family: ["']?(dmnu-font-[\w-]+)/)?.[1];

    expect(alias).toBeTruthy();
    expect(out).toContain(`@font-feature-values ${alias}`);
  });

  it('메인창에서는 @import를 버리고 @namespace만 최상단에 보존한다', () => {
    const out = scopeUserCss(
      '@import url("https://fonts.example/css?family=Pixel");\n@namespace svg url(http://www.w3.org/2000/svg);\n.counter { font-family: Pixel; }\nsvg|a { color: red; }',
      SCOPE,
    );
    expect(
      out.startsWith('@namespace svg url(http://www.w3.org/2000/svg);'),
    ).toBe(true);
    expect(out).not.toContain('@import');
    const flat = compact(out);
    expect(flat).toContain(`${SCOPE} .counter { font-family: Pixel; }`);
    // 파싱 입력에도 namespace를 넣어 접두 셀렉터가 살아남고, 출력엔 한 번만
    expect(flat).toContain(`${SCOPE} svg|a { color: red; }`);
    expect(flat.match(/@namespace/g)?.length).toBe(1);
  });

  it('body나 html 이름의 namespace 접두사를 문서 루트로 오인하지 않는다', () => {
    const out = scopeUserCss(
      '@namespace body url(http://www.w3.org/1999/xhtml);\nbody|div.counter { color: red; }',
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toContain(`${SCOPE} body|div.counter { color: red; }`);
    expect(flat).not.toContain(`body|div.counter ${SCOPE}`);
  });

  it('namespace-qualified html과 body는 문서 루트로 재매핑한다', () => {
    const out = scopeUserCss(
      [
        '@namespace x url(http://www.w3.org/1999/xhtml);',
        'x|body .counter { color: red; }',
        '*|html > body .key { color: blue; }',
        '|body .graph { color: green; }',
      ].join('\n'),
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toContain(`x|body ${SCOPE} .counter { color: red; }`);
    expect(flat).toContain(`*|html > body ${SCOPE} .key { color: blue; }`);
    expect(flat).toContain(`|body ${SCOPE} .graph { color: green; }`);
  });

  it('주석 속 @import는 끌어올리지 않는다', () => {
    const out = scopeUserCss(
      '/* @import url("dead.css"); */\n.counter { color: red; }',
      SCOPE,
    );
    expect(out).not.toContain('@import');
    expect(compact(out)).toBe(`${SCOPE} .counter { color: red; }`);
  });

  it('escape로 작성해 CSSOM이 정규화한 @import도 버린다', () => {
    const out = scopeUserCss(
      String.raw`@\69mport url("data:text/css,button%7Bcolor%3Ared%7D");
.counter { color: blue; }`,
      SCOPE,
    );
    expect(out.toLowerCase()).not.toContain('@import');
    // jsdom은 escaped at-keyword 시트를 통째로 거부할 수 있다. fail-closed도 안전한 결과
  });

  it('중첩 규칙은 외부 셀렉터만 스코프하고 내부는 원문 보존한다', () => {
    const out = scopeUserCss(
      '.counter { color: red; &:hover { color: blue; } }',
      SCOPE,
    );
    const flat = compact(out);
    expect(flat.startsWith(`${SCOPE} .counter {`)).toBe(true);
    expect(flat).toContain('&:hover { color: blue; }');
  });

  it(':where 접두사는 앱의 클래스 규칙보다 우선하지 않는다 (오버레이와 동일 캐스케이드)', () => {
    mountCascade(
      '.safe { padding-left: 1px; }',
      'span { padding-left: 20px; }',
      '<span class="safe">1</span>',
    );
    const inside = document.querySelector(
      '[data-dmn-user-css-scope] span',
    ) as HTMLElement;
    const outside = document.querySelector('#outside span') as HTMLElement;
    expect(getComputedStyle(inside).paddingLeft).toBe('1px');
    expect(getComputedStyle(outside).paddingLeft).toBe('1px');
  });

  it('루트 조건 규칙은 원래 특이도로 앱 규칙과 겨룬다', () => {
    // 같은 특이도(0,1,1)면 뒤에 오는 유저 규칙이 이긴다 - 오버레이와 동일
    mountCascade(
      'body .safe { color: blue; }',
      ':root .safe { color: red; }',
      '<span class="safe">1</span>',
    );
    const inside = document.querySelector(
      '[data-dmn-user-css-scope] span',
    ) as HTMLElement;
    const outside = document.querySelector('#outside span') as HTMLElement;
    expect(getComputedStyle(inside).color).toBe('rgb(255, 0, 0)');
    expect(getComputedStyle(outside).color).toBe('rgb(0, 0, 255)');
  });

  it('함수형 루트 조건은 스코프 안에만 적용한다', () => {
    mountCascade(
      '',
      ':is(body, html) .safe { color: red; }',
      '<span class="safe">1</span>',
    );
    const inside = document.querySelector(
      '[data-dmn-user-css-scope] span',
    ) as HTMLElement;
    const outside = document.querySelector('#outside span') as HTMLElement;
    expect(getComputedStyle(inside).color).toBe('rgb(255, 0, 0)');
    expect(getComputedStyle(outside).color).not.toBe('rgb(255, 0, 0)');
  });

  it('중첩 규칙에서 &가 부모 밖으로 확장되는 셀렉터도 스코프 안에 가둔다', () => {
    const out = scopeUserCss(
      '.safe { color: red; :not(&) { color: blue; } :is(#settings, &) { background: green; } .child { color: pink; } }',
      SCOPE,
    );
    const flat = compact(out);
    expect(flat.startsWith(`${SCOPE} .safe {`)).toBe(true);
    expect(flat).toContain(`${SCOPE} :not(&) { color: blue; }`);
    expect(flat).toContain(`${SCOPE} :is(#settings, &) { background: green; }`);
    // &가 없는 중첩은 부모 자손이라 그대로
    expect(flat).toContain('.child { color: pink; }');
    expect(flat).not.toContain(`${SCOPE} .child`);
  });

  it('최상위 &로 부모에 고정된 중첩 셀렉터는 조상 조건을 보존한다', () => {
    const out = scopeUserCss(
      '.safe { body.dark & { padding-left: 13px; } & .child { color: red; } &:hover { color: blue; } .x:has(&) { color: green; } }',
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toContain('body.dark & { padding-left: 13px; }');
    expect(flat).not.toContain(`${SCOPE} body.dark &`);
    expect(flat).toContain('& .child { color: red; }');
    expect(flat).toContain('&:hover { color: blue; }');
    // &가 괄호 안에만 있으면 조상(설정 UI)까지 대상이 될 수 있어 스코프 접두사
    expect(flat).toContain(`${SCOPE} .x:has(&) { color: green; }`);
  });

  it('부모의 형제로 나가는 중첩 셀렉터는 스코프 자손임을 강제한다', () => {
    const out = scopeUserCss(
      'body { & ~ #settings { color: red; } + #adjacent { color: blue; } .x ~ & { color: green; } & .a ~ .b { color: pink; } }',
      SCOPE,
    );
    const flat = compact(out);
    expect(flat.startsWith(`body ${SCOPE} {`)).toBe(true);
    // 루트 부모의 형제 = 스코프 밖 UI - 접두사로 매치 불가하게
    expect(flat).toContain(`${SCOPE} & ~ #settings { color: red; }`);
    expect(flat).toContain(`${SCOPE} & + #adjacent { color: blue; }`);
    // 대상이 부모 자신이거나 부모 자손이면 그대로
    expect(flat).toContain('.x ~ & { color: green; }');
    expect(flat).not.toContain(`${SCOPE} .x ~ &`);
    expect(flat).toContain('& .a ~ .b { color: pink; }');
    expect(flat).not.toContain(`${SCOPE} & .a`);
  });

  it('default namespace가 있으면 스코프 접두를 namespace 무관으로 만든다', () => {
    const out = scopeUserCss(
      '@namespace url(http://www.w3.org/2000/svg);\na { stroke: red; }',
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).toContain(`*|*${SCOPE} a { stroke: red; }`);
    expect(flat.match(/@namespace/g)?.length).toBe(1);

    // 키워드와 URI 사이 주석이 있어도 default namespace로 판별
    const commented = compact(
      scopeUserCss(
        '@namespace /* svg */ url(http://www.w3.org/2000/svg);\na { stroke: red; }',
        SCOPE,
      ),
    );
    expect(commented).toContain(`*|*${SCOPE} a { stroke: red; }`);

    // 주석 안의 ; { ( 는 문 종결·블록으로 보지 않는다
    for (const comment of ['/* namespace; svg */', '/* { */', '/* ( */']) {
      const tricky = compact(
        scopeUserCss(
          `@namespace ${comment} url(http://www.w3.org/2000/svg);\na { stroke: red; }`,
          SCOPE,
        ),
      );
      expect(tricky).toContain(`*|*${SCOPE} a { stroke: red; }`);
      expect(tricky.match(/@namespace/g)?.length).toBe(1);
    }

    // 접두사가 있는 namespace만 있으면 기존 접두 유지
    const prefixed = compact(
      scopeUserCss(
        '@namespace svg url(http://www.w3.org/2000/svg);\na { stroke: red; }',
        SCOPE,
      ),
    );
    expect(prefixed).toContain(`${SCOPE} a { stroke: red; }`);
    expect(prefixed).not.toContain('*|*');
  });

  it('이름을 바꿀 수 없는 keyframes 정의는 전역에 남기지 않는다', () => {
    const out = scopeUserCss(
      [
        '@keyframes linear { to { opacity: 1; } }',
        '@keyframes "a,b" { to { opacity: 1; } }',
        '.x { animation-name: linear; }',
      ].join('\n'),
      SCOPE,
    );
    const flat = compact(out);
    expect(flat).not.toContain('@keyframes');
    expect(flat).toContain('animation-name: linear;');
  });

  it('루트의 가상 요소는 스코프 요소 쪽으로 옮긴다', () => {
    expect(compact(scopeUserCss('body::before { content: "x"; }', SCOPE))).toBe(
      `body ${SCOPE}::before { content: "x"; }`,
    );
    expect(compact(scopeUserCss(':root:after { content: "x"; }', SCOPE))).toBe(
      `:root ${SCOPE}:after { content: "x"; }`,
    );
  });

  it('대문자 @IMPORT와 @layer 순서문 뒤의 @import도 메인창에서는 버린다', () => {
    const out = scopeUserCss(
      '@layer base;\n@IMPORT url("a.css");\n.x { color: red; }',
      SCOPE,
    );
    expect(out.startsWith('@layer base;')).toBe(true);
    expect(out).not.toContain('@IMPORT');
    expect(compact(out)).toContain(`${SCOPE} .x { color: red; }`);
  });

  it('중괄호를 품은 custom property 값은 animation 선언으로 보지 않는다', () => {
    // jsdom 파서가 이 입력을 받지 못해 선언 재작성 함수를 직접 검증
    const renames = new Map([['pop', 'dmnu-pop']]);
    expect(
      rewriteAnimationReferences(
        '--cfg: { animation: pop; }; animation-name: pop;',
        renames,
      ),
    ).toBe('--cfg: { animation: pop; }; animation-name: dmnu-pop;');
  });

  it('빈 입력은 빈 문자열을 돌려준다', () => {
    expect(scopeUserCss('', SCOPE)).toBe('');
    expect(scopeUserCss('   \n  ', SCOPE)).toBe('');
  });

  it('파싱 중 예외가 나면 원문을 흘리지 않고 빈 문자열로 닫는다', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const append = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(() => {
        throw new Error('boom');
      });
    try {
      expect(scopeUserCss('.counter { color: red; }', SCOPE)).toBe('');
      expect(error).toHaveBeenCalled();
    } finally {
      append.mockRestore();
      error.mockRestore();
    }
  });

  it('파싱용 임시 style 요소를 문서에 남기지 않는다', () => {
    scopeUserCss('.counter { color: red; }', SCOPE);
    expect(document.querySelectorAll('style[media="not all"]').length).toBe(0);
  });
});

describe('scopeUserCss font 이름 격리 경계', () => {
  // jsdom의 CSSOM은 @font-face의 src·font-display를 파싱 단계에서 버리므로
  // 엔진 직렬화 텍스트를 직접 넣어 재작성 경로를 검증한다
  it('@font-face의 다른 descriptor는 이름만 바꾸고 보존한다', () => {
    const out = rewriteFontFaceCssText(
      '@font-face { font-family: Pixel; src: url("a.woff2") format("woff2"); font-display: swap; unicode-range: U+0000-05FF; }',
      'dmnu-font-pixel-1',
    );
    expect(out).toBe(
      '@font-face { font-family: "dmnu-font-pixel-1"; src: url("a.woff2") format("woff2"); font-display: swap; unicode-range: U+0000-05FF; }',
    );
    expect(
      rewriteFontFaceCssText('@font-face { src: url("a.woff2"); }', 'x'),
    ).toBeNull();
    // 실제 파싱 경로도 같은 텍스트 재작성을 거친다
    const scoped = compact(
      scopeUserCss(
        '@font-face { font-family: Pixel; src: url("a.woff2"); }',
        SCOPE,
      ),
    );
    expect(scoped).toMatch(/@font-face \{ font-family: "dmnu-font-[\w-]+";/);
  });

  it('등록된 family를 부분 토큰으로 포함하는 다른 이름은 바꾸지 않는다', () => {
    const out = compact(
      scopeUserCss(
        [
          '@font-face { font-family: Pixel; src: url("a.woff2"); }',
          ':root { --g: "Pixel Art"; --h: Pixel Art, Pixel; }',
          '.a { font-family: "Pixel Art", Pixel, sans-serif; }',
          '.b { font-family: var(--face, Pixel Art); }',
          '.c { font-family: var(--g); }',
          '.d { font-family: var(--h); }',
        ].join('\n'),
        SCOPE,
      ),
    );
    const alias = out.match(/font-family: ["']?(dmnu-font-[\w-]+)/)?.[1];
    expect(alias).toBeTruthy();
    expect(out).toContain(`font-family: "Pixel Art", ${alias}, sans-serif;`);
    expect(out).toContain('font-family: var(--face, Pixel Art);');
    expect(out).toContain('--g: "Pixel Art";');
    expect(out).toContain(`--h: Pixel Art, ${alias};`);
  });

  it('정적 변수에 담긴 font 축약형의 family도 격리된 이름으로 바꾼다', () => {
    const out = compact(
      scopeUserCss(
        [
          '@font-face { font-family: Pixel; src: url("a.woff2"); }',
          ':root { --f: 700 24px Pixel; --g: italic 12px/1.2 Pixel, serif; --h: 12px/normal Pixel; --i: 12px Pixel Art; }',
          '.a { font: var(--f); } .b { font: var(--g); } .c { font: var(--h); } .d { font: var(--i); }',
        ].join('\n'),
        SCOPE,
      ),
    );
    const alias = out.match(/font-family: ["']?(dmnu-font-[\w-]+)/)?.[1];
    expect(alias).toBeTruthy();
    expect(out).toContain(`--f: 700 24px ${alias};`);
    expect(out).toContain(`--g: italic 12px/1.2 ${alias}, serif;`);
    expect(out).toContain(`--h: 12px/normal ${alias};`);
    expect(out).toContain('--i: 12px Pixel Art;');
  });
});
