import React, { act, useState } from 'react';
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
import type { SoundListItem } from '@src/types/plugin/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  saveTrim: null as null | ((soundPath: string) => void),
  openMenu: null as null | ((key: string) => void),
  selectMenuItem: null as null | ((id: string) => void),
}));
const apiMocks = vi.hoisted(() => ({ remove: vi.fn() }));

vi.mock('@api/modules/resourceApi', () => ({
  soundApi: {
    remove: (...args: unknown[]) => apiMocks.remove(...args),
  },
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./CommonListPickerPage', () => ({ default: () => null }));
// 메뉴 열림 상태를 테스트가 조종할 수 있게 한다
vi.mock('@hooks/usePickerItemMenu', () => ({
  usePickerItemMenu: () => {
    const [menuKey, setMenuKey] = useState<string | null>(null);
    mocks.openMenu = setMenuKey;
    return {
      menuKey,
      renderKey: menuKey,
      renderPosition: null,
      open: vi.fn(),
      openFromButton: vi.fn(),
      close: () => setMenuKey(null),
    };
  },
}));
vi.mock('@components/main/Modal/ListPopup', () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => {
    mocks.selectMenuItem = onSelect;
    return null;
  },
}));
// 트림 모달의 저장 콜백을 밖으로 꺼낸다
vi.mock('../managers/SoundTrimModal', () => ({
  default: ({ onSaved }: { onSaved: (soundPath: string) => void }) => {
    mocks.saveTrim = onSaved;
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
} as SoundListItem;

// 자산 작업(백엔드 삭제, 파일 저장)은 끝내고, 옛 세션에 연결하는 마지막 콜백만
// 버려야 한다. 가드가 API 호출 앞으로 올라가면 삭제 테스트가 깨진다
describe('SoundPicker 비동기 완료와 모드 전환', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSoundSelect: Mock<(soundPath: string | null) => void>;
  let remove: Mock<(soundPath: string) => Promise<void>>;
  let resolveConfirm: (value: boolean) => void;

  const switchMode = () => {
    act(() => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });
  };

  const runDelete = async () => {
    act(() => mocks.openMenu?.(SOUND.soundPath));
    act(() => mocks.selectMenuItem?.('delete'));
  };

  const settle = async () => {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  };

  beforeEach(async () => {
    onSoundSelect = vi.fn();
    remove = apiMocks.remove;
    remove.mockReset().mockResolvedValue(undefined);
    mocks.saveTrim = null;
    mocks.openMenu = null;
    mocks.selectMenuItem = null;
    useKeyStore.setState({ selectedKeyType: '4key' });
    window.api = {
      sound: {
        list: vi.fn(async () => [SOUND]),
        remove,
      },
      ui: {
        dialog: {
          confirm: vi.fn(
            () =>
              new Promise<boolean>((resolve) => {
                resolveConfirm = resolve;
              }),
          ),
        },
      },
    } as never;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await mountPicker();
  });

  const mountPicker = async (
    completionBinding?: 'session-mode' | 'element-id',
    selectedSound: string | null = SOUND.soundPath,
  ) => {
    act(() => {
      root.render(
        <EditSessionScope>
          <SoundPicker
            open
            selectedSound={selectedSound}
            onSoundSelect={onSoundSelect}
            pageTitle="sound"
            onBack={vi.fn()}
            completionBinding={completionBinding}
          />
        </EditSessionScope>,
      );
    });
    await settle();
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('저장 완료 뒤 모드가 그대로면 사운드를 연결한다', () => {
    act(() => mocks.saveTrim?.('sounds/new.wav'));

    expect(onSoundSelect).toHaveBeenCalledWith('sounds/new.wav');
  });

  it('저장 대기 중 모드가 바뀌면 연결하지 않는다', () => {
    switchMode();

    act(() => mocks.saveTrim?.('sounds/new.wav'));

    expect(onSoundSelect).not.toHaveBeenCalled();
  });

  it('삭제 확인 대기 중 모드가 바뀌어도 백엔드 삭제는 끝낸다', async () => {
    await runDelete();
    switchMode();

    await act(async () => {
      resolveConfirm(true);
      await settle();
    });

    expect(remove).toHaveBeenCalledWith(SOUND.soundPath);
    expect(onSoundSelect).not.toHaveBeenCalled();
  });

  it('삭제 후 참조 해제는 백엔드 canonical 동기화만 소유한다', async () => {
    await runDelete();

    await act(async () => {
      resolveConfirm(true);
      await settle();
    });

    expect(remove).toHaveBeenCalledWith(SOUND.soundPath);
    expect(onSoundSelect).not.toHaveBeenCalled();
  });

  // element-id 결합은 유효성 판정을 ID applier에 위임한다.
  // 가드 2곳(트림 저장, 삭제 후 해제) 모두 같은 조건으로 통과해야 한다
  it('element-id 결합이면 모드가 바뀌어도 트림 저장을 연결한다', async () => {
    await mountPicker('element-id');
    switchMode();

    act(() => mocks.saveTrim?.('sounds/new.wav'));

    expect(onSoundSelect).toHaveBeenCalledWith('sounds/new.wav');
  });

  it('element-id 결합이어도 삭제 후 중복 해제 콜백을 보내지 않는다', async () => {
    await mountPicker('element-id');
    await runDelete();
    switchMode();

    await act(async () => {
      resolveConfirm(true);
      await settle();
    });

    expect(remove).toHaveBeenCalledWith(SOUND.soundPath);
    expect(onSoundSelect).not.toHaveBeenCalled();
  });

  it('삭제 응답 대기 중 선택한 새 사운드를 지우지 않는다', async () => {
    let finishRemove: (() => void) | undefined;
    remove.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRemove = resolve;
        }),
    );
    await mountPicker('element-id');
    await runDelete();

    await act(async () => {
      resolveConfirm(true);
      await Promise.resolve();
    });
    expect(remove).toHaveBeenCalledWith(SOUND.soundPath);

    await mountPicker('element-id', 'sounds/new.wav');
    await act(async () => {
      finishRemove?.();
      await settle();
    });

    expect(onSoundSelect).not.toHaveBeenCalled();
  });
});
