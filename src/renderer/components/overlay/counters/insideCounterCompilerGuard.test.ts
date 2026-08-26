/**
 * React Compiler 회귀 가드
 * InsideCounterLayout은 컴파일 대상이라 시그널 .value를 읽으면 컴파일러가 시그널 identity
 * 기준으로 값을 캐시해 숫자가 갱신되지 않는다 — vitest에는 컴파일러가 없어 동작 테스트로는
 * 잡히지 않으므로 실제 플러그인으로 컴파일한 산출물을 검사한다
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
    plugins: [['babel-plugin-react-compiler', {}]],
  });
  return result?.code ?? '';
};

describe('inside 카운터 컴파일러 가드', () => {
  it('InsideCounterLayout은 컴파일되며 산출물에서 시그널 .value를 읽지 않는다', () => {
    const code = compile(
      'src/renderer/components/overlay/counters/InsideCounterLayout.tsx',
    );
    expect(code).toContain('react/compiler-runtime');
    expect(code).not.toMatch(/\.value\b/);
  });

  it("SignalCountDisplay는 'use no memo'로 컴파일 대상에서 제외된다", () => {
    const code = compile(
      'src/renderer/components/overlay/counters/SignalCountDisplay.tsx',
    );
    expect(code).not.toContain('react/compiler-runtime');
    expect(code).toMatch(/countSignal\.value/);
  });
});
