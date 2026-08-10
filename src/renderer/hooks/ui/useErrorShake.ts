import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnimationEvent } from 'react';
import { prefersReducedMotion } from '@utils/animation/motionPreferences';

// 확정할 수 없는 입력을 한 번 털어서 알린다.
//
// 재생 중 다시 틀려도 처음부터 다시 돌아야 하는데, 같은 클래스를 계속 붙여두면
// 브라우저가 새 재생으로 보지 않는다. 한 프레임 껐다 켜서 재생을 새로 건다
export const useErrorShake = () => {
  const [shaking, setShaking] = useState(false);
  const frameRef = useRef<number | null>(null);

  const cancelFrame = () => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  useEffect(() => cancelFrame, []);

  const shake = useCallback(() => {
    if (prefersReducedMotion()) return;
    cancelFrame();
    setShaking(false);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setShaking(true);
    });
  }, []);

  const stop = useCallback(() => {
    cancelFrame();
    setShaking(false);
  }, []);

  // 재생이 끝나면 클래스를 내려 다음 재생이 깨끗하게 시작한다.
  // 자식에서 올라오는 animationend와 섞이지 않게 대상과 이름을 함께 확인한다
  const handleAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.animationName !== 'dmnFieldShake') return;
      setShaking(false);
    },
    [],
  );

  return { shaking, shake, stop, handleAnimationEnd };
};
