import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultNoteSettings } from '@src/renderer/defaults';
import type { TabNoteResponse } from '@src/types/plugin/api';
import type {
  NoteSettings,
  TabNoteSettings,
} from '@src/types/settings/noteSettings';

const testState = vi.hoisted(() => ({
  selectedKeyType: 'tab-a',
  noteEffect: true,
  noteSettings: null as unknown,
}));
const apiMocks = vi.hoisted(() => ({ noteTabSet: vi.fn() }));

vi.mock('@api/modules/editor/noteTabApi', () => ({
  noteTabApi: {
    set: (...args: unknown[]) => apiMocks.noteTabSet(...args),
  },
}));

vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: (selector: (state: { selectedKeyType: string }) => unknown) =>
    selector({ selectedKeyType: testState.selectedKeyType }),
}));

vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: (
    selector: (state: {
      noteEffect: boolean;
      noteSettings: unknown;
    }) => unknown,
  ) =>
    selector({
      noteEffect: testState.noteEffect,
      noteSettings: testState.noteSettings,
    }),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@hooks/ui/usePopupPresence', () => ({
  useModalPresence: (open: boolean) => ({
    mounted: open,
    state: 'open',
    cycle: open ? 1 : 0,
  }),
}));

vi.mock('../settings/NoteSetting', () => ({
  default: ({
    settings,
    onSave,
  }: {
    settings: NoteSettings;
    onSave: (settings: NoteSettings) => Promise<void>;
  }) => (
    <div data-note-speed={settings.speed}>
      <button type="button" onClick={() => void onSave(settings)}>
        저장
      </button>
    </div>
  ),
}));

import TabNoteSettingModal from './TabNoteSettingModal';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe('TabNoteSettingModal 로드 세대', () => {
  let container: HTMLDivElement;
  let root: Root;
  let noteTabGet: ReturnType<typeof vi.fn>;
  let noteTabSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    testState.selectedKeyType = 'tab-a';
    testState.noteEffect = true;
    testState.noteSettings = getDefaultNoteSettings();
    noteTabGet = vi.fn();
    noteTabSet = apiMocks.noteTabSet;
    noteTabSet.mockReset().mockResolvedValue({ success: true, tabId: 'tab-b' });

    window.api = {
      noteTab: {
        get: noteTabGet,
        set: noteTabSet,
      },
    } as unknown as typeof window.api;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('닫힌 이전 탭의 늦은 응답을 버리고 현재 탭 설정만 저장한다', async () => {
    const first = deferred<TabNoteResponse>();
    const second = deferred<TabNoteResponse>();
    const globalSettings = testState.noteSettings as NoteSettings;
    const settingsA: TabNoteSettings = { speed: globalSettings.speed + 10 };
    const settingsB: TabNoteSettings = { speed: globalSettings.speed + 20 };
    const onClose = vi.fn();

    noteTabGet
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    await act(async () => {
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />);
    });

    await act(async () => {
      root.render(<TabNoteSettingModal isOpen={false} onClose={onClose} />);
    });

    testState.selectedKeyType = 'tab-b';
    await act(async () => {
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />);
    });

    await act(async () => {
      second.resolve({ tabId: 'tab-b', settings: settingsB });
      await Promise.resolve();
    });

    expect(
      container
        .querySelector('[data-note-speed]')
        ?.getAttribute('data-note-speed'),
    ).toBe(String(settingsB.speed));

    await act(async () => {
      first.resolve({ tabId: 'tab-a', settings: settingsA });
      await Promise.resolve();
    });

    expect(
      container
        .querySelector('[data-note-speed]')
        ?.getAttribute('data-note-speed'),
    ).toBe(String(settingsB.speed));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(noteTabSet).toHaveBeenCalledWith('tab-b', settingsB);
  });
});
