import { useEffect, useLayoutEffect, useRef } from 'react';

// 노브 본체 스프링 - 포인터에 거의 붙어 오도록 빡빡하게, 감쇠는 임계(2*sqrt(k)=60)의
// 0.77배라 놓을 때 아주 살짝만 지나쳤다 돌아온다
const BODY_STIFFNESS = 900;
const BODY_DAMPING = 46;
// 꼬리는 본체보다 느리고 더 무겁게 따라온다
const TAIL_STIFFNESS = 170;
const TAIL_DAMPING = 22;
// 진행 방향 늘어남 상한과 속도 계수
const STRETCH_MAX = 0.2;
const STRETCH_PER_SPEED = 6e-4;
// 꼬리 반지름은 노브 크기 비율로 상한, 속도 20px/s부터 자라남
const TAIL_RADIUS_RATIO = 0.28;
const TAIL_SPEED_THRESHOLD = 20;
const TAIL_RADIUS_PER_SPEED = 0.03;
const TAIL_MAX_DISTANCE_RATIO = 0.8;
const TAIL_HIDE_RADIUS = 0.3;
const MAX_FRAME_DT = 1 / 30;
// 마지막 프레임 후 이 시간이 지나도록 rAF가 안 돌았으면 엔진이 루프를 멈춘 것
// (창 가림·이동 중 WebKit rAF 중단) - 잔존 id를 버리고 다시 건다
const STALL_RESUME_MS = 250;

export interface GooeyFrame {
  cx: number;
  cy: number;
  /** 진행 방향 라디안 - stretch가 0이면 무의미 */
  angle: number;
  /** 0~STRETCH_MAX, 진행 방향 배율은 1+stretch, 직각 방향은 1/(1+stretch*0.65) */
  stretch: number;
  tailX: number;
  tailY: number;
  /** 0이면 꼬리 숨김 */
  tailRadius: number;
}

interface GooeySpringOptions {
  /** 측정 기준 요소 - 비율 목표를 px로 바꾸는 폭·높이 */
  measureRef: React.RefObject<Element | null>;
  x: number;
  y: number;
  size: number;
  apply: (frame: GooeyFrame) => void;
}

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

