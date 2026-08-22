import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/styles/tokens.css'),
  'utf8',
);
const mainCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/styles/main.css'),
  'utf8',
);

describe('canvas 위 glass 표면 계약', () => {
  it('일반 glass와 분리된 밝기·채도 clamp를 가진다', () => {
    expect(tokensCss).toMatch(/--ui-glass-canvas-backdrop-dim:\s*0\.62/);
    expect(tokensCss).toMatch(/--ui-glass-canvas-backdrop-sat:\s*0\.35/);
    expect(mainCss).toContain(
      ':where(.backdrop-glass-canvas).backdrop-glass {',
    );
    expect(mainCss).toContain(
      ':where(.backdrop-glass-canvas).backdrop-glass-popup {',
    );
  });

  it('투명도 축소 media 규칙보다 앞에서 선언된다', () => {
    const canvasSurfaceRule = mainCss.indexOf(
      ':where(.backdrop-glass-canvas).backdrop-glass {',
    );
    const reducedTransparencyRule = mainCss.indexOf(
      '@media (prefers-reduced-transparency: reduce)',
    );
    expect(canvasSurfaceRule).toBeGreaterThan(-1);
    expect(reducedTransparencyRule).toBeGreaterThan(canvasSurfaceRule);
  });
});
