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
const globalCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/styles/global.css'),
  'utf8',
);
const tailwindConfig = readFileSync(
  resolve(process.cwd(), 'tailwind.config.js'),
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

  // Windows 투명 효과는 접근성이 아니라 개인 설정 토글이고 배터리 절약 모드가 임의로 끈다
  it('OS 투명도 축소 설정으로 글래스를 강등하지 않는다', () => {
    // 결정 근거 주석은 쿼리 이름을 그대로 적어두므로 규칙만 남기고 검사
    const rulesOnly = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
    // 메인 창이 로드하는 세 시트 전부
    for (const css of [mainCss, tokensCss, globalCss]) {
      expect(rulesOnly(css)).not.toContain('prefers-reduced-transparency');
    }
  });

  it('글래스 표면이 접두사 없는 backdrop-filter를 유지한다', () => {
    // WebView2는 표준 속성을 읽는다. 규칙 본문만 잘라 접두사 선언만 남는 회귀를 잡는다
    const ruleBody = (className: string) =>
      mainCss.match(new RegExp(`^\\.${className} \\{([^}]*)\\}`, 'm'))?.[1] ??
      '';
    for (const className of [
      'backdrop-glass',
      'backdrop-glass-popup',
      'backdrop-glass-scrim',
    ]) {
      expect(ruleBody(className)).toMatch(/\n\s*backdrop-filter:\s*blur\(/);
    }
  });

  it('popup 전용 짧은 shadow가 theme에 연결된다', () => {
    expect(tokensCss).toMatch(
      /--ui-shadow-popup:[\s\S]*?0 3px 10px rgba\(0, 0, 0, 0\.28\)/,
    );
    expect(tailwindConfig).toContain(
      "'elevation-popup': 'var(--ui-shadow-popup)'",
    );
  });
});
