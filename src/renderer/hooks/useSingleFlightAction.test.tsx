// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSingleFlightAction } from './useSingleFlightAction';

const Harness = ({ action }: { action: () => Promise<void> }) => {
  const { run, pending } = useSingleFlightAction(action);
  return (
    <button disabled={pending} onClick={() => void run()}>
      run
    </button>
  );
};

describe('useSingleFlightAction', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('같은 렌더 틱의 중복 실행을 한 번으로 제한하고 완료 후 해제한다', async () => {
    let resolve = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<void>((next) => {
          resolve = next;
        }),
    );
    act(() => root.render(<Harness action={action} />));
    const button = host.querySelector('button')!;

    act(() => {
      button.click();
      button.click();
    });
    expect(action).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    expect(button.disabled).toBe(false);
  });
});
