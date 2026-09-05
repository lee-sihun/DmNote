// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { NumberInput, OptionalNumberInput } from './NumberInput';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressKey = (
  input: HTMLInputElement,
  key: string,
  init: KeyboardEventInit = {},
  staleMs?: number,
) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (staleMs !== undefined) {
    Object.defineProperty(event, 'timeStamp', {
      value: event.timeStamp - staleMs,
    });
  }
  input.dispatchEvent(event);
  return event;
};

const releaseKey = (input: HTMLInputElement, key: string) => {
  input.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
};

interface CallbackLog {
  onChange: (value?: number) => void;
  onPreview: (value?: number) => void;
  onBlur: (value?: number) => void;
  onCancel: () => void;
}

const createCallbackLog = () => {
  const entries: string[] = [];
  const formatValue = (value?: number) => value ?? 'unset';
  const callbacks: CallbackLog = {
    onChange: (value) => entries.push(`change:${formatValue(value)}`),
    onPreview: (value) => entries.push(`preview:${formatValue(value)}`),
    onBlur: (value) => entries.push(`blur:${formatValue(value)}`),
    onCancel: () => entries.push('cancel'),
  };
  return { entries, callbacks };
};

const withRenderedInput = (
  renderInput: (callbacks: CallbackLog) => React.ReactNode,
  run: (input: HTMLInputElement, entries: string[]) => void,
) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const { entries, callbacks } = createCallbackLog();
  act(() => root.render(renderInput(callbacks)));
  const input = container.querySelector('input')!;
  try {
    run(input, entries);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
};

type InputKind = 'required' | 'optional';

const renderCommonInput = (kind: InputKind, callbacks: CallbackLog) =>
  kind === 'required' ? (
    <NumberInput
      value={10}
      commitStrategy="sync"
      onChange={callbacks.onChange}
      onPreview={callbacks.onPreview}
      onBlur={callbacks.onBlur}
      onCancel={callbacks.onCancel}
    />
  ) : (
    <OptionalNumberInput
      value={10}
      commitStrategy="sync"
      onChange={callbacks.onChange}
      onPreview={callbacks.onPreview}
      onBlur={callbacks.onBlur}
      onCancel={callbacks.onCancel}
    />
  );

describe('숫자 편집 세션 공통 정책', () => {
  it.each([
    {
      name: '숫자 preview 뒤 blur 확정',
      action: (input: HTMLInputElement) => {
        setInputValue(input, '12');
        input.blur();
      },
      // 부모 prop을 갱신하지 않는 harness에서는 blur effect가 기존 값을 다시 표시
      value: '10',
      log: ['preview:12', 'change:12', 'blur:12'],
    },
    {
      name: '수식 Enter 확정',
      action: (input: HTMLInputElement) => {
        setInputValue(input, '2+3');
        pressKey(input, 'Enter');
      },
      value: '10',
      log: ['change:5', 'blur:5'],
    },
    {
      name: 'Escape preview 취소',
      action: (input: HTMLInputElement) => {
        setInputValue(input, '12');
        pressKey(input, 'Escape');
      },
      value: '10',
      log: ['preview:12', 'cancel'],
    },
    {
      name: '방향키 preview 뒤 blur 확정',
      action: (input: HTMLInputElement) => {
        pressKey(input, 'ArrowUp');
        input.blur();
      },
      value: '10',
      log: ['preview:11', 'change:11', 'blur:11'],
    },
    {
      name: 'held key 최종값 flush 뒤 blur 확정',
      action: (input: HTMLInputElement) => {
        pressKey(input, 'ArrowUp', { repeat: true });
        pressKey(input, 'ArrowUp', { repeat: true });
        releaseKey(input, 'ArrowUp');
        input.blur();
      },
      value: '10',
      log: ['preview:12', 'change:12', 'blur:12'],
    },
    {
      name: '묵은 repeat 폐기',
      action: (input: HTMLInputElement) => {
        pressKey(input, 'ArrowUp', { repeat: true }, 400);
      },
      value: '10',
      log: [],
    },
  ])(
    '$name의 순서와 표시값이 양 컴포넌트에서 같다',
    ({ action, value, log }) => {
      const outcomes: Array<{ value: string; log: string[] }> = [];

      for (const kind of ['required', 'optional'] as const) {
        withRenderedInput(
          (callbacks) => renderCommonInput(kind, callbacks),
          (input, entries) => {
            act(() => input.focus());
            act(() => action(input));
            outcomes.push({ value: input.value, log: [...entries] });
          },
        );
      }

      expect(outcomes).toEqual([
        { value, log },
        { value, log },
      ]);
    },
  );
});

