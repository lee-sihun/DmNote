import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: ({ footerSlot }: { footerSlot?: React.ReactNode }) => (
    <div data-testid="color-picker">{footerSlot}</div>
  ),
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
  useGradientColorState: () => ({
    pickerColor: '#ffffff',
    headerSlot: null,
    footerSlot: <span>gradient-controls</span>,
    paletteGradientSpec: null,
    handlePickerColorChange: vi.fn(),
    handleGradientSpecSelect: vi.fn(),
  }),
}));

import {
  ColorInput,
  FontStyleToggle,
  NumberInput,
  OptionalNumberInput,
  TextInput,
} from './PropertyInputs';
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

  it('유효하지 않은 중간 문자로 blur해도 직전 유효값은 보존한다', () => {
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
    expect(commit).toHaveBeenCalledWith(2);
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

describe('ColorInput detached gradient guidance', () => {
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
    window.__dmn_window_type = 'main';
  });

  it('분리 창에서 온캔버스 핸들 재부착 안내를 표시한다', () => {
    window.__dmn_window_type = 'panel';
    act(() =>
      root.render(
        <ColorInput
          value="#ffffff"
          onChange={() => {}}
          isOpen
          onToggle={() => {}}
          onModeCommit={() => {}}
          canvasAnchor={{ kind: 'key', index: 0 }}
        />,
      ),
    );

    expect(container.textContent).toContain(
      'propertiesPanel.detachedGradientHint',
    );
  });
});

describe('ColorInput deferred picker mount', () => {
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
});
