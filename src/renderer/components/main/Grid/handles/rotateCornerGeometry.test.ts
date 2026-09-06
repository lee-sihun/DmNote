import { describe, expect, it } from 'vitest';
import { rotatedRectCorners, rotatePointAround } from '@utils/core/rotation';
import { rotationCursorForAngle } from '@utils/grid/cursorUtils';
import { rotateCornerGeometry } from './rotateCornerGeometry';

describe('모서리 바깥 회전 영역', () => {
  it.each([-180, -135, -45, 0, 15, 45, 90, 179])(
    '%s°와 확대·축소에서 각 꼭짓점을 기준으로 바깥 영역을 회전한다',
    (rotation) => {
      for (const zoom of [0.25, 1, 3]) {
        for (const [width, height] of [
          [200, 5],
          [5, 200],
        ]) {
          const corners = rotatedRectCorners(
            100,
            100,
            width * zoom,
            height * zoom,
            rotation,
          );
          const handles = rotateCornerGeometry(corners);
          expect(handles).toHaveLength(4);
          handles.forEach((handle, index) => {
            expect({ x: handle.x, y: handle.y }).toEqual(corners[index]);
            const outside = rotatePointAround(
              { x: handle.x - 16, y: handle.y - 16 },
              handle,
              handle.rotation,
            );
            const local = rotatePointAround(outside, corners[index], -rotation);
            const dx = local.x - corners[index].x;
            const dy = local.y - corners[index].y;
            expect(dx).toBeCloseTo(index === 0 || index === 3 ? -16 : 16);
            expect(dy).toBeCloseTo(index < 2 ? -16 : 16);
          });
        }
      }
    },
  );

  it('화면 방향에 따라 여덟 커서를 고르고 음수와 한 바퀴를 정규화한다', () => {
    for (let index = 0; index < 8; index++) {
      const expected = index === 0 ? 'rotate' : `rotate-${index * 45}`;
      for (const turns of [-2, 0, 2]) {
        expect(rotationCursorForAngle(index * 45 + turns * 360)).toBe(expected);
      }
    }
    expect(rotationCursorForAngle(22.49)).toBe('rotate');
    expect(rotationCursorForAngle(22.51)).toBe('rotate-45');
    expect(rotationCursorForAngle(-22.51)).toBe('rotate-315');
  });
});
