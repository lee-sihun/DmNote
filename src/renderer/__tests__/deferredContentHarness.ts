import { act } from 'react';
import { vi } from 'vitest';

// after-paint 지연 마운트는 useDeferredContentMount가 rAF 뒤 setTimeout(0)에 본문을 붙인다.
// jsdom엔 rAF가 없으므로 타이머로 흘리고, 두 틱을 기다려 본문이 붙은 뒤를 잡는다.
// 훅의 틱 수가 바뀌면 여기만 따라 고친다 (hooks/ui/useDeferredContentMount.ts)

export const stubAnimationFrame = () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    window.clearTimeout(id);
  });
};

export const settleDeferredContent = async () => {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
};
