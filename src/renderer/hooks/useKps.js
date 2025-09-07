// 고성능 KPS (Keys Per Second) 측정 훅
// - keydown 시 recordKeyDown 호출만 하면 됨
// - GC 최소화를 위해 고정 길이 Float64Array (ring buffer) 사용
// - 순간 KPS: 최근 windowMs 내 keydown 수 * (1000 / windowMs)
// - 평균 KPS: 세션 전체 keydown / 경과 시간
// - React re-render 최소화를 위해 값은 ref 로 노출
import { useRef, useEffect, useCallback } from "react";

export function useKps({
  windowMs = 3000,
  sampleHz = 30,
  bufferSize = 50000,
} = {}) {
  const timesRef = useRef(new Float64Array(bufferSize));
  const writeIndexRef = useRef(0);
  const filledRef = useRef(0); // 실제 채워진 수
  const sessionStartRef = useRef(performance.now());
  const sessionTotalRef = useRef(0);

  // 외부에서 읽을 값들 (state 대신 ref)
  const instantKpsRef = useRef(0);
  const avgKpsRef = useRef(0);
  const peakKpsRef = useRef(0);

  const recordKeyDown = useCallback(() => {
    const now = performance.now();
    timesRef.current[writeIndexRef.current] = now;
    writeIndexRef.current =
      (writeIndexRef.current + 1) % timesRef.current.length;
    if (filledRef.current < timesRef.current.length) filledRef.current++;
    sessionTotalRef.current++;
  }, []);

  useEffect(() => {
    let rafId;
    const interval = 1000 / sampleHz;
    let lastSample = performance.now();

    const sample = () => {
      const now = performance.now();
      if (now - lastSample >= interval) {
        lastSample = now;
        const threshold = now - windowMs;
        let countInWindow = 0;
        // 가장 최근부터 역방향 스캔 -> threshold 이전이면 중단
        for (let i = 1; i <= filledRef.current; i++) {
          const idx =
            (writeIndexRef.current - i + timesRef.current.length) %
            timesRef.current.length;
          const t = timesRef.current[idx];
          if (t >= threshold) {
            countInWindow++;
          } else {
            break;
          }
        }
        const inst = countInWindow * (1000 / windowMs);
        instantKpsRef.current = inst;
        if (inst > peakKpsRef.current) peakKpsRef.current = inst;

        const elapsedSec = (now - sessionStartRef.current) / 1000;
        if (elapsedSec > 0.2) {
          avgKpsRef.current = sessionTotalRef.current / elapsedSec;
        }
      }
      rafId = requestAnimationFrame(sample);
    };
    rafId = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(rafId);
  }, [sampleHz, windowMs]);

  return {
    recordKeyDown,
    instantKpsRef,
    avgKpsRef,
    peakKpsRef,
  };
}
