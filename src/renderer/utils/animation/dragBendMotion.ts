/**
 * 드래그 칩 모션 컨트롤러
 *
 * 위치는 포인터 델타를 그대로 쓴다. 칩이 커서 뒤를 따라오면 드롭 슬롯을 겨눌 수 없다.
 * 대신 포인터를 뒤따르는 스프링 하나를 두고, 그 속도 하나에서 세 가지를 뽑는다.
 *
 *   lift  집은 순간 살짝 커지고 그림자가 뜬다
 *   tilt  칩 자체가 진행 방향으로 기운다
 *   bend  칩 안쪽 내용물이 한 박자 늦게 밀린다
 */

import { integrate, MAX_FRAME_DT } from './spring';
import { prefersReducedMotion } from './motionPreferences';

// 속도원 스프링. 임계감쇠(2*sqrt(k)=45.6)의 0.66배 - 매끄러우면서 반응이 남아 있다
const FOLLOW_STIFFNESS = 520;
const FOLLOW_DAMPING = 30;

// 속도(px/s)를 bend px로 바꾸는 계수. 가로가 세로보다 크게 반응한다
const BEND_PER_VX = 0.09;
const BEND_PER_VY = 0.05;
const BEND_GAIN_X = 0.35;
const BEND_GAIN_Y = 0.6;
// 칩 크기 대비 bend 상한
const BEND_LIMIT_X_RATIO = 0.9;
const BEND_LIMIT_Y_RATIO = 0.5;
// 지수 평활 속도. dt*9면 약 110ms 시정수
const BEND_SMOOTHING = 9;

// 속도(px/s)를 기울기(deg)로. 참고 프로토타입은 px/ms에 28을 곱하므로 여기선 0.028이다
const TILT_PER_VELOCITY = 0.028;
const TILT_MAX_DEG = 10;

// 이 아래로 떨어지면 정착으로 보고 rAF를 멈춘다
const BEND_SETTLE_EPSILON = 0.05;
const TILT_SETTLE_EPSILON = 0.05;

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

// 0.1px 단위로 끊어 매 프레임 문자열이 새로 만들어지는 것을 줄인다
const quantize = (value: number) => Math.round(value * 10) / 10;

export interface DragPoint {
  x: number;
  y: number;
}

export interface DragBendMotion {
  /** 포인터를 잡은 순간. 칩 요소와 시작 좌표를 넘긴다 */
  start: (element: HTMLElement, point: DragPoint) => void;
  move: (point: DragPoint) => void;
  /**
   * 놓았을 때
   * @param landed 드롭에 성공했으면 true - 변수를 즉시 지운다.
   *               빗나갔으면 false - 복귀 전이를 건다
   */
  release: (landed: boolean) => void;
  /**
   * 세션을 즉시 끝낸다. 복귀가 끝난 뒤와 언마운트 정리용
   * @param owner 이 요소를 아직 붙들고 있을 때만 끝낸다. 늦게 도착한 타이머가
   *              이미 시작된 다음 드래그를 지우지 않게 한다
   */
  cancel: (owner?: HTMLElement) => void;
}

