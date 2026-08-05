import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: ({ footerSlot }: { footerSlot?: React.ReactNode }) => (
    <div>{footerSlot}</div>
  ),
}));

vi.mock('@components/main/Modal/content/pickers/ColorSwatch', () => ({
  ColorSwatchButton: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >((props, ref) => <button ref={ref} {...props} />),
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

import { ColorInput, TextInput } from './PropertyInputs';
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

describe('TextInput preview commit', () => {
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
