/**
 * React Compiler 회귀 가드
 * 컴포넌트 안의 try/catch나 react-hooks eslint-disable 한 줄이면 그 컴포넌트가
 * 통째로 최적화에서 빠지는데 빌드는 조용히 성공한다 - 실제 플러그인으로 컴파일해 확인한다
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

const COMPILED = [
  'src/renderer/components/main/Grid/PropertiesPanel/single/SingleSpritePanel.tsx',
  'src/renderer/components/main/Modal/content/pickers/ImagePicker.tsx',
];

describe('스프라이트 편집 컴파일러 가드', () => {
  it.each(COMPILED)('%s는 컴파일 대상으로 남는다', (path) => {
    expect(compile(path)).toContain('react/compiler-runtime');
  });

  it("SpritePoseGizmo는 'use no memo'로 제외를 명시한다", () => {
    const path =
      'src/renderer/components/main/Grid/handles/SpritePoseGizmo.tsx';
    expect(readFileSync(resolve(process.cwd(), path), 'utf8')).toMatch(
      /^'use no memo';/,
    );
    expect(compile(path)).not.toContain('react/compiler-runtime');
  });
});
