import { useCallback, useEffect, useRef } from 'react';

// 프레임당 한 번만 실행되게 작업을 합친다. 같은 프레임에 여러 번 예약하면 마지막 것만 남는다.
//
// 방향키를 꾹 누르면 OS 반복이 프레임보다 빠르게 들어오는데, 스텝마다 캔버스 갱신을
// 부르면 처리가 반복을 못 따라가 keydown이 큐에 쌓인다. 그러면 손을 뗀 뒤에도
// 밀린 이벤트가 계속 소비되면서 값이 따라 올라간다.
// 화면에 보이는 입력값은 즉시 갱신하고, 바깥으로 나가는 무거운 작업만 여기로 넘긴다
export const useFrameCoalescer = () => {
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const schedule = useCallback((run: () => void) => {
    pendingRef.current = run;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      pending?.();
    });
  }, []);

  return { schedule, cancel };
};
