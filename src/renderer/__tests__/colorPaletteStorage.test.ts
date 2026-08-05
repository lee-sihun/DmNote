// @vitest-environment jsdom
/**
 * 팔레트 저장 유틸 테스트 — localStorage는 외부 입력이므로
 * 로드 경계 파서가 손상 항목을 걸러내고 spec을 canonical로 교정하는지 검증
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPalette,
  addToPalette,
  gradientSpecPaletteEntry,
  isGradientSpecColor,
} from '@utils/color/colorPaletteStorage';

const GRADIENT_KEY = 'dmnote-color-palette-gradient';
const SOLID_KEY = 'dmnote-color-palette-solid';

describe('loadPalette 경계 파서', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('null 스톱이 섞인 spec 항목은 제거된다', () => {
    localStorage.setItem(
      GRADIENT_KEY,
      JSON.stringify([
        { type: 'gradient-spec', angle: 90, stops: [null, null] },
        { type: 'gradient', top: '#ff0000', bottom: '#0000ff' },
      ]),
    );
    const loaded = loadPalette('gradient');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({
      type: 'gradient',
      top: '#ff0000',
      bottom: '#0000ff',
    });
  });

  it('범위 밖 각도·pos는 canonical로 교정해 반환한다', () => {
    localStorage.setItem(
      GRADIENT_KEY,
      JSON.stringify([
        {
          type: 'gradient-spec',
          angle: 450,
          stops: [
            { color: '#00ff00', pos: 1.5 },
            { color: '#ff0000', pos: -0.5 },
          ],
        },
      ]),
    );
    const [entry] = loadPalette('gradient');
    expect(isGradientSpecColor(entry)).toBe(true);
    if (isGradientSpecColor(entry)) {
      expect(entry.angle).toBe(90);
      // pos clamp 후 오름차순 정렬
      expect(entry.stops.map((s) => s.pos)).toEqual([0, 1]);
      expect(entry.stops[0].color).toBe('#ff0000');
    }
  });

  it('솔리드 버킷은 문자열만 통과시키고 7개로 자른다', () => {
    localStorage.setItem(
      SOLID_KEY,
      JSON.stringify([
        '#111111',
        { type: 'gradient-spec', angle: 90, stops: [] },
        '#222222',
        null,
        '#333333',
        '#444444',
        '#555555',
        '#666666',
        '#777777',
        '#888888',
      ]),
    );
    const loaded = loadPalette('solid');
    expect(loaded).toHaveLength(7);
    expect(loaded.every((c) => typeof c === 'string')).toBe(true);
  });

  it('저장 후 재로드 왕복이 무손실이다', () => {
    addToPalette(
      'gradient',
      gradientSpecPaletteEntry({
        angle: 135,
        stops: [
          { color: 'rgba(255,0,0,0.72)', pos: 0 },
          { color: 'rgba(255,0,0,0)', pos: 1 },
        ],
      }),
    );
    const [entry] = loadPalette('gradient');
    expect(isGradientSpecColor(entry)).toBe(true);
    if (isGradientSpecColor(entry)) {
      expect(entry.angle).toBe(135);
      expect(entry.stops).toHaveLength(2);
    }
  });
});
