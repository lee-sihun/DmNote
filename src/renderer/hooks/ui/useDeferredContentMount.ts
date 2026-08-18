import { useEffect, useState } from 'react';

/**
 * 표면 셸을 먼저 그리고 무거운 본문 mount를 첫 paint 뒤로 미룬다.
 * rAF 뒤 setTimeout(0) - 프레임이 실제로 그려진 뒤에 붙인다.
 * 한 번 붙은 내용은 다시 걷어내지 않는다 (퇴장 잔상이 비지 않게)
 */
export const useDeferredContentMount = (enabled: boolean): boolean => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => setMounted(true), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);

  return mounted;
};
