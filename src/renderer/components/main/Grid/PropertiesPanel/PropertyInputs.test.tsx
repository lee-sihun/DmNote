import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const colorInputHarness = vi.hoisted(() => ({
  pickerProps: null as null | Record<string, unknown>,
  gradientOptions: null as null | Record<string, unknown>,
  cancelGradientPreview: vi.fn(),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: (props: {
    footerSlot?: React.ReactNode;
    hexMixed?: boolean;
    opacityPercentMixed?: boolean;
  }) => {
    colorInputHarness.pickerProps = props as Record<string, unknown>;
    return (
      <div
        data-testid="color-picker"
        data-hex-mixed={props.hexMixed ? 'true' : undefined}
        data-alpha-mixed={props.opacityPercentMixed ? 'true' : undefined}
      >
        {props.footerSlot}
      </div>
    );
  },
}));

vi.mock('@components/main/Modal/content/pickers/ColorSwatch', () => ({
  ColorSwatchButton: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { open?: boolean }
  >(({ open, className, ...props }, ref) => (
    <button
      ref={ref}
      className={`${open ? 'shadow-focus-ring' : ''} ${className ?? ''}`}
      {...props}
    />
  )),
}));

vi.mock('@hooks/pickers/useGradientColorState', () => ({
  useGradientColorState: (options: Record<string, unknown>) => {
    colorInputHarness.gradientOptions = options;
    return {
      pickerColor: '#ffffff',
      headerSlot: null,
      footerSlot: <span>gradient-controls</span>,
      paletteGradientSpec: null,
      handlePickerColorChange: vi.fn(),
      handleGradientSpecSelect: vi.fn(),
      cancelPreview: colorInputHarness.cancelGradientPreview,
    };
  },
}));

import {
  ColorInput,
  FontStyleToggle,
  NumberInput,
  OptionalNumberInput,
  TextInput,
} from './PropertyInputs';
import { createFontStyleToggleHandlers } from './fontStyleToggleHandlers';
import { MAX_EXPRESSION_LENGTH } from '@utils/core/arithmeticExpression';
import { finalizeEditorDraftForLifecycle } from '@src/renderer/editor/runtime/lifecycleEditorDraft';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const flushAfterPaintCommit = async () => {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
};

const pressKey = (
  input: HTMLInputElement,
  key: string,
  modifiers: KeyboardEventInit = {},
  options: { staleMs?: number } = {},
) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  // timeStamp는 읽기 전용이라 인스턴스에 덮어써서 큐 대기 상황을 만든다.
  // jsdom은 epoch를 주므로 같은 시계로 뒤로 민다
  if (options.staleMs !== undefined) {
    Object.defineProperty(event, 'timeStamp', {
      value: event.timeStamp - options.staleMs,
    });
  }
  input.dispatchEvent(event);
  return event;
};

const releaseKey = (input: HTMLInputElement, key: string) => {
  input.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
};

const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

describe('NumberInput visual-first commit', () => {
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
    colorInputHarness.pickerProps = null;
    colorInputHarness.gradientOptions = null;
    colorInputHarness.cancelGradientPreview.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    container.remove();
  });

  it('기본 전략은 입력 echo를 먼저 반영하고 부모 commit을 미룬다', async () => {
    const commit = vi.fn();
    act(() => root.render(<NumberInput value={1} onChange={commit} />));
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '25');
    });

    expect(input.value).toBe('25');
    expect(input.getAttribute('value')).toBe('25');
    expect(commit).not.toHaveBeenCalled();
    await flushAfterPaintCommit();
    expect(commit).toHaveBeenCalledWith(25);
  });

  it('sync 전략은 기존처럼 입력 이벤트 안에서 즉시 commit한다', () => {
    const commit = vi.fn();
    act(() =>
      root.render(
        <NumberInput value={1} onChange={commit} commitStrategy="sync" />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '25');
    });

    expect(commit).toHaveBeenCalledWith(25);
  });

  it('연속 입력은 마지막 유효값 하나로 병합한다', async () => {
    const commit = vi.fn();
    act(() => root.render(<NumberInput value={1} onChange={commit} />));
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '2');
      setInputValue(input, '25');
    });
    await flushAfterPaintCommit();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(25);
  });

  it('입력 중 unmount되면 예약된 마지막 값을 유실하지 않는다', () => {
    const commit = vi.fn();
    act(() => root.render(<NumberInput value={1} onChange={commit} />));
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '25');
    });
    act(() => root.render(null));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(25);
  });

  it('유효하지 않은 중간 문자로 blur하면 편집 전 값으로 복원한다', () => {
    const commit = vi.fn();
    act(() => root.render(<NumberInput value={1} onChange={commit} />));
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '2');
      setInputValue(input, '-');
    });
    act(() => input.blur());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(1);
  });

  it('blur는 예약된 preview를 취소하고 최종값을 먼저 commit한다', async () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const blur = vi.fn(() => {
      expect(commit).toHaveBeenCalledWith(25);
    });
    act(() =>
      root.render(
        <NumberInput
          value={1}
          onChange={commit}
          onPreview={preview}
          onBlur={blur}
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '25');
    });
    act(() => input.blur());
    await flushAfterPaintCommit();

    expect(preview).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('Escape는 예약된 preview를 폐기하고 취소 콜백만 실행한다', async () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const cancel = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          value={1}
          onChange={commit}
          onPreview={preview}
          onCancel={cancel}
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '25');
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flushAfterPaintCommit();

    expect(preview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('Optional 입력의 빈 값도 paint 뒤 undefined로 전달한다', async () => {
    const commit = vi.fn();
    act(() =>
      root.render(<OptionalNumberInput value={25} onChange={commit} />),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '');
    });

    expect(input.value).toBe('');
    expect(commit).not.toHaveBeenCalled();
    await flushAfterPaintCommit();
    expect(commit).toHaveBeenCalledWith(undefined);
  });
});

