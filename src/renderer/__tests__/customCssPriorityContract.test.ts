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

  it('텍스트 그라데이션은 라벨 변수로만 공급되고 쌍 단위로 폴백한다', () => {
    const spec = {
      angle: 0,
      stops: [
        { color: '#FF0080', pos: 0 },
        { color: '#001122', pos: 1 },
      ],
    };
    const base = {
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      useInlineStyles: false,
    };

    const gradientIdle = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: { ...base, fontColor: '#FF0080', fontGradient: spec },
    });
    expect(gradientIdle.keyStyle['--dmn-key-text-image-default']).toContain(
      'linear-gradient',
    );
    expect(gradientIdle.keyStyle['--dmn-key-label-color-default']).toBe(
      'transparent',
    );
    // 변수 모드는 라벨 인라인 승격 없음 - 전역 [data-key-label] 규칙이 소비
    expect(gradientIdle.labelPaintStyle).toEqual({});

    const solid = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: { ...base, fontColor: '#abcdef' },
    });
    expect(solid.keyStyle['--dmn-key-text-image-default']).toBe('none');
    expect(solid.keyStyle['--dmn-key-label-color-default']).toBe('inherit');

    // active 쌍에 저장값이 없으면 idle 쌍 통째 폴백 (그라데이션 유지)
    const activeInherits = computeKeyElementStyles({
      active: true,
      label: 'A',
      position: { ...base, fontColor: '#FF0080', fontGradient: spec },
    });
    expect(activeInherits.keyStyle['--dmn-key-text-image-default']).toContain(
      'linear-gradient',
    );

    // active 단색이 저장돼 있으면 쌍 전체가 단색 - idle 그라데이션 누출 금지
    const activeSolid = computeKeyElementStyles({
      active: true,
      label: 'A',
      position: {
        ...base,
        fontColor: '#FF0080',
        fontGradient: spec,
        activeFontColor: '#123456',
      },
    });
    expect(activeSolid.keyStyle['--dmn-key-text-image-default']).toBe('none');
    expect(activeSolid.keyStyle['--dmn-key-text-color-default']).toBe(
      '#123456',
    );

    // textStyle이 color를 인라인으로 실으면 [data-key-label] 규칙의
    // transparent 클립을 항상 이겨버린다 - 소유권은 전역 규칙에 있다
    expect(gradientIdle.textStyle.color).toBeUndefined();
    expect(solid.textStyle.color).toBeUndefined();

    // 인라인 우선 모드만 라벨 노드에 클립을 직접 승격
    const inline = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: {
        ...base,
        fontColor: '#FF0080',
        fontGradient: spec,
        useInlineStyles: true,
      },
    });
    expect(inline.labelPaintStyle.backgroundImage).toContain('linear-gradient');
    expect(inline.labelPaintStyle.WebkitBackgroundClip).toBe('text');
    expect(inline.labelPaintStyle.color).toBe('transparent');
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
    // 라벨 페인트도 같은 계약: 사용자 --key-text-image → --key-text-color 복귀 → 앱 기본
    expect(css).toMatch(
      /:where\(\[data-key-label\]\)\s*\{[\s\S]*?--key-text-image,[\s\S]*?--key-text-color,[\s\S]*?--dmn-key-text-image-default/,
    );
    // 일반 color 선언이 그라데이션을 자연스럽게 덮도록 text-fill은 currentcolor 고정
    expect(css).toMatch(
      /:where\(\[data-key-label\]\)\s*\{[\s\S]*?-webkit-text-fill-color:\s*currentcolor/,
    );
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
      expect(docs).toContain('--key-text-image');
    }
  });
});
