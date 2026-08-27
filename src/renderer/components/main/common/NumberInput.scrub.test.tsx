// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NumberInput } from './NumberInput';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

// 발행은 rAF 뒤 setTimeout 0에 실린다 - 두 틱을 기다린다
const flushAfterPaintCommit = async () => {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
};

describe('NumberInput 접두 스크럽', () => {
  let container: HTMLDivElement;
  let root: Root;
  let captured: Set<number>;

  const prefixEl = () => container.querySelector<HTMLElement>('label > span')!;
  const inputEl = () => container.querySelector('input')!;

  const pointer = (type: string, init: Record<string, unknown> = {}) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      isPrimary: { value: true },
    });
    return event;
  };

  const send = (type: string, init: Record<string, unknown> = {}) =>
    act(() => {
      prefixEl().dispatchEvent(pointer(type, init));
    });

  const render = (
    props: Partial<React.ComponentProps<typeof NumberInput>> = {},
  ) => {
    act(() =>
      root.render(
        <NumberInput value={10} onChange={() => {}} prefix="X" {...props} />,
      ),
    );
  };

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
    // jsdom에는 포인터 캡처가 없다
    captured = new Set();
    HTMLElement.prototype.setPointerCapture = function (id: number) {
      captured.add(id);
    };
    HTMLElement.prototype.releasePointerCapture = function (id: number) {
      captured.delete(id);
    };
    HTMLElement.prototype.hasPointerCapture = (id: number) => captured.has(id);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    container.remove();
  });

  it('드래그 중에는 preview만 흐르고 손을 떼면 onChange가 한 번 나간다', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    render({ onChange, onPreview });

    send('pointerdown', { clientX: 100 });
    // 잡은 동안은 폼·입력 위를 지나도 좌우 화살표 커서를 유지한다
    expect(document.documentElement.classList.contains('dmn-drag-cursor')).toBe(
      true,
    );
    send('pointermove', { clientX: 103 });
    send('pointermove', { clientX: 105 });
    await flushAfterPaintCommit();

    expect(onPreview).toHaveBeenLastCalledWith(15);
    expect(onChange).not.toHaveBeenCalled();
    expect(inputEl().value).toBe('15');

    send('pointerup', { clientX: 105 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(15);
    expect(captured.size).toBe(0);
    expect(document.documentElement.classList.contains('dmn-drag-cursor')).toBe(
      false,
    );
  });

  it('단위가 있는 값은 드래그 중과 부모 preview 뒤에 같은 문자열을 유지한다', async () => {
    const onPreview = vi.fn();
    render({ onPreview, suffix: '%' });

    send('pointerdown', { clientX: 100 });
    send('pointermove', { clientX: 105 });

    await flushAfterPaintCommit();
    expect(onPreview).toHaveBeenLastCalledWith(15);
    expect(inputEl().value).toBe('15%');
  });

  it.each([
    { name: '무단위', suffix: undefined },
    { name: '단위', suffix: '%' },
  ])(
    '$name 스크럽 중 늦게 도착한 부모 값이 최신 표시값을 덮지 않는다',
    async ({ suffix }) => {
      const onChange = vi.fn();
      const onPreview = vi.fn();
      const props = { onChange, onPreview, suffix };
      const expected = `15${suffix ?? ''}`;
      render(props);

      send('pointerdown', { clientX: 100 });
      send('pointermove', { clientX: 105 });
      await flushAfterPaintCommit();
      expect(onPreview).toHaveBeenLastCalledWith(15);
      expect(inputEl().value).toBe(expected);

      render({ ...props, value: 12 });
      expect(inputEl().value).toBe(expected);

      send('pointerup', { clientX: 105 });
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith(15);
      expect(inputEl().value).toBe(expected);
    },
  );

  it('Shift는 1px당 10배로 움직이고 도중에 바꿔도 값이 튀지 않는다', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    render({ onChange, onPreview });

    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 2, shiftKey: true });
    send('pointermove', { clientX: 3 });
    await flushAfterPaintCommit();

    expect(onPreview).toHaveBeenLastCalledWith(31);
  });

  it('min·max 밖으로는 나가지 않고 정수 입력은 반올림한다', async () => {
    const onPreview = vi.fn();
    render({ onPreview, min: 0, max: 12 });

    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 40 });
    await flushAfterPaintCommit();
    expect(onPreview).toHaveBeenLastCalledWith(12);

    send('pointermove', { clientX: -40 });
    await flushAfterPaintCommit();
    expect(onPreview).toHaveBeenLastCalledWith(0);
  });

  it('Escape는 확정 없이 값을 되돌리고 onCancel을 부른다', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const onCancel = vi.fn();
    render({ onChange, onPreview, onCancel });

    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 4 });
    await flushAfterPaintCommit();
    expect(inputEl().value).toBe('14');

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(inputEl().value).toBe('10');
    expect(captured.size).toBe(0);
  });

  it('포인터 취소는 되돌리고, 이동 없는 클릭은 아무것도 내보내지 않는다', () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const onCancel = vi.fn();
    render({ onChange, onPreview, onCancel });

    send('pointerdown', { clientX: 0 });
    send('pointerup', { clientX: 0 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 2 });
    send('pointercancel', { clientX: 2 });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('포커스된 채 스크럽하면 이후 blur가 다시 저장하지 않는다', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    render({ onChange, onPreview });

    act(() => inputEl().focus());
    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 3 });
    await flushAfterPaintCommit();
    send('pointerup', { clientX: 3 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(13);

    act(() => inputEl().blur());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('끌고 있는 도중의 blur는 확정이 아니라 취소다', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const onCancel = vi.fn();
    render({ onChange, onPreview, onCancel });

    act(() => inputEl().focus());
    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 3 });
    await flushAfterPaintCommit();
    expect(inputEl().value).toBe('13');

    // 분리 패널의 창 blur 정산이 먼저 입력을 blur시키는 순서
    act(() => inputEl().blur());
    act(() => window.dispatchEvent(new Event('blur')));

    expect(onChange).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(inputEl().value).toBe('10');
    expect(captured.size).toBe(0);
  });

  it('잡기만 하고 안 움직인 채 blur되면 타이핑 draft는 평소처럼 확정된다', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const onCancel = vi.fn();
    render({ onChange, onPreview, onCancel });

    act(() => {
      inputEl().focus();
      setInputValue(inputEl(), '12');
    });
    await flushAfterPaintCommit();
    expect(onPreview).toHaveBeenLastCalledWith(12);

    send('pointerdown', { clientX: 0 });
    act(() => inputEl().blur());
    act(() => window.dispatchEvent(new Event('blur')));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(12);
    expect(captured.size).toBe(0);
  });

  it('다른 입력이 편집 중이면 시작 전에 그쪽을 blur해 정산하고 자기 입력은 건드리지 않는다', async () => {
    const onPreview = vi.fn();
    render({ onChange: () => {}, onPreview });
    const other = document.createElement('input');
    document.body.append(other);
    const otherBlur = vi.fn();
    other.addEventListener('blur', otherBlur);
    act(() => other.focus());

    send('pointerdown', { clientX: 0 });
    expect(otherBlur).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(other);
    send('pointermove', { clientX: 2 });
    await flushAfterPaintCommit();
    expect(onPreview).toHaveBeenCalled();
    expect(otherBlur.mock.invocationCallOrder[0]).toBeLessThan(
      onPreview.mock.invocationCallOrder[0],
    );
    send('pointerup', { clientX: 2 });
    other.remove();

    act(() => inputEl().focus());
    send('pointerdown', { clientX: 0 });
    expect(document.activeElement).toBe(inputEl());
    send('pointerup', { clientX: 0 });
  });

  it('스크럽 중 방향키는 값에 끼어들지 않는다', async () => {
    const onPreview = vi.fn();
    render({ onChange: () => {}, onPreview });

    act(() => inputEl().focus());
    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 3 });
    await flushAfterPaintCommit();
    expect(onPreview).toHaveBeenLastCalledWith(13);

    const keydown = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      inputEl().dispatchEvent(keydown);
    });
    await flushAfterPaintCommit();
    expect(keydown.defaultPrevented).toBe(true);
    expect(onPreview).toHaveBeenLastCalledWith(13);
    expect(inputEl().value).toBe('13');
    send('pointerup', { clientX: 3 });
  });

  it('취소로 끝난 뒤의 이동 없는 클릭은 삼키지 않는다', () => {
    render({ onChange: () => {}, onPreview: () => {} });

    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 2 });
    send('pointercancel', { clientX: 2 });

    send('pointerdown', { clientX: 0 });
    send('pointerup', { clientX: 0 });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      prefixEl().dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
  });

  it('Mixed 표시 중에도 접두는 손잡이로 남고 대표값에서 출발한다', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    render({ onChange, onPreview, isMixed: true });

    expect(prefixEl()).not.toBeNull();
    expect(inputEl().value).toBe('');
    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 2 });
    await flushAfterPaintCommit();
    expect(onPreview).toHaveBeenLastCalledWith(12);
    send('pointerup', { clientX: 2 });
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('onPreview가 없으면 접두는 손잡이가 아니다', () => {
    const onChange = vi.fn();
    render({ onChange });

    expect(prefixEl().className).not.toContain('cursor-ew-resize');
    send('pointerdown', { clientX: 0 });
    send('pointermove', { clientX: 5 });
    send('pointerup', { clientX: 5 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
