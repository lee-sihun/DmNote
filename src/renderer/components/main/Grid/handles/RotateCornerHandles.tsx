import type { PointerEvent } from 'react';
import { useCustomCursorHover } from '@hooks/Grid/useCustomCursorHover';
import type { Point } from '@utils/core/rotation';
import {
  getCursor,
  rotationCursorForAngle,
  type RotationCursorType,
} from '@utils/grid/cursorUtils';
import {
  ROTATE_CORNER_INNER_REACH,
  ROTATE_CORNER_OUTER_REACH,
  rotateCornerGeometry,
} from './rotateCornerGeometry';

interface RotateCornerProps {
  corner: Point & { rotation: number };
  index: number;
  label: string;
  innerReach: number;
  onPointerDown: (
    event: PointerEvent<HTMLDivElement>,
    cursor: RotationCursorType,
  ) => void;
}

const RotateCorner = ({
  corner,
  index,
  label,
  innerReach,
  onPointerDown,
}: RotateCornerProps) => {
  const cursor = rotationCursorForAngle(corner.rotation);
  const hover = useCustomCursorHover(cursor);
  const size = ROTATE_CORNER_OUTER_REACH + innerReach;

  return (
    <div
      role="button"
      aria-label={label}
      data-rotate-corner={index}
      className="pointer-events-auto"
      onPointerDown={(event) => onPointerDown(event, cursor)}
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
      style={{
        position: 'absolute',
        left: corner.x - ROTATE_CORNER_OUTER_REACH,
        top: corner.y - ROTATE_CORNER_OUTER_REACH,
        width: size,
        height: size,
        transformOrigin: `${ROTATE_CORNER_OUTER_REACH}px ${ROTATE_CORNER_OUTER_REACH}px`,
        transform: `rotate(${corner.rotation}deg)`,
        clipPath: `polygon(0 0, 100% 0, 100% ${ROTATE_CORNER_OUTER_REACH}px, ${ROTATE_CORNER_OUTER_REACH}px ${ROTATE_CORNER_OUTER_REACH}px, ${ROTATE_CORNER_OUTER_REACH}px 100%, 0 100%)`,
        cursor: getCursor(cursor),
      }}
    />
  );
};

interface RotateCornerHandlesProps {
  corners: readonly Point[];
  label: string;
  innerReach?: number;
  onPointerDown: RotateCornerProps['onPointerDown'];
}

const RotateCornerHandles = ({
  corners,
  label,
  innerReach = ROTATE_CORNER_INNER_REACH,
  onPointerDown,
}: RotateCornerHandlesProps) => (
  <>
    {rotateCornerGeometry(corners).map((corner, index) => (
      <RotateCorner
        key={index}
        corner={corner}
        index={index}
        label={label}
        innerReach={innerReach}
        onPointerDown={onPointerDown}
      />
    ))}
  </>
);

export default RotateCornerHandles;