// 60Hz 서브스텝으로 큰 dt에서도 발산하지 않게
const integrate = (
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

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 노브 위치를 스프링으로 뒤따르는 본체와 꼬리를 시뮬레이션해 매 프레임 apply로 넘긴다.
 * 목표가 바뀔 때만 깨어나고 정착하면 rAF를 멈춘다
 */
export const useGooeySpring = ({
  measureRef,
  x,
  y,
  size,
  apply,
}: GooeySpringOptions) => {
  const targetRef = useRef({ x, y });
  const sizeRef = useRef(size);
  const applyRef = useRef(apply);
  // 프레임 루프가 최신 목표·콜백을 보도록 렌더 후 갱신
  useLayoutEffect(() => {
    targetRef.current = { x, y };
    sizeRef.current = size;
    applyRef.current = apply;
  });

  const simRef = useRef({
    initialized: false,
    cx: 0,
    cy: 0,
    vx: 0,
    vy: 0,
    tailX: 0,
    tailY: 0,
    tailVx: 0,
    tailVy: 0,
    tailRadius: 0,
    lastTime: 0,
    raf: 0,
  });

  const wake = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const sim = simRef.current;

    const targetPx = () => {
      // 부모 scale 전환의 영향을 받지 않도록 bounding rect 대신 client 크기
      const el = measureRef.current;
      const w = el?.clientWidth ?? 0;
      const h = el?.clientHeight ?? 0;
      return { tx: targetRef.current.x * w, ty: targetRef.current.y * h, w, h };
    };

    // 트랙 끝을 넘어가면 벽에 닿은 것처럼 멈춘다 - 빠르게 쳐도 밖으로 튀지 않게
    const clampToTrack = (w: number, h: number) => {
      if (sim.cx < 0) {
        sim.cx = 0;
        sim.vx = Math.max(0, sim.vx);
      } else if (sim.cx > w) {
        sim.cx = w;
        sim.vx = Math.min(0, sim.vx);
      }
      if (sim.cy < 0) {
        sim.cy = 0;
        sim.vy = Math.max(0, sim.vy);
      } else if (sim.cy > h) {
        sim.cy = h;
        sim.vy = Math.min(0, sim.vy);
      }
    };

    const snap = () => {
      const { tx, ty, w, h } = targetPx();
      // 숨김(크기 0) 측정에서는 박제 금지 - 크기 회복 신호가 실측 좌표로 정착
      if (w === 0 || h === 0) return;
      sim.cx = tx;
      sim.cy = ty;
      sim.tailX = tx;
      sim.tailY = ty;
      sim.vx = sim.vy = sim.tailVx = sim.tailVy = 0;
      sim.tailRadius = 0;
      sim.initialized = true;
      applyRef.current({
        cx: tx,
        cy: ty,
        angle: 0,
        stretch: 0,
        tailX: tx,
        tailY: ty,
        tailRadius: 0,
      });
    };

    const frame = (now: number) => {
      sim.raf = 0;
      // rAF 타임스탬프는 wake의 performance.now()보다 앞설 수 있다 - 음수 dt는
      // 스프링을 역적분하고 꼬리 반지름을 목표 반대로 키운다
      const dt = Math.min(
        MAX_FRAME_DT,
        Math.max(0, (now - sim.lastTime) / 1000),
      );
      sim.lastTime = now;
      const { tx, ty, w, h } = targetPx();
      // 한 축이라도 0이면 퇴화 레이아웃 - 0 좌표 정착 대신 wake 재개 대기
      if (w === 0 || h === 0) return;
      const S = sizeRef.current;

      [sim.cx, sim.vx] = integrate(
        sim.cx,
        sim.vx,
        tx,
        BODY_STIFFNESS,
        BODY_DAMPING,
        dt,
      );
      [sim.cy, sim.vy] = integrate(
        sim.cy,
        sim.vy,
        ty,
        BODY_STIFFNESS,
        BODY_DAMPING,
        dt,
      );
      clampToTrack(w, h);
      const speed = Math.hypot(sim.vx, sim.vy);
      const stretch =
        speed > 2 ? Math.min(STRETCH_MAX, speed * STRETCH_PER_SPEED) : 0;
      const angle = Math.atan2(sim.vy, sim.vx);

      [sim.tailX, sim.tailVx] = integrate(
        sim.tailX,
        sim.tailVx,
        sim.cx,
        TAIL_STIFFNESS,
        TAIL_DAMPING,
        dt,
      );
      [sim.tailY, sim.tailVy] = integrate(
        sim.tailY,
        sim.tailVy,
        sim.cy,
        TAIL_STIFFNESS,
        TAIL_DAMPING,
        dt,
      );
      // 꼬리가 본체에서 너무 멀어지면 끊겨 보이므로 거리 클램프
      const dx = sim.tailX - sim.cx;
      const dy = sim.tailY - sim.cy;
      const dist = Math.hypot(dx, dy);
      const maxDist = S * TAIL_MAX_DISTANCE_RATIO;
      if (dist > maxDist) {
        const f = maxDist / dist;
        sim.tailX = sim.cx + dx * f;
        sim.tailY = sim.cy + dy * f;
      }
      const targetRadius = Math.min(
        S * TAIL_RADIUS_RATIO,
        Math.max(0, (speed - TAIL_SPEED_THRESHOLD) * TAIL_RADIUS_PER_SPEED),
      );
      sim.tailRadius += (targetRadius - sim.tailRadius) * Math.min(1, dt * 10);

      const settled =
        Math.abs(sim.cx - tx) < 0.05 &&
        Math.abs(sim.cy - ty) < 0.05 &&
        speed < 1 &&
        sim.tailRadius < TAIL_HIDE_RADIUS;

      if (settled) {
        snap();
        return;
      }
      applyRef.current({
        cx: sim.cx,
        cy: sim.cy,
        angle,
        stretch,
        tailX: sim.tailX,
        tailY: sim.tailY,
        tailRadius: sim.tailRadius < TAIL_HIDE_RADIUS ? 0 : sim.tailRadius,
      });
      sim.raf = requestAnimationFrame(frame);
    };

    wake.current = () => {
      if (!sim.initialized || prefersReducedMotion()) {
        snap();
        return;
      }
      if (sim.raf) {
        // 스케줄은 남았는데 오래 안 돌았다면 엔진이 중단한 루프 - 다시 건다.
        // 정상 구동 중에는 lastTime이 프레임마다 갱신되므로 여기서 걸리지 않는다
        if (performance.now() - sim.lastTime < STALL_RESUME_MS) return;
        cancelAnimationFrame(sim.raf);
      }
      sim.lastTime = performance.now();
      sim.raf = requestAnimationFrame(frame);
    };

    wake.current();
    // 창 가림·전환에서 멈춘 마지막 프레임(꼬리 방울)이 굳지 않게 재개 신호 구독,
    // 숨김 해제(크기 0 → 실측)는 ResizeObserver가 잡는다
    const el = measureRef.current;
    const doc = el?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;
    const resume = () => wake.current();
    doc.addEventListener('visibilitychange', resume);
    win.addEventListener('focus', resume);
    let resizeObserver: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resume);
      resizeObserver.observe(el);
    }
    return () => {
      resizeObserver?.disconnect();
      doc.removeEventListener('visibilitychange', resume);
      win.removeEventListener('focus', resume);
      if (sim.raf) cancelAnimationFrame(sim.raf);
      sim.raf = 0;
    };
  }, [measureRef]);

  // 목표나 크기가 바뀌면 깨운다
  useEffect(() => {
    wake.current();
  }, [x, y, size]);
};
