import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const darkCss = read('src/renderer/styles/tokens/dark.css');
const lightCss = read('src/renderer/styles/tokens/light.css');
const mainCss = read('src/renderer/styles/main.css');
const tailwindConfig = read('tailwind.config.js');

const themes: [string, string][] = [
  ['dark', darkCss],
  ['light', lightCss],
];

const declared = (css: string, token: string): string | null => {
  const match = css.match(new RegExp(`${token}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
};

describe('canvas 위 glass 표면 계약', () => {
  it('일반 glass와 분리된 밝기·대비·채도 clamp를 가진다', () => {
    // 캔버스는 사용자가 만든 임의 밝기라 일반 표면과 다른 세기가 필요하다.
    // 값이 같아지면 분리해 둔 이유가 사라지므로 다르다는 것 자체를 계약으로 고정
    for (const [name, css] of themes) {
      for (const dial of ['dim', 'contrast', 'sat']) {
        const base = declared(css, `--ui-glass-backdrop-${dial}`);
        const canvas = declared(css, `--ui-glass-canvas-backdrop-${dial}`);
        expect(base, `${name} ${dial}`).not.toBeNull();
        expect(canvas, `${name} canvas ${dial}`).not.toBeNull();
      }
      expect(
        declared(css, '--ui-glass-canvas-backdrop-sat'),
        `${name} canvas sat`,
      ).not.toBe(declared(css, '--ui-glass-backdrop-sat'));
    }
    expect(mainCss).toContain(
      ':where(.backdrop-glass-canvas).backdrop-glass {',
    );
    expect(mainCss).toContain(
      ':where(.backdrop-glass-canvas).backdrop-glass-popup {',
    );
  });

  it('필터 체인이 세 다이얼을 모두 소비한다', () => {
    // 토큰만 늘리고 체인에 안 넣으면 라이트의 범위 압축이 조용히 죽는다
    const filters: string[] = mainCss.match(/backdrop-filter:[^;]+;/g) ?? [];
    const clamped = filters.filter((rule) => rule.includes('brightness('));
    expect(clamped.length).toBeGreaterThan(0);
    for (const rule of clamped) {
      expect(rule).toContain('contrast(');
      expect(rule).toContain('saturate(');
    }
  });

  it('투명도 축소 폴백이 테마 토큰을 거친다', () => {
    // 리터럴로 두면 요소 스코프 선언이 테마 루트를 이겨 라이트에서 다크 면이 뜬다
    const reduced = mainCss.slice(
      mainCss.indexOf('@media (prefers-reduced-transparency: reduce)'),
    );
    expect(reduced).not.toMatch(/--ui-glass[\w-]*:\s*rgba?\(/);
    for (const [name, css] of themes) {
      for (const token of [
        '--ui-glass-reduced',
        '--ui-glass-heavy-reduced',
        '--ui-glass-dim-reduced',
        '--ui-glass-panel-reduced',
      ]) {
        expect(declared(css, token), `${name} ${token}`).not.toBeNull();
      }
    }
  });

  it('canvas 규칙이 투명도 축소 media 규칙보다 앞에서 선언된다', () => {
    const canvasSurfaceRule = mainCss.indexOf(
      ':where(.backdrop-glass-canvas).backdrop-glass {',
    );
    const reducedTransparencyRule = mainCss.indexOf(
      '@media (prefers-reduced-transparency: reduce)',
    );
    expect(canvasSurfaceRule).toBeGreaterThan(-1);
    expect(reducedTransparencyRule).toBeGreaterThan(canvasSurfaceRule);
  });

  it('popup 전용 짧은 shadow가 두 테마에 모두 연결된다', () => {
    for (const [name, css] of themes) {
      const popup = declared(css, '--ui-shadow-popup');
      const modal = declared(css, '--ui-shadow-3');
      expect(popup, `${name} popup`).not.toBeNull();
      // 팝업은 모달의 넓은 번짐을 재사용하지 않는다
      expect(popup, `${name} popup`).not.toBe(modal);
    }
    expect(tailwindConfig).toContain(
      "'elevation-popup': 'var(--ui-shadow-popup)'",
    );
  });

  it('루미노시티 레이어의 목표 휘도가 glass 틴트와 같은 색이다', () => {
    // 틴트만 올리고 여기를 두면 캡이 휘도를 도로 끌어당긴다
    for (const [name, css] of themes) {
      const tint = declared(css, '--ui-glass-backdrop-lum-tint');
      const glass = declared(css, '--ui-glass');
      expect(tint, `${name} lum tint`).toMatch(/^#[0-9a-f]{6}$/);
      const [r, g, b] = [1, 3, 5].map((i) =>
        parseInt((tint as string).slice(i, i + 2), 16),
      );
      expect(glass, `${name} glass`).toContain(`rgba(${r}, ${g}, ${b},`);
    }
  });
});
