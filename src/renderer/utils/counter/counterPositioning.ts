import type React from 'react';

export const OUTSIDE_OFFSET = 5;

export const computeOutsideStyle = (
  align: string,
  dx: number,
  dy: number,
  width: number,
  height: number,
  gap: number,
): React.CSSProperties => {
  const base: React.CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  };

  const offset = Number.isFinite(gap) ? gap : OUTSIDE_OFFSET;

  switch (align) {
    case 'bottom':
      return {
        ...base,
        left: `${dx + width / 2}px`,
        top: `${dy + height + offset}px`,
        transform: 'translate(-50%, 0)',
        minWidth: `${width}px`,
      };
    case 'left':
      return {
        ...base,
        left: `${dx - offset}px`,
        top: `${dy + height / 2}px`,
        transform: 'translate(-100%, -50%)',
      };
    case 'right':
      return {
        ...base,
        left: `${dx + width + offset}px`,
        top: `${dy + height / 2}px`,
        transform: 'translate(0, -50%)',
      };
    case 'top':
    default:
      return {
        ...base,
        left: `${dx + width / 2}px`,
        top: `${dy - offset}px`,
        transform: 'translate(-50%, -100%)',
        minWidth: `${width}px`,
      };
  }
};
