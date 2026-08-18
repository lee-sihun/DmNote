import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';
import { useKeyStore } from '@stores/data/useKeyStore';
import type { KeyCounterAnimationSettings } from '@src/types/key/keys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  onAdd: null as null | (() => void),
  menuSelect: null as null | ((id: string) => void),
  editorRendered: vi.fn(),
  openRemoteSheet: vi.fn<(spec: unknown) => Promise<Record<string, unknown>>>(),
}));

vi.mock('./CommonListPickerPage', () => ({
  default: ({ onAdd }: { onAdd: () => void }) => {
    mocks.onAdd = onAdd;
    return null;
  },
}));
vi.mock('@components/main/Modal/ListPopup', () => ({
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
vi.mock('@plugins/rpc/pluginElementActions', () => ({
  deleteCounterAnimationPresetViaAuthority: vi.fn(),
}));
vi.mock('@stores/grid/useRemoteSheetStore', () => ({
  openRemoteSheet: (spec: unknown) => mocks.openRemoteSheet(spec),
}));
vi.mock('../editors/CounterAnimationEditorModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => {
    mocks.editorRendered(isOpen);
    return null;
  },
}));

import CounterAnimationPicker from './CounterAnimationPicker';

const PRESET = {
  id: 'preset-user',
  name: 'pop',
  source: 'user',
  bezier: [0.4, 0, 0.2, 1],
  scale: 1.2,
  durationMs: 300,
} as never;
const ANIMATION = { enabled: true } as unknown as KeyCounterAnimationSettings;

describe('CounterAnimationPicker 분리 패널의 원격 시트', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onAnimationChange: ReturnType<
    typeof vi.fn<(next: KeyCounterAnimationSettings) => void>
  >;
  let list: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  const originalWindowType = window.__dmn_window_type;

  const settle = async () => {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  };

  beforeEach(async () => {
    window.__dmn_window_type = 'panel';
    onAnimationChange = vi.fn();
    list = vi.fn(async () => ({ builtinPresets: [], userPresets: [PRESET] }));
    mocks.editorRendered.mockClear();
    mocks.openRemoteSheet.mockReset();
    useKeyStore.setState({ selectedKeyType: '4key' });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        counterAnimation: { list },
        ui: { dialog: { confirm: vi.fn(async () => true) } },
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
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
            completionBinding="element-id"
          />
        </EditSessionScope>,
      );
    });
    await settle();
    list.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.__dmn_window_type = originalWindowType;
  });

  it('추가는 메인 창에 시트를 요청하고, 저장 결과로 라이브러리를 다시 읽어 적용한다', async () => {
    let resolveSheet: (result: Record<string, unknown>) => void = () => {};
    mocks.openRemoteSheet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSheet = resolve;
        }),
    );

    act(() => mocks.onAdd?.());
    expect(mocks.openRemoteSheet).toHaveBeenCalledWith({
      kind: 'counterAnimation',
      mode: 'create',
      preset: null,
      counterSettings: undefined,
      keyVisual: undefined,
    });
    // 로컬 시트는 열리지 않는다
    expect(mocks.editorRendered).not.toHaveBeenCalledWith(true);

    await act(async () => {
      resolveSheet({
        requestId: 'r1',
        status: 'saved',
        kind: 'counterAnimation',
        payload: { preset: PRESET, mode: 'create', affectedUsageCount: 0 },
      });
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(onAnimationChange).toHaveBeenCalledTimes(1);
  });

  it('편집은 프리셋을 실어 보내고, 취소면 아무것도 적용하지 않는다', async () => {
    mocks.openRemoteSheet.mockResolvedValue({
      requestId: 'r2',
      status: 'cancelled',
    });
    act(() => mocks.menuSelect?.('edit'));
    expect(mocks.openRemoteSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'counterAnimation',
        mode: 'edit',
        preset: PRESET,
      }),
    );
    await settle();
    expect(list).not.toHaveBeenCalled();
    expect(onAnimationChange).not.toHaveBeenCalled();
  });
});
