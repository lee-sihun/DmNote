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

import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';
import { useKeyStore } from '@stores/data/useKeyStore';
import type { KeyCounterAnimationSettings } from '@src/types/key/keys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  savePreset: null as null | ((payload: unknown) => void),
  menuSelect: null as null | ((id: string) => void),
  remove: vi.fn(),
  authorityDelete: vi.fn(),
}));

vi.mock('./CommonListPickerPage', () => ({ default: () => null }));
vi.mock('@components/main/Modal/listPopup/ListPopup', () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => {
    mocks.menuSelect = onSelect;
    return null;
  },
}));
vi.mock('@hooks/usePickerItemMenu', () => ({
  usePickerItemMenu: () => ({
    menuKey: 'preset-user',
    renderKey: 'preset-user',
    renderPosition: null,
    open: vi.fn(),
    openFromButton: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock('@plugins/runtime/displayElement/pluginElementActions', () => ({
  deleteCounterAnimationPresetViaAuthority: (...args: unknown[]) =>
    mocks.authorityDelete(...args),
}));
// 편집 모달의 저장 콜백을 밖으로 꺼낸다
vi.mock('../editors/CounterAnimationEditorModal', () => ({
  default: ({ onSaved }: { onSaved: (payload: unknown) => void }) => {
    mocks.savePreset = onSaved;
    return null;
  },
}));

import CounterAnimationPicker from './CounterAnimationPicker';

const PRESET = {
  id: 'preset-new',
  name: 'pop',
  source: 'user',
  bezier: [0.4, 0, 0.2, 1],
  scale: 1.2,
  duration: 300,
} as never;

const ANIMATION = { enabled: true } as unknown as KeyCounterAnimationSettings;

// preset 생성 자체는 라이브러리 작업이라 끝내야 한다.
// 모드가 갈렸을 때 버리는 것은 그 preset을 대상에 적용하는 마지막 한 걸음뿐이다
describe('CounterAnimationPicker 저장 완료와 모드 전환', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onAnimationChange: Mock<(next: KeyCounterAnimationSettings) => void>;
  let list: Mock<() => Promise<unknown>>;

  const settle = async () => {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  };

  const savePreset = async () => {
    await act(async () => {
      mocks.savePreset?.({
        preset: PRESET,
        mode: 'create',
        affectedUsageCount: 0,
      });
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  };

  beforeEach(async () => {
    onAnimationChange = vi.fn();
    list = vi.fn(async () => ({ builtinPresets: [], userPresets: [] }));
    mocks.remove.mockReset().mockResolvedValue({ success: true });
    mocks.authorityDelete.mockReset().mockResolvedValue({ success: true });
    mocks.savePreset = null;
    useKeyStore.setState({ selectedKeyType: '4key' });
    window.api = {
      counterAnimation: { list, remove: mocks.remove },
      ui: { dialog: { confirm: vi.fn(async () => true) } },
    } as never;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await mountPicker();
  });

  const mountPicker = async (
    completionBinding?: 'session-mode' | 'element-id',
  ) => {
    act(() => {
      root.render(
        <EditSessionScope>
          <CounterAnimationPicker
            open
            animation={ANIMATION}
            onAnimationChange={onAnimationChange}
            t={(key: string) => key}
            pageTitle="animation"
            onBack={vi.fn()}
            completionBinding={completionBinding}
          />
        </EditSessionScope>,
      );
    });
    await settle();
    list.mockClear();
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('모드가 그대로면 저장한 모션을 대상에 적용한다', async () => {
    await savePreset();

    expect(onAnimationChange).toHaveBeenCalled();
  });

  it('저장 대기 중 모드가 바뀌면 적용하지 않는다', async () => {
    act(() => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });

    await savePreset();

    // 라이브러리 갱신은 그대로 진행한다
    expect(list).toHaveBeenCalled();
    expect(onAnimationChange).not.toHaveBeenCalled();
  });

  // element-id 결합은 유효성 판정을 ID applier에 위임한다
  it('element-id 결합이면 모드가 바뀌어도 저장한 모션을 콜백에 전달한다', async () => {
    await mountPicker('element-id');
    act(() => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });

    await savePreset();

    expect(onAnimationChange).toHaveBeenCalled();
  });
});
