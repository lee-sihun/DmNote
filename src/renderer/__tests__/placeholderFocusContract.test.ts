import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const globalCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/styles/global.css'),
  'utf8',
);

describe('입력 placeholder 포커스 계약', () => {
  it('input과 textarea의 placeholder를 포커스 동안 전역으로 숨긴다', () => {
    expect(globalCss).toMatch(
      /:where\(input, textarea\):focus::placeholder\s*{[^}]*opacity:\s*0;/,
    );
  });
});
