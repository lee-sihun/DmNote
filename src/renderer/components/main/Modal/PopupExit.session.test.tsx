import React, { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PopupExit from './PopupExit';

type Commit = (value: string) => void;

interface Session {
  isOpen: boolean;
  onComplete?: Commit;
}

// 드래그 중 언마운트돼도 마지막 값을 커밋하는 계약 (colorPickerPrimitives와 같은 형태)
const Picker = ({
  open,
  onComplete,
}: {
  open?: boolean;
  onComplete: Commit;
}) => {
  const latest = useRef(onComplete);
  useEffect(() => {
    latest.current = onComplete;
  });
  useEffect(() => () => latest.current('last'), []);
  return <div data-testid="picker" data-open={String(open)} />;
};

// App 전역 컬러 피커 구조를 최소로 재현한다. 콜백이 열림 상태와 한 덩어리로
// 전달되므로, 엘리먼트가 붙잡히면 그 세션의 콜백도 함께 붙잡힌다
const Harness = ({ session }: { session: Session }) => (
  <PopupExit open={session.isOpen}>
    {session.isOpen ? (
      <Picker open onComplete={(value) => session.onComplete?.(value)} />
    ) : null}
  </PopupExit>
);

describe('PopupExit session binding', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('routes a deferred commit to the session that opened it', async () => {
    const targetA = vi.fn();
    const targetB = vi.fn();
    const render = async (session: Session) => {
      await act(async () => root.render(<Harness session={session} />));
    };

    await render({ isOpen: true, onComplete: targetA });
    await render({ isOpen: false, onComplete: targetA });
    // 퇴장이 끝나기 전에 다른 대상으로 새 세션을 연다
    await render({ isOpen: true, onComplete: targetB });

    // A의 지연 커밋은 A로 가야 한다. B로 새면 엉뚱한 요소의 색이 바뀐다
    expect(targetA).toHaveBeenCalledWith('last');
    expect(targetB).not.toHaveBeenCalled();

    await render({ isOpen: false, onComplete: targetB });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(targetB).toHaveBeenCalledWith('last');
    expect(targetA).toHaveBeenCalledTimes(1);
  });
});
