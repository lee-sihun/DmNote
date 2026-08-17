import { useEffect, useState } from 'react';

const read = () =>
  typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

/**
 * 창 크기를 구독한다. 화면 기준으로 크기를 정하는 팝업은 이걸 써야
 * 리사이즈 후에도 예산이 갱신된다 (렌더 중 window를 직접 읽으면 굳는다)
 */
export const useViewportSize = () => {
  const [size, setSize] = useState(read);

  useEffect(() => {
    let frame: number | null = null;
    const onResize = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setSize((previous) => {
          const next = read();
          return previous.width === next.width &&
            previous.height === next.height
            ? previous
            : next;
        });
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return size;
};
