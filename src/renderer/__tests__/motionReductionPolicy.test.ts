import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  initializeMotionPreferences,
  prefersReducedMotion,
  readMotionDuration,
} from '@utils/animation/motionPreferences';

const mainCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/styles/main.css'),
  'utf8',
);
const reloadIconSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/components/main/common/ReloadIcon.tsx'),
  'utf8',
);

describe('모션 축소 전역 정책', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-dmn-reduced-motion');
    document.documentElement.style.removeProperty('--test-motion-duration');
  });

  it('OS 설정이 켜져 있어도 비활성 정책에서는 모션을 유지한다', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.documentElement.setAttribute('data-dmn-reduced-motion', '');
    document.documentElement.style.setProperty(
      '--test-motion-duration',
      '240ms',
    );

    initializeMotionPreferences();

    expect(prefersReducedMotion()).toBe(false);
    expect(
      document.documentElement.hasAttribute('data-dmn-reduced-motion'),
    ).toBe(false);
    expect(readMotionDuration('--test-motion-duration', 100)).toBe(240);
  });

  it('분리 창 문서에도 같은 비활성 정책을 적용한다', () => {
    const childDocument = document.implementation.createHTMLDocument();
    childDocument.documentElement.setAttribute('data-dmn-reduced-motion', '');

    initializeMotionPreferences(childDocument);

    expect(
      childDocument.documentElement.hasAttribute('data-dmn-reduced-motion'),
    ).toBe(false);
  });

  it('CSS와 회전 아이콘이 OS 미디어 쿼리를 직접 사용하지 않는다', () => {
    expect(mainCss).not.toContain('@media (prefers-reduced-motion: reduce)');
    expect(mainCss).toContain(':root[data-dmn-reduced-motion]');
    expect(mainCss).toContain(
      ':root[data-dmn-reduced-motion] .dmn-reload-spin',
    );
    expect(reloadIconSource).not.toContain('motion-safe:');
  });
});
