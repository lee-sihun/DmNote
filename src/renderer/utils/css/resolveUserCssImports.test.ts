import { describe, expect, it, vi } from 'vitest';
import {
  absolutizeCssUrls,
  hasLeadingImports,
  resolveUserCssImports,
} from './resolveUserCssImports';

const sheets: Record<string, string> = {
  'https://fonts.example/css?family=Pixel':
    '@font-face { font-family: Pixel; src: url(./pixel.woff2); }',
  'https://cdn.example/base.css':
    '@import url("./nested.css");\n.counter { color: red; }',
  'https://cdn.example/nested.css': '.key { color: blue; }',
  'https://cdn.example/a.css': '@import url("b.css");\n.a { top: 0; }',
  'https://cdn.example/b.css': '@import url("a.css");\n.b { top: 1px; }',
};

const fetcher = vi.fn(async (url: string) => {
  const text = sheets[url];
  if (text === undefined) throw new Error(`404 ${url}`);
  return { finalUrl: url, text };
});

describe('resolveUserCssImports', () => {
  it('@import가 없으면 입력을 그대로 돌려준다', async () => {
    const css = '.counter { color: red; }';
    expect(hasLeadingImports(css)).toBe(false);
    await expect(resolveUserCssImports(css, fetcher)).resolves.toBe(css);
  });

  it('시트를 받아 인라인하고 상대 url()을 시트 기준 절대 경로로 바꾼다', async () => {
    const out = await resolveUserCssImports(
      '@import url("https://fonts.example/css?family=Pixel");\n.counter { font-family: Pixel; }',
      fetcher,
    );
    expect(out).not.toContain('@import');
    expect(out).toContain('url("https://fonts.example/pixel.woff2")');
    expect(out).toContain('.counter { font-family: Pixel; }');
  });

  it('중첩 @import를 재귀로 인라인하고 순환은 끊는다', async () => {
    const out = await resolveUserCssImports(
      '@import "https://cdn.example/base.css";',
      fetcher,
    );
    expect(out).toContain('.key { color: blue; }');
    expect(out).toContain('.counter { color: red; }');
    expect(out).not.toContain('@import');

    const cyclic = await resolveUserCssImports(
      '@import url(https://cdn.example/a.css);',
      fetcher,
    );
    expect(cyclic).toContain('.a { top: 0; }');
    expect(cyclic).toContain('.b { top: 1px; }');
    expect(cyclic).not.toContain('@import');
  });

  it('media·supports·layer 조건은 블록으로 감싼다', async () => {
    const out = await resolveUserCssImports(
      '@import url("https://cdn.example/nested.css") layer(theme) supports(display: grid) screen and (min-width: 10px);',
      fetcher,
    );
    expect(out).toMatch(
      /@layer theme \{\s*@supports \(display: grid\) \{\s*@media screen and \(min-width: 10px\) \{\s*\.key \{ color: blue; \}/,
    );
  });

  it('받지 못한 시트와 상대 최상위 URL은 버리고 나머지는 유지한다', async () => {
    const out = await resolveUserCssImports(
      '@import url("https://cdn.example/missing.css");\n@import url("./local.css");\n@namespace svg url(http://www.w3.org/2000/svg);\n.counter { color: red; }',
      fetcher,
    );
    expect(out).not.toContain('@import');
    expect(out).toContain('@namespace svg');
    expect(out).toContain('.counter { color: red; }');
  });

  it('주석 속 @import는 가져오지 않는다', async () => {
    fetcher.mockClear();
    const css =
      '/* @import url("https://cdn.example/base.css"); */\n.counter { color: red; }';
    await expect(resolveUserCssImports(css, fetcher)).resolves.toBe(css);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('요청 수·누적 크기·제한 시간 예산을 넘기면 뒤의 시트는 받지 않는다', async () => {
    const wide = Array.from(
      { length: 5 },
      (_, i) => `@import url("https://cdn.example/w${i}.css");`,
    ).join('\n');
    const counting = vi.fn(async (url: string) => ({
      finalUrl: url,
      text: `.w${url.slice(-5, -4)} { top: 0 }`,
    }));
    const limited = await resolveUserCssImports(wide, counting, {
      maxRequests: 2,
    });
    expect(counting).toHaveBeenCalledTimes(2);
    expect(limited).toContain('.w0');
    expect(limited).toContain('.w1');
    expect(limited).not.toContain('.w2');

    counting.mockClear();
    const sized = await resolveUserCssImports(wide, counting, {
      maxTotalChars: 20,
    });
    expect(sized).toContain('.w0');
    expect(sized).not.toContain('.w1');

    let clock = 0;
    const slow = vi.fn(async (url: string) => {
      clock += 10_000;
      return { finalUrl: url, text: '.slow { top: 0 }' };
    });
    await resolveUserCssImports(wide, slow, {
      deadlineMs: 15_000,
      now: () => clock,
    });
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('signal이 중단되면 AbortError로 거부한다', async () => {
    const controller = new AbortController();
    const aborting = vi.fn(async (url: string) => {
      controller.abort();
      return { finalUrl: url, text: '.a { top: 0 }' };
    });
    await expect(
      resolveUserCssImports(
        '@import url("https://cdn.example/nested.css");',
        aborting,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('부모·자식 @namespace는 최상단으로 모으고 같은 접두사 재선언은 버린다', async () => {
    const fetcherNs = vi.fn(async (url: string) => ({
      finalUrl: url,
      text: '@namespace svg url(http://www.w3.org/2000/svg);\n@namespace x url(http://other);\nsvg|circle { fill: red; }',
    }));
    const out = await resolveUserCssImports(
      '@import url("https://cdn.example/ns.css");\n@namespace x url(http://mine);\nx|a { color: red; }',
      fetcherNs,
    );
    const lines = out.split('\n');
    expect(lines[0]).toBe('@namespace x url(http://mine);');
    expect(lines[1]).toBe('@namespace svg url(http://www.w3.org/2000/svg);');
    expect(out).not.toContain('http://other');
    expect(out.indexOf('svg|circle')).toBeGreaterThan(
      out.indexOf('@namespace svg'),
    );
  });

  it('absolutizeCssUrls는 주석과 문자열 안의 url( 텍스트를 건드리지 않는다', () => {
    const css =
      '/* url(a.png) */ a { content: "url(icon.png)"; background: url(img.png) }';
    const out = absolutizeCssUrls(css, 'https://cdn.example/dir/sheet.css');
    expect(out).toContain('/* url(a.png) */');
    expect(out).toContain('content: "url(icon.png)"');
    expect(out).toContain('background: url("https://cdn.example/dir/img.png")');
  });

  it('absolutizeCssUrls는 data·절대·해시 URL을 건드리지 않는다', () => {
    const css =
      'a { background: url(img.png) } b { src: url("data:font/woff2;base64,AA") } c { mask: url(#m) } d { x: url(https://x.example/y.png) }';
    const out = absolutizeCssUrls(css, 'https://cdn.example/dir/sheet.css');
    expect(out).toContain('url("https://cdn.example/dir/img.png")');
    expect(out).toContain('url("data:font/woff2;base64,AA")');
    expect(out).toContain('url(#m)');
    expect(out).toContain('url(https://x.example/y.png)');
  });
});
