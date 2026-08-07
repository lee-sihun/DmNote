import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SearchField from './SearchField';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('SearchField visual-first filtering', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    container.remove();
  });

  it('검색 문자열을 먼저 표시하고 부모 필터 갱신을 미룬다', async () => {
    const change = vi.fn();
    act(() =>
      root.render(
        <SearchField value="" onChange={change} placeholder="검색" />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, 'note');
    });

    expect(input.value).toBe('note');
    expect(change).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(change).toHaveBeenCalledWith('note');
  });

  it('blur는 예약된 마지막 검색 문자열을 즉시 flush한다', () => {
    const change = vi.fn();
    act(() =>
      root.render(
        <SearchField value="" onChange={change} placeholder="검색" />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, 'note');
    });
    act(() => input.blur());

    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith('note');
  });

  it('포커스가 없을 때 외부 검색값을 동기화한다', () => {
    const Harness = () => {
      const [value, setValue] = useState('before');
      return (
        <>
          <SearchField value={value} onChange={setValue} placeholder="검색" />
          <button type="button" onClick={() => setValue('external')}>
            변경
          </button>
        </>
      );
    };
    act(() => root.render(<Harness />));
    const input = container.querySelector('input')!;
    const button = container.querySelector('button')!;

    act(() => button.click());

    expect(input.value).toBe('external');
  });
});
