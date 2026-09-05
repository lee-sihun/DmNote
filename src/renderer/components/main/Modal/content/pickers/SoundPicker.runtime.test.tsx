// @vitest-environment jsdom
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
import type { SoundListItem } from '@src/types/plugin/api';

interface PickerPageCapture {
  open: boolean;
  items: SoundListItem[];
  isLoading: boolean;
  errorText: string;
  onAdd: () => void;
  onFilterChange: (value: string) => void;
  renderItem: (item: SoundListItem) => React.ReactNode;
}

interface TrimModalCapture {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (soundPath: string) => void;
}

const mocks = vi.hoisted(() => ({
  page: null as PickerPageCapture | null,
  trim: null as TrimModalCapture | null,
  openMenu: null as null | ((key: string) => void),
  selectMenuItem: null as null | ((id: string) => void),
  menuItems: [] as Array<{ id: string; label: string }>,
  menuClose: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  setHidden: vi.fn(),
}));

vi.mock('@api/modules/resourceApi', () => ({
  soundApi: {
    remove: (...args: unknown[]) => apiMocks.remove(...args),
    rename: (...args: unknown[]) => apiMocks.rename(...args),
    setHidden: (...args: unknown[]) => apiMocks.setHidden(...args),
  },
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./CommonListPickerPage', () => ({
  default: (props: PickerPageCapture) => {
    mocks.page = props;
    return (
      <div data-picker-open={String(props.open)}>
        {props.items.map((item) => props.renderItem(item))}
      </div>
    );
  },
}));

vi.mock('@hooks/usePickerItemMenu', () => ({
  usePickerItemMenu: () => {
    const [menuKey, setMenuKey] = useState<string | null>(null);
    mocks.openMenu = setMenuKey;
    const close = () => {
      mocks.menuClose();
      setMenuKey(null);
    };
    return {
      menuKey,
      renderKey: menuKey,
      renderPosition: null,
      capturePressState: vi.fn(),
      openFromButton: vi.fn(),
      openFromKeyboard: vi.fn(),
      openFromContextMenu: vi.fn(),
      close,
    };
  },
}));

vi.mock('@components/main/Modal/ListPopup', () => ({
  default: ({
    items,
    onSelect,
  }: {
    items: Array<{ id: string; label: string }>;
    onSelect: (id: string) => void;
  }) => {
    mocks.menuItems = items;
    mocks.selectMenuItem = onSelect;
    return null;
  },
}));

vi.mock('../managers/SoundTrimModal', () => ({
  default: (props: TrimModalCapture) => {
    mocks.trim = props;
    return null;
  },
}));

import SoundPicker from './SoundPicker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SOUND: SoundListItem = {
  soundPath: 'sounds/tick.wav',
  fileName: 'tick.wav',
  sizeBytes: 100,
  displayName: 'tick',
  source: 'local',
  hidden: false,
  enabled: true,
  originalPath: 'orig/tick.wav',
};

const OTHER_SOUND: SoundListItem = {
  soundPath: 'sounds/tock.wav',
  fileName: 'tock.wav',
  sizeBytes: 200,
  displayName: 'tock',
  source: 'local',
  hidden: false,
  enabled: true,
  originalPath: 'orig/tock.wav',
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const setNativeValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(input, value);
};

