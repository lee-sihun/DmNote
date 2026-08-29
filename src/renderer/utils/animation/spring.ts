/**
 * 감쇠 스프링 적분기
 * 목표를 뒤따르는 값 하나를 시뮬레이션한다. 위치·속도를 호출자가 들고 있다가 매 프레임 넘긴다
 */

// 탭 전환이나 긴 프레임 뒤에 dt가 커져도 발산하지 않게 한 프레임 상한을 둔다
export const MAX_FRAME_DT = 1 / 30;

const springStep = (
  x: number,
  v: number,
  target: number,
  k: number,
  c: number,
  dt: number,
): [number, number] => {
  const a = k * (target - x) - c * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv];
};

/**
 * 60Hz 서브스텝으로 쪼개 적분한다. 큰 dt를 한 번에 밀면 explicit Euler가 발산한다
 * @returns [위치, 속도]
 */
export const integrate = (
  x: number,
  v: number,
  target: number,
  k: number,
  c: number,
  dt: number,
): [number, number] => {
  let steps = Math.max(1, Math.ceil(dt * 60));
  const h = dt / steps;
  while (steps-- > 0) {
    [x, v] = springStep(x, v, target, k, c, h);
  }
  return [x, v];
};
