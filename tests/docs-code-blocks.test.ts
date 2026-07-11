import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkFence, extractMdxCodeFences } from './helpers/mdxCodeFences';

// docs/content 전체 MDX 코드 펜스 구문 검사 —
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
        .map((failure) => `L${failure.line} [${failure.lang}] ${failure.message}`);

      expect(failures).toEqual([]);
    });
  }
});
