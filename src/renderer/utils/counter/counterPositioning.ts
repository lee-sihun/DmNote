import type React from 'react';
import { rotatePointAround } from '@utils/element/rotation';

export const OUTSIDE_OFFSET = 5;

// 외부 카운터는 키의 형제 노드라 부모 회전을 상속하지 않는다.
// 앵커점을 키 상자 중심 기준으로 돌리고, 원점 0 0에서 rotate 뒤 translate를 적용해
// 카운터 상자가 앵커에 매달린 채 키와 같은 각도로 돈다
export const computeOutsideStyle = (
  align: string,
  dx: number,
  dy: number,
  width: number,
  height: number,
  gap: number,
  rotation = 0,
): React.CSSProperties => {
  const base: React.CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  };

  const offset = Number.isFinite(gap) ? gap : OUTSIDE_OFFSET;

  let anchor: { x: number; y: number };
  let translate: string;
  let minWidth: number | undefined;
  switch (align) {
    case 'bottom':
      anchor = { x: dx + width / 2, y: dy + height + offset };
      translate = 'translate(-50%, 0)';
      minWidth = width;
      break;
    case 'left':
      anchor = { x: dx - offset, y: dy + height / 2 };
      translate = 'translate(-100%, -50%)';
      break;
    case 'right':
      anchor = { x: dx + width + offset, y: dy + height / 2 };
      translate = 'translate(0, -50%)';
      break;
    case 'top':
    default:
      anchor = { x: dx + width / 2, y: dy - offset };
      translate = 'translate(-50%, -100%)';
      minWidth = width;
      break;
  }

  const rotated = rotation !== 0 && Number.isFinite(rotation);
  if (rotated) {
    anchor = rotatePointAround(
      anchor,
      { x: dx + width / 2, y: dy + height / 2 },
      rotation,
    );
  }

  return {
    ...base,
    left: `${anchor.x}px`,
    top: `${anchor.y}px`,
    transform: rotated ? `rotate(${rotation}deg) ${translate}` : translate,
    ...(rotated ? { transformOrigin: '0 0' } : {}),
    ...(minWidth !== undefined ? { minWidth: `${minWidth}px` } : {}),
  };
};