export const createDragBendMotion = (): DragBendMotion => {
  let el: HTMLElement | null = null;
  let raf = 0;
  let lastTime = 0;
  let origin: DragPoint = { x: 0, y: 0 };
  let pointer: DragPoint = { x: 0, y: 0 };
  // 포인터를 뒤따르는 추종기. 위치는 안 쓰고 속도만 쓴다
  let followX = 0;
  let followY = 0;
  let velX = 0;
  let velY = 0;
  let bendX = 0;
  let bendY = 0;
  let tilt = 0;
  let width = 0;
  let height = 0;
  let reduced = false;

  const writeVar = (name: string, value: string) => {
    el?.style.setProperty(name, value);
  };

  const writeBend = () => {
    const x = quantize(bendX);
    const y = quantize(bendY);
    writeVar('--tab-bend-x', `${x}px`);
    writeVar('--tab-bend-y', `${y}px`);
    // 기울기·가로 배율 calc()에 넣으려면 단위 없는 같은 수가 따로 필요하다.
    // 세로는 px만 쓰므로 짝을 만들지 않는다 - 매 프레임 쓰고 아무도 안 읽는 값이 된다
    writeVar('--tab-bend-xn', `${x}`);
    writeVar('--tab-tilt', `${quantize(tilt)}deg`);
  };

  const writeOffset = () => {
    writeVar('--tab-drag-x', `${quantize(pointer.x - origin.x)}px`);
    writeVar('--tab-drag-y', `${quantize(pointer.y - origin.y)}px`);
  };

  const clearVars = () => {
    if (!el) return;
    for (const name of [
      '--tab-drag-x',
      '--tab-drag-y',
      '--tab-bend-x',
      '--tab-bend-y',
      '--tab-bend-xn',
      '--tab-tilt',
      '--tab-lift',
    ]) {
      el.style.removeProperty(name);
    }
  };

  const stopLoop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(MAX_FRAME_DT, (now - lastTime) / 1000);
    lastTime = now;

    [followX, velX] = integrate(
      followX,
      velX,
      pointer.x,
      FOLLOW_STIFFNESS,
      FOLLOW_DAMPING,
      dt,
    );
    [followY, velY] = integrate(
      followY,
      velY,
      pointer.y,
      FOLLOW_STIFFNESS,
      FOLLOW_DAMPING,
      dt,
    );

    const targetX =
      clamp(velX * BEND_PER_VX, width * BEND_LIMIT_X_RATIO) * BEND_GAIN_X;
    const targetY =
      clamp(velY * BEND_PER_VY, height * BEND_LIMIT_Y_RATIO) * BEND_GAIN_Y;
    const smoothing = Math.min(1, dt * BEND_SMOOTHING);
    bendX += (targetX - bendX) * smoothing;
    bendY += (targetY - bendY) * smoothing;
    // 기울기는 추종 스프링 속도에서 바로 나온다. CSS 전이를 겹치면 두 번 늦어진다
    tilt = clamp(velX * TILT_PER_VELOCITY, TILT_MAX_DEG);
    writeBend();

    // 놓은 뒤에도 bend가 반대쪽으로 지나쳤다 수렴하는 동안은 계속 돈다
    const settled =
      Math.abs(bendX) < BEND_SETTLE_EPSILON &&
      Math.abs(bendY) < BEND_SETTLE_EPSILON &&
      Math.abs(targetX) < BEND_SETTLE_EPSILON &&
      Math.abs(targetY) < BEND_SETTLE_EPSILON &&
      Math.abs(tilt) < TILT_SETTLE_EPSILON;
    if (settled) {
      bendX = 0;
      bendY = 0;
      tilt = 0;
      writeBend();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (reduced || raf) return;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  };

  return {
    start(element, point) {
      el = element;
      reduced = prefersReducedMotion();
      const rect = element.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      origin = { x: point.x, y: point.y };
      pointer = { x: point.x, y: point.y };
      followX = point.x;
      followY = point.y;
      velX = 0;
      velY = 0;
      bendX = 0;
      bendY = 0;
      tilt = 0;
      writeOffset();
      if (reduced) return;
      writeBend();
      // 배율 값은 토큰이 소유한다 - 착지 키프레임 시작점과 어긋나면 안 된다
      writeVar('--tab-lift', 'var(--ui-tab-lift-scale)');
    },

    move(point) {
      if (!el) return;
      pointer = { x: point.x, y: point.y };
      writeOffset();
      wake();
    },

    /**
     * 착지하면 칩은 사라지고 슬롯이 이어받는다. 빗나가면 제자리로 되돌린다.
     * 복귀는 전이가 끝난 뒤 호출자가 cancel()로 정리한다 - 그 전에 el을 놓으면
     * bend가 반대쪽으로 지나쳤다 수렴하는 구간이 그려지지 않는다
     */
    release(landed) {
      if (!el) return;
      // 추종기 목표를 시작점으로 되돌리면 bend 오버슈트가 스프링에서 그냥 나온다
      pointer = { ...origin };
      writeVar('--tab-lift', '1');
      if (landed || reduced) {
        stopLoop();
        clearVars();
        el = null;
        return;
      }
      writeOffset();
      wake();
    },

    cancel(owner) {
      if (owner && el !== owner) return;
      stopLoop();
      clearVars();
      el = null;
    },
  };
};