describe('숫자 편집 세션 차이 정책', () => {
  it.each([
    {
      name: 'required 빈 draft는 취소',
      render: (callbacks: CallbackLog) => (
        <NumberInput
          value={10}
          commitStrategy="sync"
          onChange={callbacks.onChange}
          onPreview={callbacks.onPreview}
          onBlur={callbacks.onBlur}
          onCancel={callbacks.onCancel}
        />
      ),
      action: (input: HTMLInputElement) => {
        setInputValue(input, '');
        input.blur();
      },
      value: '10',
      log: ['cancel'],
    },
    {
      name: 'optional 빈 draft는 unset',
      render: (callbacks: CallbackLog) => (
        <OptionalNumberInput
          value={10}
          commitStrategy="sync"
          onChange={callbacks.onChange}
          onPreview={callbacks.onPreview}
          onBlur={callbacks.onBlur}
          onCancel={callbacks.onCancel}
        />
      ),
      action: (input: HTMLInputElement) => {
        setInputValue(input, '');
        input.blur();
      },
      value: '10',
      log: ['preview:unset', 'change:unset', 'blur:unset'],
    },
    {
      name: 'required는 음수 min 허용',
      render: (callbacks: CallbackLog) => (
        <NumberInput
          value={0}
          min={-5}
          commitStrategy="sync"
          onChange={callbacks.onChange}
          onPreview={callbacks.onPreview}
          onBlur={callbacks.onBlur}
        />
      ),
      action: (input: HTMLInputElement) => {
        setInputValue(input, '-2');
        input.blur();
      },
      value: '0',
      log: ['preview:-2', 'change:-2', 'blur:-2'],
    },
    {
      name: 'optional allowNegative=false는 domainMin 0',
      render: (callbacks: CallbackLog) => (
        <OptionalNumberInput
          value={0}
          min={-5}
          commitStrategy="sync"
          onChange={callbacks.onChange}
          onPreview={callbacks.onPreview}
          onBlur={callbacks.onBlur}
        />
      ),
      action: (input: HTMLInputElement) => {
        setInputValue(input, '-2');
        input.blur();
      },
      value: '0',
      log: ['preview:0', 'change:0', 'blur:0'],
    },
    {
      name: 'optional placeholder는 unset step 기준',
      render: (callbacks: CallbackLog) => (
        <OptionalNumberInput
          placeholder="16px"
          commitStrategy="sync"
          onChange={callbacks.onChange}
          onPreview={callbacks.onPreview}
          onBlur={callbacks.onBlur}
        />
      ),
      action: (input: HTMLInputElement) => {
        pressKey(input, 'ArrowUp');
        input.blur();
      },
      value: '',
      log: ['preview:17', 'change:17', 'blur:17'],
    },
    {
      name: 'required string value와 custom step 유지',
      render: (callbacks: CallbackLog) => (
        <NumberInput
          value="1.5"
          step={0.5}
          allowDecimal
          commitStrategy="sync"
          onChange={callbacks.onChange}
          onPreview={callbacks.onPreview}
          onBlur={callbacks.onBlur}
        />
      ),
      action: (input: HTMLInputElement) => {
        pressKey(input, 'ArrowUp');
        input.blur();
      },
      value: '1.5',
      log: ['preview:2', 'change:2', 'blur:2'],
    },
  ])('$name', ({ render, action, value, log }) => {
    withRenderedInput(render, (input, entries) => {
      act(() => input.focus());
      act(() => action(input));
      expect(input.value).toBe(value);
      expect(entries).toEqual(log);
    });
  });

  it('required 전용 disabled와 ariaLabel 계약을 유지한다', () => {
    withRenderedInput(
      (callbacks) => (
        <NumberInput
          value={10}
          disabled
          ariaLabel="폭"
          onChange={callbacks.onChange}
        />
      ),
      (input, entries) => {
        expect(input.disabled).toBe(true);
        expect(input.getAttribute('aria-label')).toBe('폭');
        expect(entries).toEqual([]);
      },
    );
  });
});
