// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Palette from './Palette';

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('Palette text input', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    callbacks = new Map();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('연속 텍스트 입력의 최신 색상만 프레임당 한 번 전달한다', () => {
    const onColorChange = vi.fn();
    act(() =>
      root.render(<Palette color="#000000" onColorChange={onColorChange} />),
    );
    const input = host.querySelector('input')!;

    act(() => {
      setInputValue(input, '#111111');
      setInputValue(input, '#222222');
    });
    expect(onColorChange).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);

    act(() => {
      const callback = [...callbacks.values()][0];
      callbacks.clear();
      callback(performance.now());
    });
    expect(onColorChange).toHaveBeenCalledOnce();
    expect(onColorChange).toHaveBeenCalledWith('#222222');
  });

  it('blur는 대기 중인 마지막 텍스트 값을 즉시 확정한다', () => {
    const onColorChange = vi.fn();
    act(() =>
      root.render(<Palette color="#000000" onColorChange={onColorChange} />),
    );
    const input = host.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '#abcdef');
      input.blur();
    });
    expect(onColorChange).toHaveBeenCalledOnce();
    expect(onColorChange).toHaveBeenCalledWith('#ABCDEF');
    expect(callbacks).toHaveLength(0);
  });
});