describe('SoundPicker library runtime contract', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSoundSelect: Mock<(soundPath: string | null) => void>;
  let currentOpen: boolean;
  let currentSelectedSound: string | null;

  const settle = async () => {
    await act(async () => {
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });
  };

  const render = async () => {
    await act(async () => {
      root.render(
        <SoundPicker
          open={currentOpen}
          selectedSound={currentSelectedSound}
          onSoundSelect={onSoundSelect}
          pageTitle="sound"
          onBack={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
  };

  const openMenuAction = async (id: string, soundPath = SOUND.soundPath) => {
    await act(async () => mocks.openMenu?.(soundPath));
    await act(async () => mocks.selectMenuItem?.(id));
  };

  const pageItems = () => mocks.page?.items ?? [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.page = null;
    mocks.trim = null;
    mocks.openMenu = null;
    mocks.selectMenuItem = null;
    mocks.menuItems = [];
    onSoundSelect = vi.fn();
    currentOpen = true;
    currentSelectedSound = SOUND.soundPath;
    apiMocks.list.mockResolvedValue([SOUND]);
    apiMocks.confirm.mockResolvedValue(false);
    apiMocks.remove.mockResolvedValue(undefined);
    apiMocks.rename.mockResolvedValue(undefined);
    apiMocks.setHidden.mockResolvedValue(undefined);
    window.api = {
      sound: { list: apiMocks.list },
      ui: { dialog: { confirm: apiMocks.confirm } },
    } as never;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('close/reopen generation은 이전 load 성공을 폐기하고 최신 응답만 반영한다', async () => {
    const stale = deferred<SoundListItem[]>();
    const latest = deferred<SoundListItem[]>();
    apiMocks.list
      .mockReset()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise);

    await render();
    currentOpen = false;
    await render();
    currentOpen = true;
    await render();

    latest.resolve([OTHER_SOUND]);
    await settle();
    expect(pageItems()).toEqual([OTHER_SOUND]);
    expect(mocks.page?.isLoading).toBe(false);

    stale.resolve([SOUND]);
    await settle();
    expect(pageItems()).toEqual([OTHER_SOUND]);
    expect(mocks.page?.errorText).toBe('');
    expect(apiMocks.list).toHaveBeenCalledTimes(2);
  });

  it('현재 load 실패만 오류와 loading 정산을 반영한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiMocks.list.mockReset().mockRejectedValueOnce(new Error('list failed'));

    await render();
    await settle();

    expect(mocks.page?.errorText).toBe('soundPicker.loadFailed');
    expect(mocks.page?.isLoading).toBe(false);
  });

  it('close는 메뉴만 닫고 rename·trim 상태는 reopen까지 유지한다', async () => {
    await render();
    await settle();
    await openMenuAction('rename');
    expect(container.querySelector('input[type="text"]')).not.toBeNull();

    act(() => mocks.page?.onAdd());
    expect(mocks.trim?.isOpen).toBe(true);
    currentOpen = false;
    await render();

    expect(mocks.menuClose).toHaveBeenCalled();
    expect(mocks.trim?.isOpen).toBe(true);
    expect(container.querySelector('input[type="text"]')).not.toBeNull();

    currentOpen = true;
    await render();
    expect(container.querySelector('input[type="text"]')).not.toBeNull();
    act(() => mocks.trim?.onClose());
    expect(mocks.trim?.isOpen).toBe(false);
  });

  it('선택 행은 빈 문자열로 해제하고 비선택 행은 raw path를 전달한다', async () => {
    await render();
    await settle();

    act(() => container.querySelector<HTMLElement>('[title="tick"]')?.click());
    expect(onSoundSelect).toHaveBeenLastCalledWith('');

    currentSelectedSound = null;
    await render();
    act(() => container.querySelector<HTMLElement>('[title="tick"]')?.click());
    expect(onSoundSelect).toHaveBeenLastCalledWith(SOUND.soundPath);
  });

  it('삭제 확인 pending은 같은 target의 중복 action을 막고 cancel 뒤 해제된다', async () => {
    const firstConfirm = deferred<boolean>();
    apiMocks.confirm
      .mockReset()
      .mockReturnValueOnce(firstConfirm.promise)
      .mockResolvedValueOnce(false);
    await render();
    await settle();

    await openMenuAction('delete');
    await openMenuAction('delete');
    expect(apiMocks.confirm).toHaveBeenCalledTimes(1);

    firstConfirm.resolve(false);
    await settle();
    await openMenuAction('delete');
    expect(apiMocks.confirm).toHaveBeenCalledTimes(2);
    expect(apiMocks.remove).not.toHaveBeenCalled();
  });

  it('삭제는 확인→optimistic 제거→API→reload 순서를 보존한다', async () => {
    const remove = deferred<void>();
    const events: string[] = [];
    apiMocks.confirm.mockImplementation(async () => {
      events.push('confirm');
      return true;
    });
    apiMocks.remove.mockImplementation(() => {
      events.push('remove');
      return remove.promise;
    });
    apiMocks.list
      .mockReset()
      .mockResolvedValueOnce([SOUND])
      .mockImplementationOnce(async () => {
        events.push('reload');
        return [OTHER_SOUND];
      });
    await render();
    await settle();

    await openMenuAction('delete');
    await settle();
    expect(pageItems()).toEqual([]);
    expect(events).toEqual(['confirm', 'remove']);

    remove.resolve();
    await settle();
    expect(events).toEqual(['confirm', 'remove', 'reload']);
    expect(pageItems()).toEqual([OTHER_SOUND]);
  });

  it('삭제 실패는 authoritative reload 뒤 전용 오류를 표시한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiMocks.confirm.mockResolvedValueOnce(true);
    apiMocks.remove.mockRejectedValueOnce(new Error('remove failed'));
    apiMocks.list.mockResolvedValueOnce([SOUND]).mockResolvedValueOnce([SOUND]);
    await render();
    await settle();
    await openMenuAction('delete');
    await settle();

    expect(pageItems()).toEqual([SOUND]);
    expect(mocks.page?.errorText).toBe('soundPicker.deleteFailed');
  });

  it('rename은 focus/current value·trim·optimistic update와 pending 상호 배제를 유지한다', async () => {
    const rename = deferred<void>();
    apiMocks.rename.mockReturnValueOnce(rename.promise);
    apiMocks.list
      .mockResolvedValueOnce([SOUND])
      .mockResolvedValueOnce([{ ...SOUND, displayName: 'renamed' }]);
    await render();
    await settle();
    await openMenuAction('rename');

    const input =
      container.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('tick');
    await act(async () => {
      setNativeValue(input, '  renamed  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(apiMocks.rename).toHaveBeenCalledWith(SOUND.soundPath, 'renamed');
    expect(pageItems()[0]?.displayName).toBe('renamed');
    await openMenuAction('toggle-hidden');
    expect(apiMocks.setHidden).not.toHaveBeenCalled();

    rename.resolve();
    await settle();
    expect(pageItems()[0]?.displayName).toBe('renamed');
  });

  it('rename 실패는 authoritative reload 뒤 전용 오류를 표시한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiMocks.rename.mockRejectedValueOnce(new Error('rename failed'));
    apiMocks.list.mockResolvedValueOnce([SOUND]).mockResolvedValueOnce([SOUND]);
    await render();
    await settle();
    await openMenuAction('rename');
    const input =
      container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      setNativeValue(input, 'broken');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
    });
    await settle();

    expect(pageItems()).toEqual([SOUND]);
    expect(mocks.page?.errorText).toBe('soundPicker.renameFailed');
  });

  it('hidden 성공은 optimistic filter와 exact boolean을, 실패는 reload 오류를 보존한다', async () => {
    const hide = deferred<void>();
    apiMocks.setHidden.mockReturnValueOnce(hide.promise);
    apiMocks.list
      .mockResolvedValueOnce([SOUND])
      .mockResolvedValueOnce([{ ...SOUND, hidden: true }]);
    await render();
    await settle();
    await openMenuAction('toggle-hidden');

    expect(apiMocks.setHidden).toHaveBeenCalledWith(SOUND.soundPath, true);
    expect(pageItems()).toEqual([]);
    hide.resolve();
    await settle();
    act(() => mocks.page?.onFilterChange('hidden'));
    expect(pageItems()).toEqual([{ ...SOUND, hidden: true }]);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiMocks.setHidden.mockRejectedValueOnce(new Error('unhide failed'));
    apiMocks.list.mockResolvedValueOnce([{ ...SOUND, hidden: true }]);
    await openMenuAction('toggle-hidden');
    await settle();
    expect(apiMocks.setHidden).toHaveBeenLastCalledWith(SOUND.soundPath, false);
    expect(mocks.page?.errorText).toBe('soundPicker.hideFailed');
  });
});
