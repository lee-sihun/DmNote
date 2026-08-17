// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { handlerRegistry } from './handlerRegistry';

describe('handlerRegistry ownership', () => {
  afterEach(() => handlerRegistry.clear());

  it('개별 unregister 뒤 plugin owner set에 죽은 ID를 남기지 않는다', () => {
    const handlerId = handlerRegistry.register('plugin-a', () => undefined);

    handlerRegistry.unregister(handlerId);
    const sentinel = () => undefined;
    window[handlerId as `__dmn_handler_${string}`] = sentinel;
    handlerRegistry.clearPlugin('plugin-a');

    expect(window[handlerId as `__dmn_handler_${string}`]).toBe(sentinel);
    delete window[handlerId as `__dmn_handler_${string}`];
  });
});
