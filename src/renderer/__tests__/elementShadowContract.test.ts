import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeKeyElementStyles } from '@hooks/overlay/useKeyElementStyles';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW,
  DEFAULT_ELEMENT_SHADOW,
} from '@utils/element/elementDefaults';
import {
  elementShadowSpecSchema,
  elementShadowToCss,
  type ElementShadowSpec,
} from '@src/types/key/shadows';

const normalizeCssValue = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('기본 요소 눌림 섀도 계약', () => {
  it('입력 그라데이션 미리보기에서도 입력 보더 쌍을 함께 사용한다', () => {
    const { keyStyle, borderRingStyle } = computeKeyElementStyles({
      active: true,
      label: '.',
      position: {
        dx: 0,
        dy: 0,
        width: 60,
        height: 60,
        useInlineStyles: true,
        backgroundColor: 'rgba(0, 0, 255, 0.72)',
        activeBackgroundColor: 'rgba(255, 0, 0, 0.88)',
        activeBackgroundGradient: {
          angle: 225,
          stops: [
            { color: 'rgba(255, 0, 0, 0.88)', pos: 0 },
            { color: 'rgba(255, 0, 0, 0)', pos: 0.38 },
          ],
        },
        borderColor: 'rgba(255, 0, 0, 1)',
        activeBorderColor: 'rgba(255, 255, 255, 0)',
      },
    });

    expect(keyStyle.backgroundImage).toContain('rgba(255, 0, 0, 0.88)');
    expect(keyStyle.backgroundClip).toBe('padding-box');
    expect(keyStyle.border).toBe('1px solid rgba(255, 255, 255, 0)');
    expect(borderRingStyle).toBeNull();
  });

  it('투명 보더를 테두리처럼 보이게 하는 inset을 사용하지 않는다', () => {
    expect(DEFAULT_ELEMENT_ACTIVE_SHADOW).not.toContain('inset');
  });

  it('그림자 입력 범위를 검증한다', () => {
    const valid: ElementShadowSpec = {
      enabled: true,
      color: 'rgba(255, 0, 0, 0.4)',
      offsetX: -100,
      offsetY: 100,
      blur: 100,
    };

    expect(elementShadowSpecSchema.parse(valid)).toEqual(valid);
    expect(
      elementShadowSpecSchema.safeParse({ ...valid, offsetX: -100.1 }).success,
    ).toBe(false);
    expect(
      elementShadowSpecSchema.safeParse({ ...valid, blur: 100.1 }).success,
    ).toBe(false);
  });

  it('일반 모드는 fallback 변수만 제공하고 인라인 우선 모드만 직접 적용한다', () => {
    const shadow: ElementShadowSpec = {
      enabled: true,
      color: 'rgba(12, 34, 56, 0.45)',
      offsetX: -2,
      offsetY: 7,
      blur: 18,
    };
    const position = {
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      shadow,
    };
    const fallback = computeKeyElementStyles({
      active: false,
      label: 'A',
      position,
    }).keyStyle as Record<string, unknown>;
    const inline = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: { ...position, useInlineStyles: true },
    }).keyStyle;

    expect(fallback.boxShadow).toBeUndefined();
    expect(fallback['--dmn-key-shadow-default']).toBe(
      elementShadowToCss(shadow),
    );
    expect(inline.boxShadow).toBe(elementShadowToCss(shadow));
  });

  it('기존 데이터의 기본값과 명시적 끄기를 상태별로 구분한다', () => {
    const basePosition = { dx: 0, dy: 0, width: 60, height: 60 };
    const idle = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: basePosition,
    }).keyStyle as Record<string, unknown>;
    const active = computeKeyElementStyles({
      active: true,
      label: 'A',
      position: basePosition,
    }).keyStyle as Record<string, unknown>;
    const disabled = computeKeyElementStyles({
      active: true,
      label: 'A',
      position: {
        ...basePosition,
        activeShadow: {
          enabled: false,
          color: 'rgba(0, 0, 0, 0.32)',
          offsetX: 0,
          offsetY: 3,
          blur: 8,
        },
      },
    }).keyStyle as Record<string, unknown>;

    expect(idle['--dmn-key-shadow-default']).toBe(DEFAULT_ELEMENT_SHADOW);
    expect(active['--dmn-key-shadow-default']).toBe(
      DEFAULT_ELEMENT_ACTIVE_SHADOW,
    );
    expect(disabled['--dmn-key-shadow-default']).toBe('none');
  });

  it('이미지는 기본 그림자만 억제하고 사용자가 지정한 그림자는 보존한다', () => {
    const basePosition = {
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      inactiveImage: 'asset://key.png',
    };
    const defaultImage = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: basePosition,
    }).keyStyle as Record<string, unknown>;
    const explicitImage = computeKeyElementStyles({
      active: false,
      label: 'A',
      position: {
        ...basePosition,
        shadow: {
          enabled: true,
          color: '#0008',
          offsetX: 0,
          offsetY: 6,
          blur: 12,
        },
      },
    }).keyStyle as Record<string, unknown>;

    expect(defaultImage['--dmn-key-shadow-default']).toBe('none');
    expect(explicitImage['--dmn-key-shadow-default']).toBe(
      '0px 6px 12px #0008',
    );
  });

  it('전역 키·노브 규칙이 공개 변수 뒤에 앱 fallback을 둔다', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/styles/global.css'),
      'utf8',
    );
    expect(normalizeCssValue(css)).toContain(
      'box-shadow: var( --key-active-shadow, var(--key-shadow, var(--dmn-key-shadow-default, none)) )',
    );
    expect(css).toContain('--knob-active-shadow');
    expect(css).toMatch(
      /:where\(\[data-key-element\], \[data-graph-element\], \[data-knob-element\]\)\s*\{[^}]*background-clip:\s*padding-box;/,
    );
  });

  it('background 축약 속성을 쓰는 표면도 padding-box 클립을 명시한다', () => {
    const files = [
      'src/renderer/components/shared/KnobFace.tsx',
      'src/renderer/components/shared/GraphPanel.tsx',
    ];

    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).toContain("backgroundClip: 'padding-box'");
    }

    for (const file of [
      'src/renderer/components/main/Grid/layers/KnobItem.tsx',
      'src/renderer/components/overlay/counters/OverlayKnobItem.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toContain("contain: 'layout style paint'");
    }
  });
});
