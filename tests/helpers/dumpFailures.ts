// 개발 보조 — 전체 실패 목록 덤프 (npx vite-node tests/helpers/dumpFailures.ts)
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkFence, extractMdxCodeFences } from './mdxCodeFences';

const root = join(__dirname, '..', '..');
const docsRoot = join(root, 'docs', 'content');

const collect = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collect(fullPath);
    return entry.name.endsWith('.mdx') ? [fullPath] : [];
  });

for (const file of collect(docsRoot)) {
  const fences = extractMdxCodeFences(readFileSync(file, 'utf8'));
  for (const fence of fences) {
    const failure = checkFence(fence);
    if (failure) {
      console.log(
        `${relative(root, file)}:${failure.line} [${failure.lang}] ${
          failure.message
        }`,
      );
    }
  }
}
