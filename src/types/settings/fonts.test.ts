import { describe, it, expect } from 'vitest';
import { buildDraftPreviewCss, validateWebFontFaceCss } from './fonts';

const DRAFT = 'DmnWebFontDraftPreview';

describe('buildDraftPreviewCss — @font-face 블록만 추출·치환', () => {
  it('블록 밖 규칙은 주입 결과에서 제외됨', () => {
    const input = `@font-face { font-family: 'Foo'; src: url('https://x/f.woff2'); }
body { display: none; }
.app { color: red; }`;
    const result = buildDraftPreviewCss(input, DRAFT);

    expect(result).toContain(`font-family: '${DRAFT}';`);
    expect(result).toContain("url('https://x/f.woff2')");
    expect(result).not.toContain('display: none');
    expect(result).not.toContain('.app');
    expect(result).not.toContain('body');
  });

  it('여러 블록 모두 family가 초안 이름으로 치환됨', () => {
    const input = `@font-face { font-family: 'Foo'; src: url(a.woff2); font-weight: 400; }
@font-face { font-family: "Foo"; src: url(b.woff2); font-weight: 700; }`;
    const result = buildDraftPreviewCss(input, DRAFT);

    expect(result).not.toContain('Foo');
    expect(result.match(new RegExp(DRAFT, 'g'))).toHaveLength(2);
    expect(result).toContain('font-weight: 400');
    expect(result).toContain('font-weight: 700');
  });

  it('마지막 선언 세미콜론 생략도 validator와 동일하게 치환됨', () => {
    // validator가 저장을 허용하는 문법은 미리보기 치환도 동일하게 처리해야 함
    const input = `@font-face { src: url(a.woff2); font-family: 'Foo' }`;
    expect(validateWebFontFaceCss(input).status).toBe('ready');

    const result = buildDraftPreviewCss(input, DRAFT);
    expect(result).toContain(`font-family: '${DRAFT}'`);
    expect(result).not.toContain('Foo');
  });

  it('escape된 중괄호로 블록 경계를 속일 수 없음', () => {
    // \{ 는 escaped code point — 브라우저 토크나이저처럼 구분자로 세지 않음
    const balanced = `@font-face { font-family: 'Foo'; src: url(a.woff2); x: \\{ } body { display: none }`;
    const result = buildDraftPreviewCss(balanced, DRAFT);
    expect(result).toContain(DRAFT);
    expect(result).not.toContain('display: none');

    // 브라우저 기준으로 body가 최상위로 새는 입력은 구조 불일치로 거부됨
    const attack = `@font-face { font-family: 'Foo'; src: url(a.woff2); x: \\{ } body { display: none } }`;
    expect(validateWebFontFaceCss(attack).status).toBe('invalidCss');
    expect(buildDraftPreviewCss(attack, DRAFT)).toBe('');
  });

  it('src: local() 문자열 안의 font-family 텍스트는 치환되지 않음', () => {
    const input = `@font-face { font-family: 'Foo'; src: local('font-family: Trap'), url(a.woff2); }`;
    expect(validateWebFontFaceCss(input).status).toBe('ready');
    expect(validateWebFontFaceCss(input).detectedFontFamily).toBe('Foo');

    const result = buildDraftPreviewCss(input, DRAFT);
    expect(result).toContain("local('font-family: Trap')");
    expect(result).toContain(`font-family: '${DRAFT}';`);
  });

  it('--font-family 커스텀 속성은 descriptor로 오인하지 않음', () => {
    const input = `@font-face { --font-family: X; font-family: 'Foo'; src: url(a.woff2); }`;
    const result = buildDraftPreviewCss(input, DRAFT);

    expect(result).toContain('--font-family: X');
    expect(result.match(new RegExp(DRAFT, 'g'))).toHaveLength(1);
  });

  it('조건부 at-rule 안의 @font-face는 최상위로 승격하지 않음', () => {
    // 조건이 거짓이면 적용되지 않아야 할 face가 미리보기에서 로드되는 것을 방지
    const nested = `@media not all { @font-face { font-family: 'Foo'; src: url(a.woff2); } }`;
    expect(validateWebFontFaceCss(nested).status).toBe('missingFontFace');
    expect(buildDraftPreviewCss(nested, DRAFT)).toBe('');

    const mixed = `@font-face { font-family: 'Foo'; src: url(a.woff2); }
@media x { @font-face { font-family: 'Foo'; src: url(b.woff2); } }`;
    const result = buildDraftPreviewCss(mixed, DRAFT);
    expect(result).toContain('a.woff2');
    expect(result).not.toContain('b.woff2');
  });

  it('문자열·주석 안의 중괄호에 속지 않음', () => {
    const input = `/* body { display: none; } */
@font-face { font-family: 'Fo}o'; src: url('a}b.woff2'); }`;
    const result = buildDraftPreviewCss(input, DRAFT);

    expect(result).toContain(`font-family: '${DRAFT}';`);
    expect(result).toContain("url('a}b.woff2')");
    expect(result).not.toContain('display: none');
  });

  it('구조가 깨진 CSS는 빈 문자열 반환 (주입 없음)', () => {
    expect(buildDraftPreviewCss('@font-face { font-family: X;', DRAFT)).toBe(
      '',
    );
    expect(buildDraftPreviewCss('', DRAFT)).toBe('');
  });

  it('@font-face가 없으면 빈 문자열 반환', () => {
    expect(buildDraftPreviewCss('body { color: red; }', DRAFT)).toBe('');
  });
});
