import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeKeyElementStyles } from '@hooks/overlay/useKeyElementStyles';
import { getCounterTypographyStyle } from '@utils/core/counterStyles';
import type { GradientSpec } from '@src/types/color';

const gradient: GradientSpec = {
  angle: 135,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: 'rgba(255,0,0,0)', pos: 1 },
  ],
};

describe('커스텀 CSS 우선순위 계약', () => {
  it('일반 키 모드는 앱 외형을 inline 속성이 아닌 fallback 변수로만 제공한다', () => {
    const { keyStyle, borderRingStyle, textStyle } = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: {
        dx: 0,
        dy: 0,
        width: 60,
        height: 60,
        backgroundGradient: gradient,
        borderGradient: gradient,
        borderWidth: 3,
        borderRadius: 8,
        fontSize: 18,
        fontColor: '#abcdef',
        useInlineStyles: false,
      },
    });

    expect(keyStyle.backgroundColor).toBeUndefined();
    expect(keyStyle.backgroundImage).toBeUndefined();
    expect(keyStyle.backgroundClip).toBeUndefined();
    expect(keyStyle.border).toBeUndefined();
    expect(keyStyle.borderRadius).toBeUndefined();
    expect(keyStyle.padding).toBeUndefined();
    expect(keyStyle.color).toBeUndefined();
    expect(keyStyle.fontSize).toBeUndefined();
    expect(keyStyle['--dmn-key-bg-image-default']).toContain('linear-gradient');
    expect(keyStyle['--dmn-key-border-default']).toBe('none');
    expect(keyStyle['--dmn-key-padding-default']).toBe('3px');
    expect(keyStyle['--dmn-key-radius-default']).toBe('8px');
    expect(keyStyle['--dmn-key-text-color-default']).toBe('#abcdef');
    expect(borderRingStyle?.background).toBeUndefined();
    expect(borderRingStyle?.['--dmn-border-gradient-image-default']).toContain(
      'linear-gradient',
    );
    expect(
      (keyStyle as Record<string, unknown>)['--dmn-key-bg-image-default'],
    ).toContain('linear-gradient');
    expect(textStyle.fontSize).toBe('inherit');
    expect(textStyle.fontWeight).toBe('inherit');
  });

  it('인라인 우선 모드에서만 속성 패널 외형을 inline으로 승격한다', () => {
    const { keyStyle, borderRingStyle } = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: {
        dx: 0,
        dy: 0,
        width: 60,
        height: 60,
        backgroundGradient: gradient,
        borderGradient: gradient,
        borderWidth: 3,
        useInlineStyles: true,
      },
    });

    expect(keyStyle.backgroundImage).toContain('linear-gradient');
    expect(keyStyle.backgroundClip).toBe('padding-box');
    expect(keyStyle.border).toBe('none');
    expect(keyStyle.padding).toBe('3px');
    expect(borderRingStyle?.background).toContain('linear-gradient');
  });

  it('카운터 타이포도 일반 모드에서는 fallback 변수만 사용한다', () => {
    const fallback = getCounterTypographyStyle({
      fontSize: 22,
      fontFamily: 'Example',
      fontWeight: 700,
      fontItalic: true,
      fontUnderline: true,
    });
    const inline = getCounterTypographyStyle({
      fontSize: 22,
      fontWeight: 700,
      useInlineStyles: true,
    });

    expect(fallback.fontSize).toBeUndefined();
    expect(fallback.fontWeight).toBeUndefined();
    expect(fallback['--dmn-counter-font-size-default']).toBe('22px');
    expect(fallback['--dmn-counter-font-weight-default']).toBe('700');
    expect(inline.fontSize).toBe('22px');
    expect(inline.fontWeight).toBe(700);
  });

  it('전역 앱 외형은 특이도 0 규칙이고 공개 변수가 그라데이션을 끈다', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/styles/global.css'),
      'utf8',
    );

    expect(css).toMatch(
      /:where\(\[data-key-element\]\)\s*\{[\s\S]*?background-image:\s*var\(\s*--key-bg-image,\s*var\(--key-bg,/,
    );
    const rootRule = css.match(
      /:where\(\[data-key-element\]\)\s*\{[\s\S]*?\n\}/,
    )?.[0];
    expect(rootRule).toBeDefined();
    expect(rootRule).not.toMatch(/\n\s*background\s*:/);
    expect(css).toMatch(
      /:where\(\[data-key-element\] > \[data-gradient-border-ring\]\)\s*\{[\s\S]*?--key-border-image,[\s\S]*?var\(--key-border,/,
    );
    expect(css).toMatch(
      /:where\(\.counter\)\s*\{[\s\S]*?--counter-fill-image,[\s\S]*?--counter-color,/,
    );
    // 글리프 페인트 박스 변수도 같은 계약: 사용자 변수 → --counter-color 복귀 → 앱 기본
    for (const channel of ['repeat', 'position', 'size'] as const) {
      expect(css).toMatch(
        new RegExp(
          `:where\\(\\.counter\\)\\s*\\{[\\s\\S]*?--counter-fill-${channel},[\\s\\S]*?--counter-color,[\\s\\S]*?--dmn-counter-fill-${channel}-default`,
        ),
      );
    }
    // 지원 종료된 테두리 표면이 되살아나지 않게
    expect(css).not.toContain('counter-stroke');
    expect(css).not.toContain('key-text-stroke');
    expect(css).toMatch(/:where\(\[data-graph-element\]\)/);
    expect(css).toMatch(/:where\(\[data-knob-element\]\)/);
  });

  it('ko/en 문서는 인라인 우선 모드를 직접 CSS 속성으로 덮어쓴다', () => {
    for (const locale of ['en', 'ko']) {
      const docs = readFileSync(
        resolve(
          process.cwd(),
          `docs/content/${locale}/custom-css/variables/page.mdx`,
        ),
        'utf8',
      );
      expect(docs).not.toContain('--key-bg: #ff2b80 !important');
      expect(docs).toContain('background: #ff2b80 !important');
      expect(docs).not.toContain('counter-stroke');
      expect(docs).not.toContain('key-text-stroke');
    }
  });
});
