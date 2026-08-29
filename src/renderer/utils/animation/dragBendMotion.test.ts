import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDragBendMotion } from './dragBendMotion';

const CHIP_WIDTH = 100;
const CHIP_HEIGHT = 30;

let frames: FrameRequestCallback[] = [];

const makeChip = () => {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ width: CHIP_WIDTH, height: CHIP_HEIGHT } as DOMRect);
  return el;
};

const readVar = (el: HTMLElement, name: string) =>
  el.style.getPropertyValue(name);

const readNumber = (el: HTMLElement, name: string) =>
  Number.parseFloat(readVar(el, name));

/** 스텁된 rAF 큐를 한 프레임씩 돌린다 */
const advance = (ms: number, steps = 1) => {
  let now = 0;
  for (let i = 0; i < steps; i += 1) {
    now += ms;
    const pending = frames;
    frames = [];
    for (const frame of pending) frame(now);
  }
};

describe('createDragBendMotion', () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
      frames.push(next);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
    vi.stubGlobal('performance', { now: () => 0 });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('잡은 순간에는 이동량이 0이다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });

    expect(readVar(el, '--tab-drag-x')).toBe('0px');
    expect(readVar(el, '--tab-drag-y')).toBe('0px');
  });

  it('이동량은 포인터 델타를 그대로 따라간다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });
    motion.move({ x: 248, y: 393 });

    // 전이 없이 즉시 - 드롭 슬롯을 겨눌 수 있어야 한다
    expect(readVar(el, '--tab-drag-x')).toBe('48px');
    expect(readVar(el, '--tab-drag-y')).toBe('-7px');
  });

  it('진행 방향으로 bend가 생기고 가로 무단위 복제본이 같은 수다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });
    motion.move({ x: 260, y: 400 });
    advance(16, 4);

    const bendX = readNumber(el, '--tab-bend-x');
    expect(bendX).toBeGreaterThan(0);
    expect(readVar(el, '--tab-bend-xn')).toBe(String(bendX));
    // 세로는 px만 쓰이므로 무단위 짝을 만들지 않는다
    expect(readVar(el, '--tab-bend-yn')).toBe('');
  });

  it('bend는 칩 폭에 비례한 상한을 넘지 않는다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 0, y: 400 });
    // 한 프레임에 창을 가로지르는 비현실적인 속도
    motion.move({ x: 5000, y: 400 });
    advance(16, 30);

    expect(Math.abs(readNumber(el, '--tab-bend-x'))).toBeLessThanOrEqual(
      CHIP_WIDTH * 0.9,
    );
    expect(Math.abs(readNumber(el, '--tab-bend-y'))).toBeLessThanOrEqual(
      CHIP_HEIGHT * 0.5,
    );
  });

  it('포인터가 멈추면 bend가 0으로 수렴하고 루프가 멈춘다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });
    motion.move({ x: 300, y: 400 });
    advance(16, 200);

    expect(readNumber(el, '--tab-bend-x')).toBe(0);
    expect(frames).toHaveLength(0);
  });

  it('진행 방향으로 칩이 기울고 상한을 넘지 않는다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });
    motion.move({ x: 320, y: 400 });
    advance(16, 4);

    const tilt = Number.parseFloat(readVar(el, '--tab-tilt'));
    expect(readVar(el, '--tab-tilt')).toMatch(/deg$/);
    expect(tilt).toBeGreaterThan(0);
    expect(tilt).toBeLessThanOrEqual(10);
  });

  it('반대로 끌면 기울기 부호가 뒤집힌다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 400, y: 400 });
    motion.move({ x: 280, y: 400 });
    advance(16, 4);

    expect(Number.parseFloat(readVar(el, '--tab-tilt'))).toBeLessThan(0);
  });

  it('집으면 배율이 오르고 놓으면 되돌아온다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });

    // 값은 토큰이 소유한다 - 착지 키프레임 시작점과 어긋나지 않게
    expect(readVar(el, '--tab-lift')).toBe('var(--ui-tab-lift-scale)');

    motion.move({ x: 300, y: 400 });
    motion.release(false);
    expect(readVar(el, '--tab-lift')).toBe('1');
  });

  it('착지하면 변수를 모두 지운다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });
    motion.move({ x: 300, y: 420 });
    motion.release(true);

    for (const name of [
      '--tab-drag-x',
      '--tab-drag-y',
      '--tab-bend-x',
      '--tab-bend-y',
      '--tab-bend-xn',
    ]) {
      expect(readVar(el, name)).toBe('');
    }
  });

  it('cancel은 아직 붙들고 있는 요소만 정리한다', () => {
    const first = makeChip();
    const second = makeChip();
    const motion = createDragBendMotion();
    motion.start(first, { x: 200, y: 400 });
    motion.move({ x: 300, y: 420 });
    motion.release(false);
    // 복귀가 끝나기 전에 다음 드래그가 시작된 상황
    motion.start(second, { x: 10, y: 10 });
    motion.cancel(first);

    expect(readVar(second, '--tab-drag-x')).toBe('0px');
    expect(readVar(second, '--tab-lift')).toBe('var(--ui-tab-lift-scale)');
  });

  it('빗나가면 이동량을 0으로 되돌리고 bend는 계속 그린다', () => {
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });
    motion.move({ x: 300, y: 400 });
    advance(16, 3);
    motion.release(false);

    expect(readVar(el, '--tab-drag-x')).toBe('0px');
    // 복귀 구간에도 요소를 놓지 않아야 오버슈트가 그려진다
    expect(frames.length).toBeGreaterThan(0);
    advance(16, 200);
    expect(readNumber(el, '--tab-bend-x')).toBe(0);
  });

  it('모션 축소 설정에서는 bend를 만들지 않는다', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const el = makeChip();
    const motion = createDragBendMotion();
    motion.start(el, { x: 200, y: 400 });
    motion.move({ x: 300, y: 400 });
    advance(16, 10);

    // 이동은 되어야 드래그 자체가 동작한다
    expect(readVar(el, '--tab-drag-x')).toBe('100px');
    expect(readVar(el, '--tab-bend-x')).toBe('');
    expect(frames).toHaveLength(0);
  });
});
