/**
 * 탭 도구 React Compiler 회귀 가드
 * 실제 플러그인 산출물에 compiler runtime이 없으면 해당 파일 전체가 제외된 상태
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from '@babel/core';
import { describe, expect, it } from 'vitest';

const compile = (relativePath: string): string => {
  const filename = resolve(process.cwd(), relativePath);
  const result = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [
      ['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }],
    ],
  });
  return result?.code ?? '';
};

describe('탭 도구 컴파일러 가드', () => {
  it.each(['tabDrag.tsx', 'tabActions.tsx'])('%s를 컴파일한다', (file) => {
    const code = compile(`src/renderer/components/main/Tool/${file}`);
    expect(code).toContain('react/compiler-runtime');
  });
});