describe('TextInput preview commit', () => {
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

  it('기본 전략은 로컬 문자열을 먼저 표시하고 부모 commit을 미룬다', async () => {
    const commit = vi.fn();
    act(() => root.render(<TextInput value="before" onChange={commit} />));
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, 'after');
    });

    expect(input.value).toBe('after');
    expect(input.getAttribute('value')).toBe('after');
    expect(commit).not.toHaveBeenCalled();
    await flushAfterPaintCommit();
    expect(commit).toHaveBeenCalledWith('after');
  });

  it('sync 전략은 기존처럼 입력 이벤트 안에서 즉시 commit한다', () => {
    const commit = vi.fn();
    act(() =>
      root.render(
        <TextInput value="before" onChange={commit} commitStrategy="sync" />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, 'after');
    });

    expect(commit).toHaveBeenCalledWith('after');
  });

  it('preview가 부모 value를 갱신해도 blur에서 최종값을 commit한다', () => {
    const commit = vi.fn();
    const Harness = () => {
      const [value, setValue] = useState('before');
      return <TextInput value={value} onPreview={setValue} onChange={commit} />;
    };
    act(() => root.render(<Harness />));
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, 'after');
    });
    expect(input.value).toBe('after');

    act(() => input.blur());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('after');
  });

  it('Escape 취소는 preview 값을 commit하지 않는다', () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    act(() =>
      root.render(
        <TextInput
          value="before"
          onPreview={() => {}}
          onChange={commit}
          onCancel={cancel}
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, 'after');
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(finalizeEditorDraftForLifecycle()).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it('preview 채널이 없어도 Escape가 편집 전 값으로 되돌린다', () => {
    // 타이핑이 onChange로 곧장 저장까지 가는 입력이다.
    // 되돌릴 채널도 onChange뿐이다
    const commit = vi.fn();
    act(() =>
      root.render(
        <TextInput value="before" onChange={commit} commitStrategy="sync" />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => setInputValue(input, 'after'));
    expect(commit).toHaveBeenLastCalledWith('after');

    act(() => pressKey(input, 'Escape'));

    expect(commit).toHaveBeenLastCalledWith('before');
    expect(document.activeElement).not.toBe(input);
  });

  it('되돌릴 게 있는 Escape만 소비하고 나머지는 그대로 올려보낸다', () => {
    // 그냥 삼키면 감싸는 모달이 Escape로 안 닫힌다
    const commit = vi.fn();
    act(() => root.render(<TextInput value="before" onChange={commit} />));
    const input = container.querySelector('input')!;

    act(() => input.focus());
    expect(pressKey(input, 'Escape').defaultPrevented).toBe(false);
    expect(commit).not.toHaveBeenCalled();

    act(() => input.focus());
    act(() => setInputValue(input, 'after'));
    expect(pressKey(input, 'Escape').defaultPrevented).toBe(true);
  });

  it('lifecycle finalizer가 DOM 최종값을 한 번만 commit한다', () => {
    const commit = vi.fn();
    act(() =>
      root.render(
        <TextInput value="before" onChange={() => {}} onBlur={commit} />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, 'after');
    });
    act(() => {
      expect(finalizeEditorDraftForLifecycle()).toBe(true);
    });
    act(() => input.blur());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('after');
  });

  it('OS가 먼저 blur해도 lifecycle 정산에서 중복 commit하지 않는다', () => {
    const commit = vi.fn();
    act(() =>
      root.render(
        <TextInput value="before" onChange={() => {}} onBlur={commit} />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => {
      input.focus();
      setInputValue(input, 'after');
      input.blur();
    });
    act(() => {
      expect(finalizeEditorDraftForLifecycle()).toBe(true);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('after');
  });

  it('unmount된 input의 lifecycle callback을 남기지 않는다', () => {
    const commit = vi.fn();
    act(() =>
      root.render(
        <TextInput value="before" onChange={() => {}} onBlur={commit} />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => {
      input.focus();
      setInputValue(input, 'after');
      root.render(null);
    });

    expect(finalizeEditorDraftForLifecycle()).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('숫자 입력 수식 계산', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderNumber = (
    props: Partial<React.ComponentProps<typeof NumberInput>> = {},
  ) => {
    act(() =>
      root.render(
        <NumberInput
          value={10}
          onChange={() => {}}
          commitStrategy="sync"
          {...props}
        />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => input.focus());
    return input;
  };

  const renderOptional = (
    props: Partial<React.ComponentProps<typeof OptionalNumberInput>> = {},
  ) => {
    act(() =>
      root.render(
        <OptionalNumberInput
          value={10}
          onChange={() => {}}
          commitStrategy="sync"
          {...props}
        />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => input.focus());
    return input;
  };

  it.each([
    ['10+10', 20],
    ['10/2', 5],
    ['10*5', 50],
  ])('Enter로 %s를 %s로 확정한다', (expression, expected) => {
    const commit = vi.fn();
    const input = renderNumber({ onChange: commit });

    act(() => setInputValue(input, expression));
    act(() => pressKey(input, 'Enter'));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(expected);
    expect(document.activeElement).not.toBe(input);
  });

  it('기존 값 뒤에 수식을 덧붙여 계산한다', () => {
    const commit = vi.fn();
    const input = renderNumber({ onChange: commit });

    expect(input.value).toBe('10');
    act(() => setInputValue(input, `${input.value}+10`));
    act(() => pressKey(input, 'Enter'));

    expect(commit).toHaveBeenCalledWith(20);
  });

  it('다른 곳을 클릭하면 유효한 수식을 확정한다', () => {
    const commit = vi.fn();
    const blur = vi.fn();
    const input = renderOptional({ onChange: commit, onBlur: blur });

    act(() => setInputValue(input, '(10+5)*2'));
    act(() => input.blur());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(30);
    expect(blur).toHaveBeenCalledWith(30);
  });

  it('Escape는 평가하지 않고 원복한 뒤 취소한다', () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    const input = renderNumber({ onChange: commit, onCancel: cancel });

    act(() => setInputValue(input, '10+10'));
    act(() => pressKey(input, 'Escape'));

    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('10');
    expect(document.activeElement).not.toBe(input);
  });

  it('잘못된 수식 Enter는 포커스와 draft를 유지하고 오류를 표시한다', () => {
    const commit = vi.fn();
    const input = renderNumber({ onChange: commit });

    act(() => setInputValue(input, '10+'));
    act(() => pressKey(input, 'Enter'));

    expect(commit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('10+');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // 보더가 아니라 링이어야 상자 크기가 그대로다. 포커스 링은 대체된다
    const shell = input.closest('label')!;
    expect(shell.classList).toContain('shadow-danger-ring');
    expect(shell.classList).not.toContain('shadow-focus-ring');
  });

  it('잘못된 수식 blur는 Optional 속성을 지우지 않고 원복한다', () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    const input = renderOptional({ onChange: commit, onCancel: cancel });

    act(() => setInputValue(input, '10+'));
    act(() => input.blur());

    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('10');
  });

  it('공백만 있는 Optional draft도 unset하지 않는다', () => {
    const commit = vi.fn();
    const input = renderOptional({ onChange: commit });

    act(() => setInputValue(input, '   '));
    act(() => input.blur());

    expect(commit).not.toHaveBeenCalled();
    expect(input.value).toBe('10');
  });

  it('정확히 빈 Optional draft만 unset한다', () => {
    const commit = vi.fn();
    const input = renderOptional({ onChange: commit, onPreview: vi.fn() });

    act(() => setInputValue(input, ''));
    act(() => input.blur());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(undefined);
  });

  it('수식 타이핑 중에는 preview를 발행하지 않는다', () => {
    const preview = vi.fn();
    const input = renderNumber({ onPreview: preview });

    act(() => setInputValue(input, '10+10'));

    expect(input.value).toBe('10+10');
    expect(preview).not.toHaveBeenCalled();
  });

  it('무효 수식은 앞부분에서 나간 preview를 onCancel로 정리한다', () => {
    const preview = vi.fn();
    const cancel = vi.fn();
    const input = renderNumber({ onPreview: preview, onCancel: cancel });

    act(() => setInputValue(input, '12'));
    expect(preview).toHaveBeenLastCalledWith(12);
    act(() => setInputValue(input, '12+'));
    act(() => input.blur());

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('10');
  });

  it('onCancel이 없으면 확정값을 preview로 다시 발행한다', () => {
    const commit = vi.fn();
    const preview = vi.fn();
    const input = renderNumber({ onChange: commit, onPreview: preview });

    act(() => setInputValue(input, '12'));
    act(() => setInputValue(input, '12+'));
    act(() => input.blur());

    expect(commit).not.toHaveBeenCalled();
    expect(preview).toHaveBeenLastCalledWith(10);
    expect(input.value).toBe('10');
  });

  it('preview가 부모 value를 바꿔도 포커스 시점 확정값으로 복원한다', () => {
    const preview = vi.fn();
    const Harness = () => {
      const [value, setValue] = useState(10);
      return (
        <NumberInput
          value={value}
          onChange={() => {}}
          onPreview={(next) => {
            preview(next);
            setValue(next);
          }}
        />
      );
    };
    act(() => root.render(<Harness />));
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => setInputValue(input, '12'));
    act(() => setInputValue(input, '12+'));
    act(() => input.blur());

    expect(preview).toHaveBeenLastCalledWith(10);
    expect(input.value).toBe('10');
  });

  it('Escape도 onCancel이 없으면 누수된 preview를 복원한다', () => {
    const preview = vi.fn();
    const input = renderNumber({ onPreview: preview });

    act(() => setInputValue(input, '12'));
    act(() => setInputValue(input, '12+'));
    act(() => pressKey(input, 'Escape'));

    expect(preview).toHaveBeenLastCalledWith(10);
    expect(input.value).toBe('10');
  });

  it('preview 채널이 없는 입력도 무효 수식 blur에서 편집 전 값으로 되돌린다', () => {
    const commit = vi.fn();
    const input = renderNumber({ onChange: commit });

    // onPreview가 없으면 타이핑이 onChange로 곧장 저장까지 간다
    act(() => setInputValue(input, '12'));
    expect(commit).toHaveBeenLastCalledWith(12);
    act(() => setInputValue(input, '12+'));
    act(() => input.blur());

    expect(commit).toHaveBeenLastCalledWith(10);
    expect(input.value).toBe('10');
  });

  it('preview 채널이 없는 Optional은 unset 뒤 무효 수식 blur에서 값을 되살린다', () => {
    const commit = vi.fn();
    const input = renderOptional({ onChange: commit });

    act(() => setInputValue(input, ''));
    expect(commit).toHaveBeenLastCalledWith(undefined);
    act(() => setInputValue(input, '+'));
    act(() => input.blur());

    expect(commit).toHaveBeenLastCalledWith(10);
  });

  it('preview 채널이 없는 입력도 Escape로 편집 전 값을 되찾는다', () => {
    const commit = vi.fn();
    const input = renderNumber({ onChange: commit });

    act(() => setInputValue(input, '12'));
    act(() => pressKey(input, 'Escape'));

    expect(commit).toHaveBeenLastCalledWith(10);
    expect(input.value).toBe('10');
    expect(document.activeElement).not.toBe(input);
  });

  it('Mixed 필드의 취소는 대표값을 전체 선택에 쓰지 않는다', () => {
    // Mixed는 되돌릴 값이 하나가 아니다. 표시되던 대표값을 발행하면
    // 호출부가 그 값을 선택된 요소 전부에 적용해 요소별 값이 사라진다
    const commit = vi.fn();
    const input = renderNumber({ isMixed: true, onChange: commit });

    act(() => setInputValue(input, '5'));
    expect(commit).toHaveBeenLastCalledWith(5);
    act(() => pressKey(input, 'Escape'));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
  });

  it('Mixed Optional 필드의 취소도 대표값을 발행하지 않는다', () => {
    const commit = vi.fn();
    const input = renderOptional({ isMixed: true, onChange: commit });

    act(() => setInputValue(input, '5'));
    expect(commit).toHaveBeenLastCalledWith(5);
    act(() => pressKey(input, 'Escape'));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
  });

  it('되돌릴 게 있는 Escape만 소비하고 나머지는 그대로 올려보낸다', () => {
    // 팝업과 모달은 defaultPrevented로 한 겹씩 닫는다. 편집을 되돌리는 Escape가
    // 그대로 올라가면 감싸는 피커까지 닫히고, 반대로 손대지 않았는데 삼키면
    // 모달이 첫 Escape에 안 닫힌다
    const number = renderNumber();
    expect(pressKey(number, 'Escape').defaultPrevented).toBe(false);

    act(() => root.unmount());
    root = createRoot(container);
    const edited = renderNumber();
    act(() => setInputValue(edited, '12'));
    expect(pressKey(edited, 'Escape').defaultPrevented).toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    const optional = renderOptional();
    act(() => setInputValue(optional, '12'));
    expect(pressKey(optional, 'Escape').defaultPrevented).toBe(true);
  });

  it('포커스 중 선택이 Mixed로 바뀌면 취소가 이전 대표값을 쓰지 않는다', () => {
    // 분리 패널 selection sync는 포커스를 유지한 채 선택만 갈아끼운다.
    // 편집을 시작한 선택의 값을 새 선택 전체에 쓰면 요소별 값이 사라진다
    const commit = vi.fn();
    act(() =>
      root.render(
        <NumberInput value={100} onChange={commit} commitStrategy="sync" />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => input.focus());
    act(() => setInputValue(input, '120'));
    expect(commit).toHaveBeenLastCalledWith(120);

    act(() =>
      root.render(
        <NumberInput
          value={100}
          isMixed
          onChange={commit}
          commitStrategy="sync"
        />,
      ),
    );
    act(() => pressKey(input, 'Escape'));

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('포커스 중 선택이 Mixed로 바뀌면 Optional 취소도 대표값을 쓰지 않는다', () => {
    const commit = vi.fn();
    act(() =>
      root.render(
        <OptionalNumberInput
          value={100}
          onChange={commit}
          commitStrategy="sync"
        />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => input.focus());
    act(() => setInputValue(input, '120'));
    expect(commit).toHaveBeenLastCalledWith(120);

    act(() =>
      root.render(
        <OptionalNumberInput
          value={100}
          isMixed
          onChange={commit}
          commitStrategy="sync"
        />,
      ),
    );
    act(() => pressKey(input, 'Escape'));

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('손대지 않은 입력의 Escape는 되돌릴 것이 없어 아무것도 쓰지 않는다', () => {
    const commit = vi.fn();
    const input = renderNumber({ onChange: commit });

    act(() => pressKey(input, 'Escape'));

    expect(commit).not.toHaveBeenCalled();
  });

  it('Mixed 수식을 확정하고 잘못된 수식은 gesture 취소 경로를 탄다', () => {
    const commit = vi.fn();
    const preview = vi.fn();
    const cancel = vi.fn();
    const input = renderNumber({
      value: 40,
      isMixed: true,
      onChange: commit,
      onPreview: preview,
      onCancel: cancel,
    });

    act(() => setInputValue(input, '10+10'));
    act(() => pressKey(input, 'Enter'));
    expect(commit).toHaveBeenLastCalledWith(20);

    act(() => input.focus());
    act(() => setInputValue(input, '12'));
    act(() => setInputValue(input, '12+'));
    act(() => input.blur());

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('유효한 수식에서 방향키를 누르면 평가값부터 스텝하고 팝인은 재생하지 않는다', () => {
    const preview = vi.fn();
    const input = renderNumber({ onPreview: preview });

    act(() => setInputValue(input, '10+10'));
    act(() => pressKey(input, 'ArrowUp'));

    expect(input.value).toBe('21');
    expect(preview).toHaveBeenLastCalledWith(21);
    expect(container.querySelector('.dmn-digit-pop')).toBeNull();
  });

  it('무효 수식에서 방향키도 Enter와 같은 오류 신호를 준다', () => {
    const input = renderNumber();

    act(() => setInputValue(input, '10+'));
    act(() => pressKey(input, 'ArrowUp'));

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.value).toBe('10+');
  });

  it('미완성 수식 방향키는 기본 동작만 막고 draft와 preview를 유지한다', () => {
    const preview = vi.fn();
    const input = renderNumber({ onPreview: preview });

    act(() => setInputValue(input, '10+'));
    let event: KeyboardEvent;
    act(() => {
      event = pressKey(input, 'ArrowUp');
    });

    expect(event!.defaultPrevented).toBe(true);
    expect(input.value).toBe('10+');
    expect(preview).not.toHaveBeenCalled();
  });

  it('수식 결과를 반올림, 정밀도 정규화, clamp 순서로 확정한다', () => {
    const integerCommit = vi.fn();
    let input = renderNumber({ onChange: integerCommit, min: 0, max: 10 });
    act(() => setInputValue(input, '10/4'));
    act(() => pressKey(input, 'Enter'));
    expect(integerCommit).toHaveBeenCalledWith(3);

    act(() => root.unmount());
    root = createRoot(container);
    const decimalCommit = vi.fn();
    input = renderNumber({
      value: 0,
      onChange: decimalCommit,
      allowDecimal: true,
      decimalScale: 1,
      min: 0,
      max: 0.96,
    });
    act(() => setInputValue(input, '1.92/2'));
    act(() => pressKey(input, 'Enter'));
    expect(decimalCommit).toHaveBeenCalledWith(0.96);
  });

  it('min과 max는 중간 피연산자가 아니라 최종 결과에만 적용한다', () => {
    const commit = vi.fn();
    const input = renderNumber({ onChange: commit, min: 0, max: 100 });

    act(() => setInputValue(input, '(1000-950)'));
    act(() => pressKey(input, 'Enter'));

    expect(commit).toHaveBeenCalledWith(50);
  });

  it('allowNegative=false여도 뺄셈을 입력하고 최종 도메인만 제한한다', () => {
    const commit = vi.fn();
    const input = renderOptional({ onChange: commit, allowNegative: false });
    act(() => setInputValue(input, '10-5'));
    act(() => pressKey(input, 'Enter'));
    expect(commit).toHaveBeenLastCalledWith(5);

    act(() => input.focus());
    act(() => setInputValue(input, '2-5'));
    act(() => pressKey(input, 'Enter'));
    expect(commit).toHaveBeenLastCalledWith(0);
  });

  it('붙여넣기나 IME에서 들어온 허용되지 않은 문자를 통째로 거절한다', () => {
    const preview = vi.fn();
    const input = renderNumber({ onPreview: preview });

    act(() => setInputValue(input, '10a+5'));

    expect(input.value).toBe('10');
    expect(preview).not.toHaveBeenCalled();
  });

  it('파서가 절대 받을 수 없는 길이의 입력도 통째로 거절한다', () => {
    const preview = vi.fn();
    const input = renderNumber({ onPreview: preview });
    // 잘라서 받으면 사용자가 넣지 않은 다른 유효 수식이 확정될 수 있다
    const tooLong = `${'1+'.repeat(MAX_EXPRESSION_LENGTH)}1`;

    act(() => setInputValue(input, tooLong));

    expect(input.value).toBe('10');
    expect(preview).not.toHaveBeenCalled();
  });

  it('여러 소수점은 다른 숫자로 고치지 않고 무효 수식으로 유지한다', () => {
    const commit = vi.fn();
    const input = renderNumber({
      onChange: commit,
      allowDecimal: true,
      decimalScale: 2,
    });

    act(() => setInputValue(input, '1.2.3'));
    expect(input.value).toBe('1.2.3');
    act(() => pressKey(input, 'Enter'));

    expect(commit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('모든 숫자 필드에 수식 발견성 툴팁을 제공한다', () => {
    const input = renderNumber();
    expect(input.title).toBe('Expressions supported: + - * / ( )');

    act(() => root.unmount());
    root = createRoot(container);
    const optional = renderOptional();
    expect(optional.title).toBe('Expressions supported: + - * / ( )');
  });
});

describe('숫자 입력 방향키 스텝', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderNumberInput = (
    props: Partial<React.ComponentProps<typeof NumberInput>> = {},
  ) => {
    act(() =>
      root.render(
        <NumberInput
          value={585}
          onChange={() => {}}
          commitStrategy="sync"
          {...props}
        />,
      ),
    );
    return container.querySelector('input')!;
  };

  it('위아래 방향키가 값을 1씩 조절한다', () => {
    const input = renderNumberInput();
    act(() => input.focus());

    act(() => pressKey(input, 'ArrowUp'));
    expect(input.value).toBe('586');

    act(() => pressKey(input, 'ArrowDown'));
    act(() => pressKey(input, 'ArrowDown'));
    expect(input.value).toBe('584');
  });

  it('Shift는 10씩, Alt는 소수 필드의 최소 단위로 움직인다', () => {
    const coarse = renderNumberInput();
    act(() => coarse.focus());
    act(() => pressKey(coarse, 'ArrowUp', { shiftKey: true }));
    expect(coarse.value).toBe('595');

    act(() => root.unmount());
    root = createRoot(container);
    const fine = renderNumberInput({ value: 1.5, allowDecimal: true });
    act(() => fine.focus());
    act(() => pressKey(fine, 'ArrowUp', { altKey: true }));
    expect(fine.value).toBe('1.6');
  });

  it('소수 자릿수로 떨어지지 않는 상한도 넘지 않는다', () => {
    // 0.96을 자릿수 1로 정규화하면 1.0이 된다. 클램프가 먼저면 상한 밖으로 나간다
    const input = renderNumberInput({
      value: 0.9,
      max: 0.96,
      allowDecimal: true,
      decimalScale: 1,
    });
    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp'));

    expect(input.value).toBe('0.96');
  });

  it('step이 주어지면 그 단위로 움직인다', () => {
    const input = renderNumberInput({
      value: 1,
      step: 0.5,
      allowDecimal: true,
      decimalScale: 1,
    });
    act(() => input.focus());

    act(() => pressKey(input, 'ArrowUp'));
    expect(input.value).toBe('1.5');

    // Shift는 굵은 눈금이라 step의 10배
    act(() => pressKey(input, 'ArrowUp', { shiftKey: true }));
    expect(input.value).toBe('6.5');

    // Alt는 자릿수의 최소 단위 - step 격자와 별개
    act(() => pressKey(input, 'ArrowDown', { altKey: true }));
    expect(input.value).toBe('6.4');
  });

  it('지수 표기로 표시되는 값도 그 수에서 스텝한다', () => {
    // sanitizer는 숫자와 부호만 남기므로 1e-7이 17이 된다.
    // 그대로 숫자로 읽히는 표시값은 sanitizer를 거치면 안 된다
    const input = renderNumberInput({ value: 1e-7, min: -100, max: 100 });
    act(() => input.focus());
    expect(input.value).toBe('1e-7');

    act(() => pressKey(input, 'ArrowUp'));
    expect(input.value).toBe('1');
  });

  it('쓸 수 없는 step은 기본 눈금으로 되돌린다', () => {
    const input = renderNumberInput({ value: 10, step: 0 });
    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp'));

    expect(input.value).toBe('11');
  });

  it('Ctrl/Cmd 조합은 캐럿 이동이라 값을 건드리지 않는다', () => {
    const input = renderNumberInput();
    act(() => input.focus());

    act(() => pressKey(input, 'ArrowUp', { metaKey: true }));
    act(() => pressKey(input, 'ArrowDown', { ctrlKey: true }));

    expect(input.value).toBe('585');
  });

  it('상한을 넘지 않고, 연속 스텝을 blur에서 한 번만 확정한다', () => {
    const commit = vi.fn();
    const preview = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          value={9}
          max={10}
          onChange={commit}
          onPreview={preview}
          commitStrategy="sync"
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp'));
    act(() => pressKey(input, 'ArrowUp'));
    expect(input.value).toBe('10');
    expect(preview).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();

    act(() => input.blur());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(10);
  });

  it('타이핑으로 값이 바뀐 뒤 이전 스텝값으로 돌아와도 내보낸다', () => {
    const preview = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          value={585}
          onChange={() => {}}
          onPreview={preview}
          commitStrategy="sync"
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp'));
    expect(preview).toHaveBeenLastCalledWith(586);

    act(() => setInputValue(input, '587'));
    expect(preview).toHaveBeenLastCalledWith(587);

    act(() => pressKey(input, 'ArrowDown'));
    expect(input.value).toBe('586');
    expect(preview).toHaveBeenLastCalledWith(586);
  });

  it('꾹 누른 채 blur해도 부모가 최종값으로 저장한다', () => {
    const saved: number[] = [];
    const Harness = () => {
      const [width, setWidth] = useState(100);
      return (
        <NumberInput
          value={width}
          onChange={setWidth}
          // 호출부 패턴 - 확정값이 오면 그걸 쓰고 없으면 자기 state로 폴백
          onBlur={(committed) => saved.push(committed ?? width)}
        />
      );
    };
    act(() => root.render(<Harness />));
    const input = container.querySelector('input')!;

    act(() => input.focus());
    // 밀린 스텝이 프레임을 못 만난 채 blur가 먼저 온다
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => input.blur());

    expect(input.value).toBe('102');
    expect(saved).toEqual([102]);
  });

  it('꾹 누르는 동안 스텝을 프레임 단위로 합쳐 한 번만 내보낸다', async () => {
    const preview = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          value={585}
          onChange={() => {}}
          onPreview={preview}
          commitStrategy="sync"
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));

    // 이벤트마다 화면과 캔버스를 갱신하지 않는다
    expect(input.value).toBe('585');
    expect(preview).not.toHaveBeenCalled();

    await nextFrame();

    expect(input.value).toBe('588');
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith(588);
  });

  it('큐에서 묵은 반복 이벤트는 스텝을 만들지 않는다', async () => {
    const preview = vi.fn();
    act(() =>
      root.render(
        <NumberInput value={585} onChange={() => {}} onPreview={preview} />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp', { repeat: true }, { staleMs: 400 }));
    act(() => pressKey(input, 'ArrowUp', { repeat: true }, { staleMs: 400 }));
    await nextFrame();

    expect(input.value).toBe('585');
    expect(preview).not.toHaveBeenCalled();

    // 신선한 이벤트는 그대로 통과한다
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    await nextFrame();
    expect(input.value).toBe('586');
  });

  it('첫 누름은 묵어도 버리지 않는다', async () => {
    const input = renderNumberInput();
    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp', {}, { staleMs: 400 }));

    expect(input.value).toBe('586');
  });

  it('같은 커밋에 타이핑과 스텝이 겹쳐도 방금 친 값에서 이어간다', () => {
    const input = renderNumberInput();
    act(() => input.focus());

    // React가 커밋하기 전에 두 이벤트가 연달아 처리되는 상황
    act(() => {
      setInputValue(input, '12');
      pressKey(input, 'ArrowUp');
    });

    expect(input.value).toBe('13');
  });

  it('연속 스텝 뒤 blur는 화면 state가 아니라 최종 권위값을 확정한다', () => {
    const commit = vi.fn();
    const Harness = () => {
      const [value, setValue] = useState(585);
      return (
        <NumberInput
          value={value}
          onPreview={setValue}
          onChange={(next) => {
            setValue(next);
            commit(next);
          }}
        />
      );
    };
    act(() => root.render(<Harness />));
    const input = container.querySelector('input')!;

    // 프레임이 오기 전에 blur - 화면 state는 아직 585다
    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => input.blur());

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(587);
    expect(input.value).toBe('587');
  });

  it('Escape는 스텝을 확정하지 않고 밀린 프레임도 되살리지 않는다', async () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    const preview = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          value={585}
          onChange={commit}
          onPreview={preview}
          onCancel={cancel}
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => pressKey(input, 'Escape'));
    await nextFrame();

    expect(commit).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('585');
  });

  it('예약과 실행 사이에 바뀐 min/max와 콜백은 최신 것이 쓰인다', async () => {
    const firstCommit = vi.fn();
    const secondCommit = vi.fn();
    const render = (max: number, onPreview: (v: number) => void) =>
      act(() =>
        root.render(
          <NumberInput
            value={5}
            max={max}
            onChange={() => {}}
            onPreview={onPreview}
            commitStrategy="sync"
          />,
        ),
      );

    render(10, firstCommit);
    const input = container.querySelector('input')!;
    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp', { shiftKey: true, repeat: true }));

    // 프레임이 오기 전에 clamp 규칙과 콜백이 바뀐다
    render(6, secondCommit);
    await nextFrame();

    expect(firstCommit).not.toHaveBeenCalled();
    expect(secondCommit).toHaveBeenCalledTimes(1);
    expect(secondCommit).toHaveBeenCalledWith(6);
    expect(input.value).toBe('6');
  });

  it('누르지 않은 방향키의 keyup은 꾹 누르기를 끝내지 않는다', async () => {
    const preview = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          value={19}
          onChange={() => {}}
          onPreview={preview}
          commitStrategy="sync"
        />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    await nextFrame();
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));

    // 다른 키의 keyup은 무시되므로 밀린 스텝이 아직 반영되지 않는다
    act(() => releaseKey(input, 'ArrowDown'));
    expect(input.value).toBe('20');

    act(() => releaseKey(input, 'ArrowUp'));
    expect(input.value).toBe('21');
    expect(preview).toHaveBeenLastCalledWith(21);
  });

  it('한 프레임에 방향이 섞이면 합산 결과가 값에 반영된다', async () => {
    act(() => root.render(<NumberInput value={10} onChange={() => {}} />));
    const input = container.querySelector('input')!;
    act(() => input.focus());

    // 위 두 번, 아래 한 번 = 순증가
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => pressKey(input, 'ArrowDown', { repeat: true }));
    act(() => releaseKey(input, 'ArrowDown'));

    expect(input.value).toBe('11');
  });

  it('손대지 않은 필드는 blur에서 아무것도 쓰지 않는다', () => {
    const commit = vi.fn();
    const Harness = ({ value }: { value?: number }) => (
      <OptionalNumberInput
        value={value}
        onChange={commit}
        isMixed={value == null}
      />
    );
    act(() => root.render(<Harness />));
    const input = container.querySelector('input')!;

    act(() => input.focus());
    // 편집 중 바깥에서 Mixed가 풀리고 값이 들어온다
    act(() => root.render(<Harness value={24} />));
    act(() => input.blur());

    expect(commit).not.toHaveBeenCalled();
    expect(input.value).toBe('24');
  });

  it('빈 값은 placeholder에 보이는 상속값을 기준으로 올라간다', () => {
    act(() =>
      root.render(
        <OptionalNumberInput
          onChange={() => {}}
          placeholder="16px"
          max={100}
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp'));

    expect(input.value).toBe('17');
  });

  it('타이핑으로 값이 바뀐 뒤 이전 스텝값으로 돌아와도 내보낸다', () => {
    const preview = vi.fn();
    act(() =>
      root.render(
        <OptionalNumberInput
          value={585}
          onChange={() => {}}
          onPreview={preview}
          commitStrategy="sync"
        />,
      ),
    );
    const input = container.querySelector('input')!;

    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp'));
    expect(preview).toHaveBeenLastCalledWith(586);

    act(() => setInputValue(input, '587'));
    expect(preview).toHaveBeenLastCalledWith(587);

    act(() => pressKey(input, 'ArrowDown'));
    expect(input.value).toBe('586');
    expect(preview).toHaveBeenLastCalledWith(586);
  });
});

describe('숫자 스텝 팝인 레이어', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderStepped = (value = 585, modifiers: KeyboardEventInit = {}) => {
    act(() => root.render(<NumberInput value={value} onChange={() => {}} />));
    const input = container.querySelector('input')!;
    act(() => input.focus());
    act(() => pressKey(input, 'ArrowUp', modifiers));
    return input;
  };

  const segments = () => [
    ...container.querySelector('.dmn-digit-pop')!.children,
  ];

  it('안 바뀐 구간은 한 조각으로 유지하고 바뀐 자리만 재생한다', () => {
    renderStepped();

    expect(segments().map((part) => part.textContent)).toEqual(['58', '6']);
    expect(
      segments().map((part) => part.hasAttribute('data-dmn-digit-changed')),
    ).toEqual([false, true]);
  });

  it('선행 부호를 단독 조각으로 남기지 않는다', () => {
    // -3에서 -2로. 오른쪽 정렬 diff만 쓰면 부호가 혼자 남는다
    renderStepped(-3);

    expect(segments().map((part) => part.textContent)).toEqual(['-2']);
  });

  it('표시가 비어 있어도 상속값에서 내려간 방향을 그대로 재생한다', () => {
    act(() =>
      root.render(
        <OptionalNumberInput
          onChange={() => {}}
          placeholder="16px"
          max={100}
        />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => input.focus());
    act(() => pressKey(input, 'ArrowDown'));

    expect(input.value).toBe('15');
    const layer = container.querySelector('.dmn-digit-pop') as HTMLElement;
    expect(layer.style.getPropertyValue('--dmn-digit-dir')).toBe('-1');
  });

  it('재생 중에는 input 글자를 비워 레이어와 겹치지 않게 한다', () => {
    const input = renderStepped();
    expect(input.classList.contains('dmn-digit-pop-host')).toBe(true);
  });

  it('타이핑으로 표시값이 달라지면 레이어가 스스로 접힌다', () => {
    const input = renderStepped();
    act(() => setInputValue(input, '58'));

    expect(container.querySelector('.dmn-digit-pop')).toBeNull();
    expect(input.classList.contains('dmn-digit-pop-host')).toBe(false);
  });

  it('꾹 누르는 동안에는 값만 바뀌고 재생하지 않는다', async () => {
    act(() => root.render(<NumberInput value={19} onChange={() => {}} />));
    const input = container.querySelector('input')!;
    act(() => input.focus());

    // 19에서 20. 자릿수가 통째로 바뀌지만 깜빡이면 안 된다
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    await nextFrame();

    expect(input.value).toBe('20');
    expect(container.querySelector('.dmn-digit-pop')).toBeNull();
    expect(input.classList.contains('dmn-digit-pop-host')).toBe(false);
  });

  it('손을 떼도 재생하지 않는다', async () => {
    act(() => root.render(<NumberInput value={19} onChange={() => {}} />));
    const input = container.querySelector('input')!;
    act(() => input.focus());

    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    await nextFrame();
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    await nextFrame();
    expect(input.value).toBe('21');
    expect(container.querySelector('.dmn-digit-pop')).toBeNull();

    act(() => releaseKey(input, 'ArrowUp'));

    // 꾹 눌러 이동하는 구간은 처음부터 끝까지 값만 움직인다
    expect(input.value).toBe('21');
    expect(container.querySelector('.dmn-digit-pop')).toBeNull();
  });

  it('꾹 누르는 동안에도 프레임마다 최신 값이 캔버스로 나간다', async () => {
    const preview = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          value={0}
          max={999}
          onChange={() => {}}
          onPreview={preview}
          commitStrategy="sync"
        />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => input.focus());

    for (let i = 0; i < 6; i += 1) {
      act(() => pressKey(input, 'ArrowUp', { repeat: true }));
      await nextFrame();
    }

    expect(input.value).toBe('6');
    // 프레임당 한 번. 스텝을 건너뛰거나 미루지 않는다
    expect(preview).toHaveBeenCalledTimes(6);
    expect(preview).toHaveBeenLastCalledWith(6);
  });

  it('떼는 순간 밀려 있던 스텝도 함께 반영한다', () => {
    const preview = vi.fn();
    act(() =>
      root.render(
        <NumberInput
          value={585}
          onChange={() => {}}
          onPreview={preview}
          commitStrategy="sync"
        />,
      ),
    );
    const input = container.querySelector('input')!;
    act(() => input.focus());

    // 프레임이 오기 전에 손을 뗀다
    act(() => pressKey(input, 'ArrowUp', { repeat: true }));
    act(() => releaseKey(input, 'ArrowUp'));

    expect(input.value).toBe('586');
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith(586);
  });
});

describe('ColorInput deferred picker mount', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    colorInputHarness.pickerProps = null;
    colorInputHarness.gradientOptions = null;
    colorInputHarness.cancelGradientPreview.mockClear();
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

  it('기본 전략은 스와치 열림 표시를 먼저 반영하고 피커 mount를 미룬다', async () => {
    act(() => root.render(<ColorInput value="#ffffff" onChange={() => {}} />));
    const button = container.querySelector('button')!;

    act(() => button.click());

    expect(button.className).toContain('shadow-focus-ring');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="color-picker"]')).toBeNull();
    await flushAfterPaintCommit();
    expect(
      container.querySelector('[data-testid="color-picker"]'),
    ).not.toBeNull();
  });

  it('배치 Mixed 신호를 hex·알파로 나눠 피커에 넘긴다', () => {
    act(() =>
      root.render(
        <ColorInput
          value="#ffffff"
          onChange={() => {}}
          pickerMountStrategy="sync"
          hexMixed
          alphaMixed={false}
        />,
      ),
    );
    act(() => container.querySelector('button')!.click());

    const picker = container.querySelector('[data-testid="color-picker"]')!;
    expect(picker.getAttribute('data-hex-mixed')).toBe('true');
    expect(picker.getAttribute('data-alpha-mixed')).toBeNull();
  });

  it('ColorPicker preview와 complete를 부모 preview와 commit 채널로 분리한다', () => {
    const onPreview = vi.fn();
    const onChange = vi.fn();
    const onChangeComplete = vi.fn();
    act(() =>
      root.render(
        <ColorInput
          value="#ffffff"
          onPreview={onPreview}
          onChange={onChange}
          onChangeComplete={onChangeComplete}
          pickerMountStrategy="sync"
        />,
      ),
    );
    act(() => container.querySelector('button')!.click());
    const picker = colorInputHarness.pickerProps as {
      onColorChange: (color: string) => void;
      onColorChangeComplete: (color: string) => void;
    };

    act(() => picker.onColorChange('#112233'));
    expect(onPreview).toHaveBeenCalledWith('#112233');
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeComplete).not.toHaveBeenCalled();

    act(() => picker.onColorChangeComplete('#112233'));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('#112233');
    expect(onChangeComplete).toHaveBeenCalledWith('#112233');
  });

  it('피커 입력 cancel은 로컬 gradient draft와 부모 gesture를 함께 취소한다', () => {
    const onCancel = vi.fn();
    act(() =>
      root.render(
        <ColorInput
          value="#ffffff"
          onChange={() => {}}
          onCancel={onCancel}
          pickerMountStrategy="sync"
        />,
      ),
    );
    act(() => container.querySelector('button')!.click());
    const picker = colorInputHarness.pickerProps as {
      onInputCancel: (target: 'solid', restoredColor: string) => void;
    };

    act(() => picker.onInputCancel('solid', '#abcdef'));

    expect(colorInputHarness.cancelGradientPreview).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('gradient mode preview는 ColorModeValue를 그대로 onModePreview에 전달한다', () => {
    const onModePreview = vi.fn();
    act(() =>
      root.render(
        <ColorInput
          value="#ffffff"
          onChange={() => {}}
          gradientValue={null}
          onModeCommit={() => {}}
          onModePreview={onModePreview}
        />,
      ),
    );
    const preview = colorInputHarness.gradientOptions?.onPreview as (
      value: unknown,
    ) => void;
    const value = {
      mode: 'gradient' as const,
      spec: {
        angle: 180,
        stops: [
          { color: '#112233', pos: 0 },
          { color: '#445566', pos: 1 },
        ],
      },
    };

    act(() => preview(value));

    expect(onModePreview).toHaveBeenCalledWith('idle', value);
  });

  it('sync 전략은 클릭 이벤트에서 피커를 즉시 mount한다', () => {
    act(() =>
      root.render(
        <ColorInput
          value="#ffffff"
          onChange={() => {}}
          pickerMountStrategy="sync"
        />,
      ),
    );
    const button = container.querySelector('button')!;

    act(() => button.click());

    expect(
      container.querySelector('[data-testid="color-picker"]'),
    ).not.toBeNull();
  });

  it('mount 예약 중 다시 닫으면 피커를 만들지 않는다', async () => {
    act(() => root.render(<ColorInput value="#ffffff" onChange={() => {}} />));
    const button = container.querySelector('button')!;

    act(() => button.click());
    act(() => button.click());
    await flushAfterPaintCommit();

    expect(container.querySelector('[data-testid="color-picker"]')).toBeNull();
    expect(button.className).not.toContain('shadow-focus-ring');
  });
});

describe('FontStyleToggle visual-first commit', () => {
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

  it('스타일 버튼을 즉시 표시하고 부모 commit은 paint 뒤 실행한다', async () => {
    const onBoldChange = vi.fn();
    act(() =>
      root.render(
        <FontStyleToggle
          isBold={false}
          isItalic={false}
          isUnderline={false}
          isStrikethrough={false}
          onBoldChange={onBoldChange}
          onItalicChange={() => {}}
          onUnderlineChange={() => {}}
          onStrikethroughChange={() => {}}
        />,
      ),
    );
    const bold = container.querySelector<HTMLButtonElement>('[title="Bold"]')!;

    act(() => bold.click());

    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(onBoldChange).not.toHaveBeenCalled();
    await flushAfterPaintCommit();
    expect(onBoldChange).toHaveBeenCalledWith(true);
  });

  it.each([
    ['onBoldChange', true, 'fontWeight', 700],
    ['onBoldChange', false, 'fontWeight', 400],
    ['onItalicChange', true, 'fontItalic', true],
    ['onUnderlineChange', false, 'fontUnderline', false],
    ['onStrikethroughChange', true, 'fontStrikethrough', true],
  ] as const)(
    '%s는 outer font style one-leaf %s=%s로 변환한다',
    (handlerName, input, property, value) => {
      const onChange = vi.fn();
      const handlers = createFontStyleToggleHandlers(onChange);

      handlers[handlerName](input);

      expect(onChange).toHaveBeenCalledWith(property, value);
    },
  );
});
