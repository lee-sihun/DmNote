import { useEffect, useState } from 'react';

import { usePanelHost } from '@contexts/PanelHostContext';

const read = (target: Window | undefined) =>
  !target
    ? { width: 0, height: 0 }
    : { width: target.innerWidth, height: target.innerHeight };

/**
 * 창 크기를 구독한다. 화면 기준으로 크기를 정하는 팝업은 이걸 써야
 * 리사이즈 후에도 예산이 갱신된다 (렌더 중 window를 직접 읽으면 굳는다).
 * 분리 패널 창 안에서는 그 창의 크기를 본다
 */
export const useViewportSize = () => {
  const { window: ownerWindow } = usePanelHost();
  const [size, setSize] = useState(() => read(ownerWindow));

  useEffect(() => {
    if (!ownerWindow) return undefined;
    let frame: number | null = null;
    const sync = () => {
      setSize((previous) => {
        const next = read(ownerWindow);
        return previous.width === next.width && previous.height === next.height
          ? previous
          : next;
      });
    };
    const onResize = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        sync();
      });
    };
    // 창이 바뀌면(도킹↔분리) 즉시 새 창 크기로
    sync();
    ownerWindow.addEventListener('resize', onResize);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      ownerWindow.removeEventListener('resize', onResize);
    };
  }, [ownerWindow]);

  return size;
};
