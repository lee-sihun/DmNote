// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import CounterAnimationEditorModal from './CounterAnimationEditorModal';

import type { CounterAnimationPreset } from '@src/types/key/counterAnimation';

interface CounterAnimationSavePayload {
  preset: CounterAnimationPreset;
  mode: 'create' | 'edit';
  affectedUsageCount: number;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  submit: null as null | (() => void),
  create: vi.fn(),
  update: vi.fn(),
  authorityUpdate: vi.fn(),
}));

vi.mock('@api/modules/resourceApi', () => ({
  counterAnimationApi: {
    create: (...args: unknown[]) => mocks.create(...args),
    update: (...args: unknown[]) => mocks.update(...args),
  },
}));
vi.mock('@plugins/runtime/displayElement/pluginElementActions', () => ({
  updateCounterAnimationPresetViaAuthority: (...args: unknown[]) =>
    mocks.authorityUpdate(...args),
}));

// 저장 버튼은 레이아웃이 들고 있다. 콜백을 밖으로 꺼내 눌러본다
vi.mock('@components/main/Modal/FullSurfaceModalLayout', () => ({
  default: ({
    children,
    onSubmit,
  }: {
    children: React.ReactNode;
    onSubmit: () => void;
  }) => {
    mocks.submit = onSubmit;
    return <>{children}</>;
  },
}));
vi.mock('@components/main/common/Dropdown', () => ({ default: () => null }));
vi.mock(
  '@components/main/Grid/PropertiesPanel/controls/PropertyInputs',
  () => ({
    TextInput: () => null,
    NumberInput: () => null,
  }),
);
vi.mock('@components/overlay/counters/CountDisplay', () => ({
  default: () => null,
}));

const PRESET: CounterAnimationPreset = {
  id: 'preset-1',
  name: 'pop',
  source: 'user',
  bezier: [0.4, 0, 0.2, 1],
  scale: 1.2,
  durationMs: 300,
} as CounterAnimationPreset;

// 가드는 피커의 onSaved 안에 있다. 그러니 자산 작업(preset 저장)이 onSaved보다
// 먼저 끝난다는 사실을 여기서 고정해야 "자산은 남기고 연결만 버린다"가 증명된다
describe('CounterAnimationEditorModal 저장 순서', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onSaved: Mock<(payload: CounterAnimationSavePayload) => void>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let resolveSave: (value: unknown) => void;

  const deferred = () =>
    vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

  const mount = (
    mode: 'create' | 'edit',
    initialPreset: CounterAnimationPreset | null,
  ) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <CounterAnimationEditorModal
          isOpen
          mode={mode}
          initialPreset={initialPreset}
          onClose={() => undefined}
          onSaved={onSaved}
          t={(key: string) => key}
        />,
      );
    });
  };

  // 생성 모드는 이름이 비어 있으면 저장이 잠긴다
  const typeName = (value: string) => {
    const input = host.querySelector<HTMLInputElement>('input[type=text]')!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const settle = async () => {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  };

  beforeEach(() => {
    onSaved = vi.fn();
    create = mocks.create;
    update = mocks.update;
    create.mockReset().mockImplementation(deferred());
    update.mockReset().mockImplementation(deferred());
    mocks.authorityUpdate.mockReset();
    mocks.submit = null;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        css: {
          get: vi.fn().mockResolvedValue({ content: '' }),
          getUse: vi.fn().mockResolvedValue(false),
          tab: { getAll: vi.fn().mockResolvedValue({}) },
        },
        counterAnimation: { create, update },
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('생성은 저장 API가 끝난 뒤에만 onSaved를 부른다', async () => {
    mount('create', null);
    typeName('my motion');

    act(() => mocks.submit?.());
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave({ preset: PRESET, affectedUsageCount: 0 });
      await settle();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0]).toMatchObject({ mode: 'create' });
  });

  it('편집은 갱신 API가 끝난 뒤에만 onSaved를 부른다', async () => {
    mount('edit', PRESET);

    act(() => mocks.submit?.());
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave({ preset: PRESET, affectedUsageCount: 3 });
      await settle();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0]).toMatchObject({ mode: 'edit' });
  });
});
