import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/renderer/styles', name), 'utf8');

const barrelCss = read('tokens.css');
const baseCss = read('tokens/base.css');
const darkCss = read('tokens/dark.css');
const lightCss = read('tokens/light.css');
const tailwindConfig = readFileSync(
  resolve(process.cwd(), 'tailwind.config.js'),
  'utf8',
);

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// 선언만 뽑는다. var(--x) 참조는 콜론이 없어 걸리지 않는다
const declaredKeys = (css: string): string[] =>
  Array.from(stripComments(css).matchAll(/(--[\w-]+)\s*:/g)).map((m) => m[1]);

const darkKeys = declaredKeys(darkCss);
const lightKeys = declaredKeys(lightCss);

const tokenHex = (css: string, key: string): string => {
  const match = stripComments(css).match(
    new RegExp(`${key}\\s*:\\s*(#[0-9a-fA-F]{6})\\b`),
  );
  if (!match) throw new Error(`${key} hex token not found`);
  return match[1];
};

const relativeLuminance = (hex: string): number => {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

const labLightness = (hex: string): number => {
  const luminance = relativeLuminance(hex);
  const threshold = 216 / 24389;
  const transformed =
    luminance > threshold
      ? Math.cbrt(luminance)
      : (24389 / 27 / 116) * luminance + 16 / 116;
  return 116 * transformed - 16;
};

describe('테마 토큰 파리티 계약', () => {
  it('다크와 라이트가 같은 키를 같은 순서로 선언한다', () => {
    // 순서까지 묶어 두면 두 파일을 나란히 놓고 읽을 수 있다
    expect(lightKeys).toEqual(darkKeys);
  });

  it('키가 중복 선언되지 않는다', () => {
    expect(new Set(darkKeys).size).toBe(darkKeys.length);
    expect(new Set(lightKeys).size).toBe(lightKeys.length);
  });

  it('테마 파일은 :root 폴백을 두지 않는다', () => {
    // 다크가 bare :root에 남으면 라이트에서 빠진 토큰이 조용히 다크로 새어나간다.
    // :where()로 감싸는 이유는 사용자 CSS의 :root 재정의와 특이도를 맞추기 위함
    expect(stripComments(darkCss)).toContain(
      ":root:where([data-theme='dark']) {",
    );
    expect(stripComments(lightCss)).toContain(
      ":root:where([data-theme='light']) {",
    );
    expect(stripComments(darkCss)).not.toMatch(/(^|\})\s*:root\s*\{/);
    expect(stripComments(lightCss)).not.toMatch(/(^|\})\s*:root\s*\{/);
  });

  it('base는 색을 소유하지 않는다', () => {
    const body = stripComments(baseCss);
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b(rgba?|hsla?|color-mix|oklch)\(/);
    expect(body).not.toMatch(/:\s*(white|black)\b/);
  });

  it('테마 파일은 구조 토큰을 소유하지 않는다', () => {
    const structural = /(radius|duration|ease|stagger|scale|^--z-)/;
    expect(darkKeys.filter((key) => structural.test(key))).toEqual([]);
    expect(lightKeys.filter((key) => structural.test(key))).toEqual([]);
  });

  it('배럴이 세 파일을 순서대로 로드한다', () => {
    const order = Array.from(
      barrelCss.matchAll(/@import\s+'\.\/tokens\/([\w-]+)\.css'/g),
    ).map((m) => m[1]);
    expect(order).toEqual(['base', 'dark', 'light']);
  });

  it('tailwind가 참조하는 토큰이 양쪽 테마에 모두 있다', () => {
    const referenced = new Set(
      Array.from(tailwindConfig.matchAll(/var\((--ui-[\w-]+)\)/g)).map(
        (m) => m[1],
      ),
    );
    const baseKeys = new Set(declaredKeys(baseCss));
    const missing = Array.from(referenced).filter(
      (key) =>
        !baseKeys.has(key) &&
        !(darkKeys.includes(key) && lightKeys.includes(key)),
    );
    expect(missing).toEqual([]);
  });

  it('소스가 참조하는 토큰이 양쪽 테마에 모두 있다', () => {
    // 한쪽 테마에만 값이 있거나 아무 데도 없는 토큰을 쓰기 시작한 코드를 막는다.
    // 사용자 콘텐츠 변수(--dmn-*, --key-*, --counter-* 등)는 앱 테마 대상이 아니다
    const known = new Set([
      ...declaredKeys(baseCss),
      ...darkKeys.filter((key) => lightKeys.includes(key)),
    ]);
    const sources = [
      ...globSync('src/renderer/**/*.{ts,tsx}'),
      ...globSync('src/renderer/styles/*.css'),
    ].filter((file) => !file.includes('__tests__') && !file.includes('.test.'));

    const missing = new Map<string, string>();
    for (const file of sources) {
      const body = readFileSync(resolve(process.cwd(), file), 'utf8');
      for (const match of body.matchAll(/var\((--ui-[\w-]+)/g)) {
        const key = match[1];
        if (known.has(key) || missing.has(key)) continue;
        missing.set(key, file);
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it('라이트 저강도 읽기 텍스트가 앱 바닥과 패널에서 AA 대비를 지킨다', () => {
    for (const foreground of ['--ui-fg-muted', '--ui-fg-caption']) {
      for (const surface of [
        '--ui-bg-app',
        '--ui-bg-panel',
        '--ui-bg-panel-detached',
      ]) {
        expect(
          contrastRatio(
            tokenHex(lightCss, foreground),
            tokenHex(lightCss, surface),
          ),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('라이트 muted, caption, 장식 faint의 명도 단계를 분리한다', () => {
    const muted = tokenHex(lightCss, '--ui-fg-muted');
    const caption = tokenHex(lightCss, '--ui-fg-caption');
    const faint = tokenHex(lightCss, '--ui-fg-faint');
    const mutedLightness = labLightness(muted);
    const captionLightness = labLightness(caption);
    const faintLightness = labLightness(faint);

    expect(captionLightness).toBeGreaterThan(mutedLightness);
    expect(faintLightness).toBeGreaterThan(captionLightness);
    expect(faintLightness - mutedLightness).toBeGreaterThanOrEqual(8);
  });
});
