import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';
import { useKeyStore } from '@stores/data/useKeyStore';
import type { SoundListItem } from '@src/types/plugin/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  onAdd: null as null | (() => void),
  openMenu: null as null | ((key: string) => void),
  selectMenuItem: null as null | ((id: string) => void),
  trimRendered: vi.fn(),
  openRemoteSheet: vi.fn<(spec: unknown) => Promise<Record<string, unknown>>>(),
}));

vi.mock('@api/modules/resourceApi', () => ({ soundApi: {} }));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./CommonListPickerPage', () => ({
  default: ({ onAdd }: { onAdd: () => void }) => {
    mocks.onAdd = onAdd;
    return null;
  },
}));
vi.mock('@hooks/usePickerItemMenu', () => ({
  usePickerItemMenu: () => ({
    menuKey: 'sounds/tick.wav',
    renderKey: 'sounds/tick.wav',
    renderPosition: null,
    open: vi.fn(),
    openFromButton: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock('@components/main/Modal/ListPopup', () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => {
    mocks.selectMenuItem = onSelect;
    return null;
  },
}));
vi.mock('@stores/grid/useRemoteSheetStore', () => ({
  openRemoteSheet: (spec: unknown) => mocks.openRemoteSheet(spec),
}));
vi.mock('../managers/SoundTrimModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => {
    mocks.trimRendered(isOpen);
    return null;
  },
}));

import SoundPicker from './SoundPicker';

const SOUND: SoundListItem = {
  soundPath: 'sounds/tick.wav',
  fileName: 'tick.wav',
  displayName: 'tick',
  source: 'local',
  hidden: false,
  originalPath: 'orig/tick.wav',
  trimStartRatio: 0.2,
  trimEndRatio: 0.8,
} as SoundListItem;

describe('SoundPicker 분리 패널의 원격 시트', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSoundSelect: ReturnType<
    typeof vi.fn<(soundPath: string | null) => void>
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
    onSoundSelect = vi.fn();
    list = vi.fn(async () => [SOUND]);
    mocks.trimRendered.mockClear();
    mocks.openRemoteSheet.mockReset();
    useKeyStore.setState({ selectedKeyType: '4key' });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { sound: { list } },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <EditSessionScope>
          <SoundPicker
            open
            selectedSound={null}
            onSoundSelect={onSoundSelect}
            pageTitle="sound"
            onBack={vi.fn()}
            previewVolume={0.4}
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

  it('추가는 파일 없이 메인 창에 요청하고, 저장 결과로 선택·재조회한다', async () => {
    mocks.openRemoteSheet.mockResolvedValue({
      requestId: 'r1',
      status: 'saved',
      kind: 'soundTrim',
      soundPath: 'sounds/new.wav',
    });
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clickSpy = vi.spyOn(fileInput, 'click');

    act(() => mocks.onAdd?.());
    expect(mocks.openRemoteSheet).toHaveBeenCalledWith({
      kind: 'soundTrim',
      mode: 'create',
      previewVolume: 0.4,
    });
    // 로컬 파일 대화상자와 로컬 시트는 열지 않는다
    expect(clickSpy).not.toHaveBeenCalled();
    expect(mocks.trimRendered).not.toHaveBeenCalledWith(true);

    await settle();
    expect(onSoundSelect).toHaveBeenCalledWith('sounds/new.wav');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('편집은 트림 정보를 실어 보내고, 취소면 아무것도 바꾸지 않는다', async () => {
    mocks.openRemoteSheet.mockResolvedValue({
      requestId: 'r2',
      status: 'cancelled',
    });
    act(() => mocks.selectMenuItem?.('edit'));
    expect(mocks.openRemoteSheet).toHaveBeenCalledWith({
      kind: 'soundTrim',
      mode: 'edit',
      previewVolume: 0.4,
      item: {
        soundPath: 'sounds/tick.wav',
        trimStartRatio: 0.2,
        trimEndRatio: 0.8,
        displayName: 'tick',
      },
    });
    await settle();
    expect(onSoundSelect).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
