interface Point {
  x: number;
  y: number;
}

interface GooeyPathOptions {
  bodyRadius: number;
  tailX: number;
  tailY: number;
  tailRadius: number;
}

const HALF_PI = Math.PI / 2;
const HANDLE_SIZE = 2.4;
const SPREAD = 0.5;
const PATH_PRECISION = 1000;

const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));

const pointAt = (center: Point, angle: number, radius: number): Point => ({
  x: center.x + Math.cos(angle) * radius,
  y: center.y + Math.sin(angle) * radius,
});

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const number = (value: number) =>
  String(Math.round(value * PATH_PRECISION) / PATH_PRECISION);

const point = ({ x, y }: Point) => `${number(x)} ${number(y)}`;

const circlePath = (radius: number) =>
  [
    `M ${number(radius)} 0`,
    `A ${number(radius)} ${number(radius)} 0 1 0 ${number(-radius)} 0`,
    `A ${number(radius)} ${number(radius)} 0 1 0 ${number(radius)} 0`,
    'Z',
  ].join(' ');

/**
 * 본체와 꼬리 원의 공통 접선에 Bézier 막을 연결한 단일 벡터 실루엣.
 * 필터 임계값 없이 fill/stroke 가능한 닫힌 SVG path를 반환한다.
 */
export const createGooeyPath = ({
  bodyRadius,
  tailX,
  tailY,
  tailRadius,
}: GooeyPathOptions) => {
  const body = Math.max(0, bodyRadius);
  const tail = Math.max(0, tailRadius);
  if (body === 0) return '';

  const bodyCircle = circlePath(body);
  const bodyCenter = { x: 0, y: 0 };
  const tailCenter = { x: tailX, y: tailY };
  const centerDistance = distance(bodyCenter, tailCenter);
  const maxDistance = body + tail * 2.5;

  if (
    tail === 0 ||
    centerDistance === 0 ||
    centerDistance > maxDistance ||
    centerDistance <= Math.abs(body - tail)
  ) {
    return bodyCircle;
  }

  let bodyOverlapAngle = 0;
  let tailOverlapAngle = 0;
  if (centerDistance < body + tail) {
    bodyOverlapAngle = Math.acos(
      clampUnit(
        (body * body + centerDistance * centerDistance - tail * tail) /
          (2 * body * centerDistance),
      ),
    );
    tailOverlapAngle = Math.acos(
      clampUnit(
        (tail * tail + centerDistance * centerDistance - body * body) /
          (2 * tail * centerDistance),
      ),
    );
  }

  const centerAngle = Math.atan2(tailY, tailX);
  const maxSpread = Math.acos(clampUnit((body - tail) / centerDistance));
  const bodySpread = bodyOverlapAngle + (maxSpread - bodyOverlapAngle) * SPREAD;
  const tailSpread =
    Math.PI -
    tailOverlapAngle -
    (Math.PI - tailOverlapAngle - maxSpread) * SPREAD;

  const bodyLowerAngle = centerAngle + bodySpread;
  const bodyUpperAngle = centerAngle - bodySpread;
  const tailLowerAngle = centerAngle + tailSpread;
  const tailUpperAngle = centerAngle - tailSpread;

  const bodyLower = pointAt(bodyCenter, bodyLowerAngle, body);
  const bodyUpper = pointAt(bodyCenter, bodyUpperAngle, body);
  const tailLower = pointAt(tailCenter, tailLowerAngle, tail);
  const tailUpper = pointAt(tailCenter, tailUpperAngle, tail);

  const totalRadius = body + tail;
  const handleScaleBase = Math.min(
    SPREAD * HANDLE_SIZE,
    distance(bodyLower, tailLower) / totalRadius,
  );
  const handleScale =
    handleScaleBase * Math.min(1, (centerDistance * 2) / totalRadius);
  const bodyHandle = body * handleScale;
  const tailHandle = tail * handleScale;

  const bodyLowerHandle = pointAt(
    bodyLower,
    bodyLowerAngle - HALF_PI,
    bodyHandle,
  );
  const bodyUpperHandle = pointAt(
    bodyUpper,
    bodyUpperAngle + HALF_PI,
    bodyHandle,
  );
  const tailLowerHandle = pointAt(
    tailLower,
    tailLowerAngle + HALF_PI,
    tailHandle,
  );
  const tailUpperHandle = pointAt(
    tailUpper,
    tailUpperAngle - HALF_PI,
    tailHandle,
  );

  return [
    `M ${point(bodyLower)}`,
    `C ${point(bodyLowerHandle)} ${point(tailLowerHandle)} ${point(tailLower)}`,
    `A ${number(tail)} ${number(tail)} 0 ${
      centerDistance > body ? 1 : 0
    } 0 ${point(tailUpper)}`,
    `C ${point(tailUpperHandle)} ${point(bodyUpperHandle)} ${point(bodyUpper)}`,
    `A ${number(body)} ${number(body)} 0 1 0 ${point(bodyLower)}`,
    'Z',
  ].join(' ');
};
