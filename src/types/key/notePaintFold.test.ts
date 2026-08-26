import { describe, expect, it } from 'vitest';
import { foldGradientOpacity } from './notePaint';
import type { GradientSpec } from '../color';

const spec: GradientSpec = {
  angle: 180,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: 'rgba(0,0,255,0.5)', pos: 1 },
  ],
};

describe('foldGradientOpacity', () => {
  it('배율 100은 원본을 그대로 돌려준다', () => {
    expect(foldGradientOpacity(spec, 100)).toBe(spec);
  });

  it('배율을 각 스톱 알파에 곱해 접는다', () => {
    const folded = foldGradientOpacity(spec, 50);
    expect(folded.stops.map((stop) => stop.color)).toEqual([
      'rgba(255,0,0,0.5)',
      'rgba(0,0,255,0.25)',
    ]);
    expect(folded.angle).toBe(180);
  });

  it('범위 밖 배율은 0~100으로 클램프한다', () => {
    expect(foldGradientOpacity(spec, 250)).toBe(spec);
    expect(
      foldGradientOpacity(spec, -10).stops.map((stop) => stop.color),
    ).toEqual(['rgba(255,0,0,0)', 'rgba(0,0,255,0)']);
  });
});
