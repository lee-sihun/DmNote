import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const borderMask = (distanceFromEdge: number, borderWidth: number): number => {
  const signedDistance = -distanceFromEdge;
  const outerMask = clamp01(1 - signedDistance);
  const innerMask = clamp01(1 - (signedDistance + borderWidth));
  return outerMask - innerMask;
};

const edgeCoverage = (
  left: number,
  width: number,
  borderWidth: number,
  halo: number,
): { left: number; right: number } => {
  const right = left + width;
  let leftCoverage = 0;
  let rightCoverage = 0;

  for (
    let pixel = Math.floor(left) - 4;
    pixel <= Math.ceil(right) + 4;
    pixel += 1
  ) {
    const sampleX = pixel + 0.5;
    if (sampleX < left - halo || sampleX >= right + halo) continue;
    const fromLeft = sampleX - left;
    const fromRight = right - sampleX;
    if (fromLeft > -1 && fromLeft < borderWidth + 1) {
      leftCoverage += borderMask(fromLeft, borderWidth);
    }
    if (fromRight > -1 && fromRight < borderWidth + 1) {
      rightCoverage += borderMask(fromRight, borderWidth);
    }
  }

  return { left: leftCoverage, right: rightCoverage };
};

describe('WebGL 노트 쿼드 AA halo', () => {
  it('분수 좌표에서도 테두리 양쪽의 1px AA를 같은 면적으로 보존한다', () => {
    const clipped = edgeCoverage(50.501, 118, 2, 0);
    expect(Math.abs(clipped.left - clipped.right)).toBeGreaterThan(0.9);

    for (const phase of [0.001, 0.125, 0.25, 0.499, 0.501, 0.75, 0.999]) {
      const covered = edgeCoverage(50 + phase, 118, 2, 1);
      expect(covered.left).toBeCloseTo(2, 10);
      expect(covered.right).toBeCloseTo(2, 10);
    }
  });

  it('vertex shader가 길이 있는 노트에 최소 1px halo를 확보한다', () => {
    const source = readFileSync(join(__dirname, 'WebGLTracksOGL.tsx'), 'utf-8');
    expect(source).toContain(
      'float edgeAAHalo = noteLength > 0.0 ? 1.0 : 0.0;',
    );
    expect(source).toContain('float quadHalo = max(glowSize, edgeAAHalo);');
    expect(source).toContain('noteWidth + quadHalo * 2.0');
    expect(source).toContain('noteLength + quadHalo * 2.0');
    expect(source).toContain('vHalfSize = vec2(noteWidth, noteLength) * 0.5');
  });
});
