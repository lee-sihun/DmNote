import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { usePressAction } from './usePressAction';

interface HarnessProps {
  action: () => void;
  disabled?: boolean;
}

const Harness = ({ action, disabled = false }: HarnessProps) => {
  const press = usePressAction(action);
  return (
    <button data-testid="press" disabled={disabled} {...press}>
      실행
    </button>
  );
};

describe('usePressAction', () => {
  let host: HTMLDivElement;
  let root: Root;
  let action: Mock<() => void>;

  const renderHarness = async (
    nextAction: () => void = action,
    disabled = false,
  ) => {
    await act(async () => {
      root.render(<Harness action={nextAction} disabled={disabled} />);
    });
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="press"]',
    )!;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 100,
      top: 0,
      bottom: 30,
      width: 100,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    return button;
  };

  const pointerEvent = (type: string, init: PointerEventInit = {}) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      ...init,
    });

  const flushTimers = () => {
    act(() => vi.runOnlyPendingTimers());
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    action = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('정상 pointer click을 한 번만 실행한다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      button.dispatchEvent(pointerEvent('pointerup'));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    flushTimers();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('pointerup 뒤 click이 유실되면 fallback을 한 번 실행한다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      button.dispatchEvent(pointerEvent('pointerup'));
    });
    flushTimers();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('pointercancel 뒤 후속 pointerup을 무시한다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      button.dispatchEvent(pointerEvent('pointercancel'));
      button.dispatchEvent(pointerEvent('pointerup'));
    });
    flushTimers();
    expect(action).not.toHaveBeenCalled();
  });

  it('window blur 뒤 후속 pointerup을 무시한다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      window.dispatchEvent(new Event('blur'));
      button.dispatchEvent(pointerEvent('pointerup'));
    });
    flushTimers();
    expect(action).not.toHaveBeenCalled();
  });

  it('버튼 밖에서 놓으면 실행하지 않는다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      button.dispatchEvent(pointerEvent('pointerout'));
      button.dispatchEvent(pointerEvent('pointerup'));
    });
    flushTimers();
    expect(action).not.toHaveBeenCalled();
  });

  it('누른 채 나갔다 돌아와 놓으면 click 유실 fallback을 실행한다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      button.dispatchEvent(pointerEvent('pointerout'));
      button.dispatchEvent(
        pointerEvent('pointerover', { buttons: 1, pointerId: 1 }),
      );
      button.dispatchEvent(pointerEvent('pointerup'));
    });
    flushTimers();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('touch implicit capture로 버튼 밖에서 놓으면 실행하지 않는다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(
        pointerEvent('pointerdown', {
          pointerType: 'touch',
          clientX: 10,
          clientY: 10,
        }),
      );
      button.dispatchEvent(
        pointerEvent('pointerup', {
          pointerType: 'touch',
          clientX: 150,
          clientY: 10,
        }),
      );
    });
    flushTimers();
    expect(action).not.toHaveBeenCalled();
  });

  it('버튼 밖 release 뒤 같은 pointerId의 다음 press가 이전 의도를 되살리지 않는다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      button.dispatchEvent(pointerEvent('pointerout'));
      document.dispatchEvent(pointerEvent('pointerup', { clientX: 150 }));
      document.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
      button.dispatchEvent(
        pointerEvent('pointerover', { buttons: 1, pointerId: 1 }),
      );
      button.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }));
    });
    flushTimers();
    expect(action).not.toHaveBeenCalled();
  });

  it('다른 pointer의 terminal event를 무시한다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
      button.dispatchEvent(pointerEvent('pointerup', { pointerId: 2 }));
    });
    flushTimers();
    expect(action).not.toHaveBeenCalled();
  });

  it('rerender 뒤 최신 action으로 fallback한다', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const button = await renderHarness(first);
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
    });
    await renderHarness(second);
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerup'));
    });
    flushTimers();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('disabled 버튼의 programmatic pointer event를 무시한다', async () => {
    const button = await renderHarness(action, true);
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      button.dispatchEvent(pointerEvent('pointerup'));
    });
    flushTimers();
    expect(action).not.toHaveBeenCalled();
  });

  it('키보드와 programmatic click은 action을 실행한다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('fallback 예약 뒤 unmount되면 stale action을 실행하지 않는다', async () => {
    const button = await renderHarness();
    await act(async () => {
      button.dispatchEvent(pointerEvent('pointerdown'));
      button.dispatchEvent(pointerEvent('pointerup'));
      root.unmount();
    });
    flushTimers();
    expect(action).not.toHaveBeenCalled();
  });

  it('연속 두 번의 정상 click을 각각 한 번 실행한다', async () => {
    const button = await renderHarness();
    await act(async () => {
      for (let index = 0; index < 2; index += 1) {
        button.dispatchEvent(pointerEvent('pointerdown'));
        button.dispatchEvent(pointerEvent('pointerup'));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    flushTimers();
    expect(action).toHaveBeenCalledTimes(2);
  });
});
