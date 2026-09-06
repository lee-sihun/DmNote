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
  keyMappings: {} as Record<string, unknown[]>,
  customTabs: [] as { id: string }[],
}));
const apiMocks = vi.hoisted(() => ({
  noteTabSet: vi.fn(),
}));

vi.mock('@api/modules/editor/noteTabApi', () => ({
  noteTabApi: {
    set: (...args: unknown[]) => apiMocks.noteTabSet(...args),
  },
}));

vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: Object.assign(
    (selector: (state: typeof testState) => unknown) => selector(testState),
    { getState: () => testState },
  ),
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

vi.mock('@components/main/common/checkbox/Checkbox', () => ({
  default: () => <span />,
}));
vi.mock('@components/main/common/TabSwitch', () => ({
  default: () => <span />,
}));
vi.mock(
  '@components/main/Grid/PropertiesPanel/controls/PropertyInputs',
  () => ({
    PropertyRow: ({
      label,
      children,
    }: {
      label: string;
      children: React.ReactNode;
    }) => <label data-label={label}>{children}</label>,
    PropertySection: ({ children }: { children: React.ReactNode }) => (
      <section>{children}</section>
    ),
  }),
);
vi.mock('../../Modal', () => ({
  default: ({
    children,
    motionState,
  }: {
    children: React.ReactNode;
    motionState?: string;
  }) => <div inert={motionState === 'closing'}>{children}</div>,
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

describe('TabNoteSettingModal 편집 세션', () => {
  let container: HTMLDivElement;
  let root: Root;
  let noteTabGet: ReturnType<typeof vi.fn>;
  let noteTabSet: ReturnType<typeof vi.fn>;

  const speedInput = () =>
    container.querySelector<HTMLInputElement>(
      '[data-label="noteSetting.speed"] input',
    );
  const saveButton = () =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'noteSetting.save',
    )!;
  const editSpeed = (speed: number) =>
    act(() => {
      const input = speedInput()!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, String(speed));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    testState.selectedKeyType = 'tab-a';
    testState.noteEffect = true;
    testState.noteSettings = getDefaultNoteSettings();
    testState.keyMappings = { 'tab-a': [], 'tab-b': [] };
    testState.customTabs = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
    vi.unstubAllGlobals();
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

    expect(speedInput()?.value).toBe(String(settingsB.speed));

    await act(async () => {
      first.resolve({ tabId: 'tab-a', settings: settingsA });
      await Promise.resolve();
    });

    expect(speedInput()?.value).toBe(String(settingsB.speed));

    await act(async () => {
      saveButton().click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(noteTabSet).toHaveBeenCalledWith('tab-b', settingsB);
  });

  it('저장 실패를 편집 화면에 전파해서 성공으로 닫히지 않게 한다', async () => {
    noteTabGet.mockResolvedValue({ tabId: 'tab-a', settings: { speed: 700 } });
    const error = new Error('tab settings write failed');
    const onClose = vi.fn();
    noteTabSet.mockRejectedValueOnce(error);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />);
    });
    await act(async () => {
      saveButton().click();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(speedInput()?.value).toBe('700');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'common.saveFailed',
    );
    await act(async () => saveButton().click());
    expect(noteTabSet).toHaveBeenLastCalledWith('tab-a', { speed: 700 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('저장 press 직후 외부 모드가 바뀌어도 처음 연 탭에 저장한다', async () => {
    const firstSpeed = (testState.noteSettings as NoteSettings).speed + 10;
    const second = deferred<TabNoteResponse>();
    noteTabGet
      .mockResolvedValueOnce({
        tabId: 'tab-a',
        settings: { speed: firstSpeed },
      })
      .mockImplementationOnce(() => second.promise);
    const onClose = vi.fn();
    await act(async () => {
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />);
    });
    editSpeed(firstSpeed + 7);
    act(() => {
      const save = saveButton();
      save.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 9,
          isPrimary: true,
          button: 0,
        }),
      );
      save.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 9,
          isPrimary: true,
          button: 0,
        }),
      );
      testState.selectedKeyType = 'tab-b';
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />);
    });
    expect(speedInput()?.value).toBe(String(firstSpeed + 7));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(noteTabSet).toHaveBeenCalledWith('tab-a', { speed: firstSpeed + 7 });
    expect(noteTabGet).toHaveBeenCalledTimes(1);
  });

  it('조회 중 모드가 바뀌어도 원래 탭을 열고 재개방할 때 새 탭을 읽는다', async () => {
    const first = deferred<TabNoteResponse>();
    const second = deferred<TabNoteResponse>();
    noteTabGet
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onClose = vi.fn();
    await act(async () =>
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />),
    );
    testState.selectedKeyType = 'tab-b';
    await act(async () =>
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />),
    );
    await act(async () =>
      first.resolve({ tabId: 'tab-a', settings: { speed: 710 } }),
    );
    expect(speedInput()?.value).toBe('710');
    expect(noteTabGet).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(<TabNoteSettingModal isOpen={false} onClose={onClose} />),
    );
    await act(async () =>
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />),
    );
    await act(async () =>
      second.resolve({ tabId: 'tab-b', settings: { speed: 820 } }),
    );
    expect(speedInput()?.value).toBe('820');
    await act(async () => saveButton().click());
    expect(noteTabSet).toHaveBeenCalledWith('tab-b', { speed: 820 });
  });

  it('열었던 탭이 삭제되면 다른 탭에 쓰지 않고 안내와 초안을 유지한다', async () => {
    noteTabGet.mockResolvedValue({ tabId: 'tab-a', settings: { speed: 700 } });
    const onClose = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () =>
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />),
    );
    editSpeed(777);

    testState.selectedKeyType = 'tab-b';
    testState.keyMappings = { 'tab-b': [] };
    await act(async () =>
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />),
    );
    await act(async () => saveButton().click());

    expect(noteTabSet).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(speedInput()?.value).toBe('777');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'common.editTargetMissing',
    );

    await act(async () =>
      root.render(<TabNoteSettingModal isOpen={false} onClose={onClose} />),
    );
    noteTabGet.mockResolvedValueOnce({
      tabId: 'tab-b',
      settings: { speed: 820 },
    });
    await act(async () =>
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />),
    );
    expect(speedInput()?.value).toBe('820');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => saveButton().click());
    expect(noteTabSet).toHaveBeenCalledWith('tab-b', { speed: 820 });
  });

  it('아직 키가 없는 사용자 탭도 존재하면 저장한다', async () => {
    testState.keyMappings = { 'tab-b': [] };
    testState.customTabs = [{ id: 'tab-a' }];
    noteTabGet.mockResolvedValue({ tabId: 'tab-a', settings: { speed: 700 } });
    const onClose = vi.fn();
    await act(async () =>
      root.render(<TabNoteSettingModal isOpen onClose={onClose} />),
    );
    await act(async () => saveButton().click());
    expect(noteTabSet).toHaveBeenCalledWith('tab-a', { speed: 700 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
