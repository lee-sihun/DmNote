// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPluginHandlerDispatcher } from './pluginHandlerDispatcher';

describe('plugin handler dispatcher', () => {
  let callbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    callbacks = new Map();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('같은 input의 연속 이벤트는 프레임당 최신 이벤트 한 번만 전달한다', () => {
    const dispatcher = createPluginHandlerDispatcher();
    const input = document.createElement('input');
    const handler = vi.fn();
    const first = new Event('input');
    const last = new Event('input');

    dispatcher.dispatch(input, handler, first);
    dispatcher.dispatch(input, handler, last);
    expect(handler).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    const callback = [...callbacks.values()][0];
    callbacks.clear();
    callback(performance.now());
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(last);
  });

  it('change는 대기 input을 먼저 flush한다', () => {
    const dispatcher = createPluginHandlerDispatcher();
    const input = document.createElement('input');
    const order: string[] = [];
    dispatcher.dispatch(input, () => order.push('input'), new Event('input'));
    dispatcher.dispatch(input, () => order.push('change'), new Event('change'));
    expect(order).toEqual(['input', 'change']);
  });

  it('Promise click은 완료 전 중복 실행을 막고 busy 상태를 복원한다', async () => {
    const dispatcher = createPluginHandlerDispatcher();
    const button = document.createElement('button');
    let resolveAction = () => undefined;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );

    dispatcher.dispatch(button, handler, new Event('click'));
    dispatcher.dispatch(button, handler, new Event('click'));
    expect(handler).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    resolveAction();
    await Promise.resolve();
    await Promise.resolve();
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });
});
