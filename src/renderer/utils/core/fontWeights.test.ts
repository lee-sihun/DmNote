import { describe, expect, it } from 'vitest';
import type { CustomFont } from '@src/types/settings/fonts';
import {
  expandFontWeightRanges,
  findNearestFontWeight,
  getCommonSupportedFontWeights,
  getSupportedFontWeights,
  resolveEffectiveFontWeight,
  resolveSupportedFontWeight,
} from './fontWeights';

const font = (
  name: string,
  min: number,
  max: number,
  id = `${name}-${min}-${max}`,
): CustomFont => ({
  id,
  type: 'local',
  name,
  displayName: name,
  enabled: true,
  localPath: `/${id}.ttf`,
  weightRanges: [{ min, max }],
});

describe('fontWeights', () => {
  it('가변 범위는 100 단위 옵션으로 확장한다', () => {
    expect(expandFontWeightRanges([{ min: 45, max: 930 }])).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ]);
  });

  it('같은 패밀리의 정적 파일 굵기를 합친다', () => {
    const fonts = [font('Family', 400, 400), font('Family', 700, 700)];
    expect(getSupportedFontWeights('family', fonts)).toEqual([400, 700]);
  });

  it('여러 패밀리 일괄 선택에는 공통 굵기만 남긴다', () => {
    const fonts = [
      font('Variable', 100, 900),
      font('Static', 400, 400),
      font('Static', 700, 700, 'static-bold'),
    ];
    expect(
      getCommonSupportedFontWeights(['Variable', 'Static'], fonts),
    ).toEqual([400, 700]);
  });

  it('동일 거리에서는 더 굵은 지원값을 선택한다', () => {
    expect(findNearestFontWeight(500, [400, 600])).toBe(600);
  });

  it('폰트 변경 시 Regular에서 가장 가까운 지원 굵기를 선택한다', () => {
    const fonts = [
      font('No Regular', 200, 200),
      font('No Regular', 600, 600, 'no-regular-semibold'),
      font('Heavy Only', 700, 700),
    ];

    expect(resolveSupportedFontWeight('No Regular', fonts)).toBe(600);
    expect(resolveSupportedFontWeight('Heavy Only', fonts)).toBe(700);
  });

  it('Bold는 상한 없이 기본 굵기에 300을 더한다', () => {
    expect(resolveEffectiveFontWeight(400, true)).toBe(700);
    expect(resolveEffectiveFontWeight(700, true)).toBe(1000);
    expect(resolveEffectiveFontWeight(900, true)).toBe(1200);
    expect(resolveEffectiveFontWeight(300, false)).toBe(300);
  });
});
