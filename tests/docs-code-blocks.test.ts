import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkFence, extractMdxCodeFences } from './helpers/mdxCodeFences';

// docs/content 전체 MDX 코드 펜스 구문 검사
// 문서 예제의 구문 오류는 빌드·타입체크로 잡히지 않으므로 여기서 잡는다

const DOCS_ROOT = join(__dirname, '..', 'docs', 'content');

const collectPageFiles = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectPageFiles(fullPath);
    return entry.name.endsWith('.mdx') ? [fullPath] : [];
  });
};

const pageFiles = collectPageFiles(DOCS_ROOT);

const i18nApiSource = readFileSync(
  join(__dirname, '..', 'src', 'types', 'plugin', 'api.ts'),
  'utf8',
);
const i18nContract = i18nApiSource.match(/\n  i18n: \{([\s\S]*?)\n  \};/);
const i18nMethods = new Set(
  [...(i18nContract?.[1].matchAll(/^\s+(\w+)\(/gm) ?? [])].map(
    (match) => match[1],
  ),
);

const documentedCalls = (page: string, root: string) =>
  [
    ...page.matchAll(
      new RegExp(`${root.replaceAll('.', '\\.')}(?:\\.\\w+)+`, 'g'),
    ),
  ]
    .map((match) => match[0])
    .filter((call, index, calls) => calls.indexOf(call) === index)
    .sort();

describe('docs code blocks', () => {
  it('MDX 페이지를 찾는다', () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of pageFiles) {
    const relPath = relative(join(__dirname, '..'), filePath);

    it(relPath, () => {
      const fences = extractMdxCodeFences(readFileSync(filePath, 'utf8'));
      const failures = fences
        .map((fence) => checkFence(fence))
        .filter((failure) => failure !== null)
        .map(
          (failure) => `L${failure.line} [${failure.lang}] ${failure.message}`,
        );

      expect(failures).toEqual([]);
    });
  }

  it('i18n API 문서가 실제 공개 메서드만 안내한다', () => {
    expect(i18nContract).not.toBeNull();
    expect([...i18nMethods]).toEqual(['getLocale', 'onLocaleChange']);

    for (const locale of ['en', 'ko']) {
      const page = readFileSync(
        join(DOCS_ROOT, locale, 'api-reference', 'i18n', 'page.mdx'),
        'utf8',
      );
      const documentedMethods = [...page.matchAll(/dmn\.i18n\.(\w+)/g)].map(
        (match) => match[1],
      );

      expect(documentedMethods.length).toBeGreaterThan(0);
      expect(
        documentedMethods.filter((method) => !i18nMethods.has(method)),
      ).toEqual([]);
    }
  });

  it.each([
    ['api-reference/keys/page.mdx', 'dmn.keys'],
    ['api-reference/overlay/page.mdx', 'dmn.overlay'],
    ['api-reference/settings/page.mdx', 'dmn.settings'],
    ['ui-api/page.mdx', 'dmn.ui'],
  ])('%s 공개 호출 목록이 en/ko에서 일치한다', (relativePath, root) => {
    const [englishPage, koreanPage] = ['en', 'ko'].map((locale) =>
      readFileSync(join(DOCS_ROOT, locale, relativePath), 'utf8'),
    );

    expect(documentedCalls(englishPage, root)).toEqual(
      documentedCalls(koreanPage, root),
    );
  });
});
