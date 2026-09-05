import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { resetAllKeySignals } from '@stores/signals/keySignals';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  resize: vi.fn(),
  currentMonitor: vi.fn(),
  getByLabel: vi.fn(),
  menuNew: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setSelectedKeyType: vi.fn(),
  settingsUpdate: vi.fn(),
  setVisible: vi.fn(),
  showMain: vi.fn(),
  quit: vi.fn(),
  hitContextMenuListeners: [] as ((pos: { x: number; y: number }) => void)[],
  overlayWindow: {
    startDragging: vi.fn(() => Promise.resolve()),
    outerPosition: vi.fn(),
    outerSize: vi.fn(),
    setPosition: vi.fn((_position: { x: number; y: number }) =>
      Promise.resolve(),
    ),
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  currentMonitor: mocks.currentMonitor,
  getCurrentWindow: () => mocks.overlayWindow,
  Window: { getByLabel: mocks.getByLabel },
}));
vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalPosition: class LogicalPosition {
    constructor(public x: number, public y: number) {}
  },
  PhysicalPosition: class PhysicalPosition {
    constructor(public x: number, public y: number) {}
  },
}));
vi.mock('@tauri-apps/api/menu', () => ({ Menu: { new: mocks.menuNew } }));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@hooks/app/useCustomCssInjection', () => ({
  useCustomCssInjection: vi.fn(),
}));
vi.mock('@hooks/app/useCustomJsInjection', () => ({
  useCustomJsInjection: vi.fn(),
}));
vi.mock('@hooks/app/useBlockBrowserShortcuts', () => ({
  useBlockBrowserShortcuts: vi.fn(),
}));
vi.mock('@hooks/app/useAppBootstrap', () => ({ useAppBootstrap: vi.fn() }));
vi.mock('@hooks/overlay/useBuiltinStatsSubscription', () => ({
  useBuiltinStatsSubscription: vi.fn(),
}));
vi.mock('@hooks/overlay/useNoteSystem', () => ({
  useNoteSystem: () => ({
    notesRef: { current: {} },
    subscribe: () => () => {},
    handleKeyDown: vi.fn(),
    handleKeyUp: vi.fn(),
    finalizeAllActive: vi.fn(),
    reconcileActiveNotes: vi.fn(),
    noteBuffer: {},
    updateTrackLayouts: vi.fn(),
  }),
}));
vi.mock('@stores/data/useStatItemStore', () => ({
  useStatItemStore: <T,>(
    selector: (state: { positions: Record<string, never[]> }) => T,
  ) => selector({ positions: {} }),
}));
vi.mock('@stores/data/useGraphItemStore', () => ({
  useGraphItemStore: <T,>(
    selector: (state: { positions: Record<string, never[]> }) => T,
  ) => selector({ positions: {} }),
}));
vi.mock('@stores/data/useKnobItemStore', () => ({
  useKnobItemStore: <T,>(
    selector: (state: { positions: Record<string, never[]> }) => T,
  ) => selector({ positions: {} }),
}));
vi.mock('@stores/useSettingsStore', async () => {
  const { create } = await import('zustand');
  const useSettingsStore = create((set) => ({
    developerModeEnabled: false,
    backgroundColor: 'transparent',
    alwaysOnTop: false,
    trayEnabled: true,
    setAlwaysOnTop: (alwaysOnTop: boolean) => {
      mocks.setAlwaysOnTop(alwaysOnTop);
      set({ alwaysOnTop });
    },
    noteSettings: {
      frameLimit: 0,
      speed: 500,
      trackHeight: 2_000,
      reverse: false,
      fadePosition: 'auto',
      keyDisplayDelayMs: 0,
    },
    tabNoteOverrides: {},
    noteEffect: true,
    gridSettings: { overlayPadding: 30 },
    overlayResizeAnchor: 'center',
    keyCounterEnabled: false,
  }));
  return { useSettingsStore };
});
// 트랙 예약 전환은 초기값 채택만 사용 - 페이드 커맨드가 실제 invoke로 새지 않게 차단
vi.mock('@api/modules/window/overlayApi', () => ({
  overlayApi: {
    resize: mocks.resize,
    setVisible: mocks.setVisible,
    transitionFade: vi.fn(() => Promise.resolve(true)),
  },
}));
vi.mock('@api/modules/app/settingsApi', () => ({
  settingsApi: { update: mocks.settingsUpdate },
}));
vi.mock('@api/modules/app/appApi', () => ({
  appApi: { quit: mocks.quit },
  windowApi: { showMain: mocks.showMain },
}));
// 히트 영역 실측은 ResizeObserver·네이티브 IPC에 의존 - 이 파일들의 관심사 밖
vi.mock('@hooks/overlay/useOverlayHitRegions', () => ({
  useOverlayHitRegions: () => {},
  subscribeHitContextMenu: (
    listener: (pos: { x: number; y: number }) => void,
  ) => {
    mocks.hitContextMenuListeners.push(listener);
    return () => {
      mocks.hitContextMenuListeners = mocks.hitContextMenuListeners.filter(
        (registered) => registered !== listener,
      );
    };
  },
}));
vi.mock('@components/shared/OverlayScene', () => ({ default: () => null }));
vi.mock('@utils/input/axisEventBus', () => ({
  axisEventBus: { initialize: vi.fn() },
}));
vi.mock('@utils/input/keyEventBus', () => ({
  keyEventBus: {
    subscribe: vi.fn(() => vi.fn()),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@api/modules/window/obsApi', () => ({
  obsApi: { onResync: vi.fn(() => vi.fn()) },
}));

import App from './App';

const flushAsync = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

let container: HTMLDivElement;
let root: Root | null;
let originalApi: Window['api'];
let originalRuntime: Window['__dmn_runtime'];

const mount = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<App />);
  });
  await flushAsync();
};

const setupOverlay = () => {
  originalApi = window.api;
  originalRuntime = window.__dmn_runtime;
  mocks.bootstrap.mockReset().mockResolvedValue({ activeKeys: [] });
  mocks.resize.mockReset().mockResolvedValue(undefined);
  mocks.currentMonitor.mockReset().mockResolvedValue(null);
  mocks.getByLabel.mockReset().mockResolvedValue({
    isVisible: vi.fn(() => Promise.resolve(false)),
  });
  mocks.menuNew.mockReset();
  mocks.setAlwaysOnTop.mockReset();
  mocks.setSelectedKeyType.mockReset().mockImplementation((keyType: string) => {
    useKeyStore.setState({ selectedKeyType: keyType });
  });
  mocks.settingsUpdate.mockReset().mockResolvedValue(undefined);
  mocks.setVisible.mockReset().mockResolvedValue(undefined);
  mocks.showMain.mockReset().mockResolvedValue(undefined);
  mocks.quit.mockReset().mockResolvedValue(undefined);
  mocks.overlayWindow.setPosition.mockClear();
  mocks.hitContextMenuListeners = [];
  window.api = {
    app: { bootstrap: mocks.bootstrap },
    keys: { onKeysReset: vi.fn(() => vi.fn()) },
  } as unknown as Window['api'];
  useKeyStore.setState({
    selectedKeyType: '4key',
    customTabs: [],
    keyMappings: { '4key': ['KeyK'] },
    positions: { '4key': [createDefaultKeyPosition(0, 0)] },
    canonicalPositions: { '4key': [] },
    isBootstrapped: true,
    isLocalUpdateInProgress: false,
    setSelectedKeyType: mocks.setSelectedKeyType,
  });
  useSettingsStore.setState({ alwaysOnTop: false, trayEnabled: true });
  resetAllKeySignals();
};

const teardownOverlay = () => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container.remove();
  resetAllKeySignals();
  window.api = originalApi;
  if (originalRuntime === undefined) delete window.__dmn_runtime;
  else window.__dmn_runtime = originalRuntime;
  vi.restoreAllMocks();
};

interface NativeMenuItem {
  id?: string;
  item?: string;
  text?: string;
  checked?: boolean;
  enabled?: boolean;
  action?: () => void;
  items?: NativeMenuItem[];
}

interface RecordedMenu {
  items: NativeMenuItem[];
  popup: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const installMenuRecorder = (
  popupForCall: (callIndex: number) => Promise<void> = () => Promise.resolve(),
) => {
  const records: RecordedMenu[] = [];
  mocks.menuNew.mockImplementation((options: { items: NativeMenuItem[] }) => {
    const callIndex = records.length;
    const record = {
      items: options.items,
      popup: vi.fn(() => popupForCall(callIndex)),
      close: vi.fn(() => Promise.resolve()),
    };
    records.push(record);
    return Promise.resolve(record);
  });
  return records;
};

const emitContextMenu = async (x = 0, y = 0) => {
  await act(async () => {
    mocks.hitContextMenuListeners.forEach((listener) => listener({ x, y }));
  });
  await flushAsync();
};

const menuItem = (record: RecordedMenu, id: string): NativeMenuItem => {
  const item = record.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing menu item: ${id}`);
  return item;
};

describe('오버레이 네이티브 메뉴 런타임', () => {
  beforeEach(setupOverlay);
  afterEach(teardownOverlay);

  it('항목 순서·상태·좌표와 탭 action 계약을 유지한다', async () => {
    useKeyStore.setState({
      customTabs: [{ id: 'custom-a', name: 'Custom A' }],
    });
    const records = installMenuRecorder();

    await mount();
    await emitContextMenu(10.4, 20.6);

    expect(records).toHaveLength(1);
    expect(records[0].items.map((item) => item.id ?? item.item)).toEqual([
      'toggleAlwaysOnTop',
      'Separator',
      'selectTab',
      'closeOverlay',
      'snapToEdge',
      'Separator',
      'openSettingsWindow',
      'Separator',
      'quitApplication',
    ]);
    expect(menuItem(records[0], 'toggleAlwaysOnTop')).toMatchObject({
      text: 'settings.alwaysOnTop',
      checked: false,
    });
    expect(menuItem(records[0], 'openSettingsWindow')).toMatchObject({
      text: 'tooltip.settings',
      enabled: true,
    });
    const tabItems = menuItem(records[0], 'selectTab').items!;
    expect(
      tabItems.map(({ id, text, checked }) => ({ id, text, checked })),
    ).toEqual([
      { id: 'selectTab-4key', text: 'mode.button4', checked: true },
      { id: 'selectTab-5key', text: 'mode.button5', checked: false },
      { id: 'selectTab-6key', text: 'mode.button6', checked: false },
      { id: 'selectTab-8key', text: 'mode.button8', checked: false },
      { id: 'selectTab-custom-a', text: 'Custom A', checked: false },
    ]);
    expect(records[0].popup).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 21 }),
      mocks.overlayWindow,
    );
    expect(records[0].close).toHaveBeenCalledTimes(1);

    act(() => tabItems.at(-1)?.action?.());
    expect(mocks.setSelectedKeyType).toHaveBeenCalledWith('custom-a');
    expect(useKeyStore.getState().selectedKeyType).toBe('custom-a');
  });

  it('rerender 뒤 최신 checked·탭·tray 상태로 다음 메뉴를 만든다', async () => {
    const records = installMenuRecorder();
    await mount();
    await emitContextMenu();

    act(() => {
      useSettingsStore.setState({ alwaysOnTop: true, trayEnabled: false });
      useKeyStore.setState({
        selectedKeyType: 'custom-b',
        customTabs: [{ id: 'custom-b', name: 'Custom B' }],
      });
    });
    await flushAsync();
    await emitContextMenu();

    expect(records).toHaveLength(2);
    expect(menuItem(records[1], 'toggleAlwaysOnTop').checked).toBe(true);
    expect(menuItem(records[1], 'openSettingsWindow').enabled).toBe(false);
    expect(menuItem(records[1], 'selectTab').items?.at(-1)).toMatchObject({
      id: 'selectTab-custom-b',
      text: 'Custom B',
      checked: true,
    });
    expect(mocks.getByLabel).toHaveBeenCalledTimes(1);
  });

  it('동시 emit은 한 메뉴만 열고 정산 뒤 다음 emit을 허용한다', async () => {
    let resolvePopup: (() => void) | undefined;
    const popupPending = new Promise<void>((resolve) => {
      resolvePopup = resolve;
    });
    const records = installMenuRecorder((callIndex) =>
      callIndex === 0 ? popupPending : Promise.resolve(),
    );
    await mount();

    act(() => {
      mocks.hitContextMenuListeners.forEach((listener) => {
        listener({ x: 1, y: 2 });
        listener({ x: 3, y: 4 });
      });
    });
    await flushAsync();
    expect(records).toHaveLength(1);

    resolvePopup?.();
    await flushAsync();
    expect(records[0].close).toHaveBeenCalledTimes(1);
    await emitContextMenu(5, 6);
    expect(records).toHaveLength(2);
  });

  it('popup 실패도 menu close와 gate 재개방을 finally 순서로 정산한다', async () => {
    const error = new Error('popup failed');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const records = installMenuRecorder((callIndex) =>
      callIndex === 0 ? Promise.reject(error) : Promise.resolve(),
    );
    await mount();

    await emitContextMenu();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to open native overlay context menu',
      error,
    );
    expect(records[0].close).toHaveBeenCalledTimes(1);

    await emitContextMenu();
    expect(records).toHaveLength(2);
    expect(records[1].popup).toHaveBeenCalledTimes(1);
  });

  it('unmount는 hit-context 구독을 해제하고 이후 좌표를 무시한다', async () => {
    installMenuRecorder();
    await mount();
    expect(mocks.hitContextMenuListeners).toHaveLength(1);

    act(() => root?.unmount());
    root = null;
    expect(mocks.hitContextMenuListeners).toHaveLength(0);
    mocks.hitContextMenuListeners.forEach((listener) =>
      listener({ x: 1, y: 2 }),
    );
    await flushAsync();

    expect(mocks.menuNew).not.toHaveBeenCalled();
  });

  it('각 메뉴 action 성공 경로를 기존 API와 store 순서로 실행한다', async () => {
    const records = installMenuRecorder();
    mocks.currentMonitor.mockResolvedValue({
      position: { x: 0, y: 0 },
      size: { width: 1000, height: 800 },
    });
    mocks.overlayWindow.outerPosition.mockResolvedValue({ x: 900, y: 700 });
    mocks.overlayWindow.outerSize.mockResolvedValue({
      width: 100,
      height: 100,
    });
    await mount();
    await emitContextMenu();

    act(() => menuItem(records[0], 'toggleAlwaysOnTop').action?.());
    await flushAsync();
    expect(mocks.setAlwaysOnTop.mock.calls).toEqual([[true]]);
    expect(mocks.settingsUpdate).toHaveBeenCalledWith({ alwaysOnTop: true });

    act(() => menuItem(records[0], 'closeOverlay').action?.());
    act(() => menuItem(records[0], 'snapToEdge').action?.());
    act(() => menuItem(records[0], 'openSettingsWindow').action?.());
    act(() => menuItem(records[0], 'quitApplication').action?.());
    await flushAsync();

    expect(mocks.setVisible).toHaveBeenCalledWith(false);
    expect(mocks.overlayWindow.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 900, y: 700 }),
    );
    expect(mocks.showMain).toHaveBeenCalledTimes(1);
    expect(mocks.quit).toHaveBeenCalledTimes(1);
  });

  it('각 메뉴 action 실패를 격리하고 always-on-top을 rollback한다', async () => {
    const errors = {
      always: new Error('always failed'),
      close: new Error('close failed'),
      snap: new Error('snap failed'),
      settings: new Error('settings failed'),
      quit: new Error('quit failed'),
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const records = installMenuRecorder();
    mocks.settingsUpdate.mockRejectedValueOnce(errors.always);
    mocks.setVisible.mockRejectedValueOnce(errors.close);
    mocks.currentMonitor.mockRejectedValueOnce(errors.snap);
    mocks.showMain.mockRejectedValueOnce(errors.settings);
    mocks.quit.mockRejectedValueOnce(errors.quit);
    await mount();
    await emitContextMenu();

    act(() => menuItem(records[0], 'toggleAlwaysOnTop').action?.());
    act(() => menuItem(records[0], 'closeOverlay').action?.());
    act(() => menuItem(records[0], 'snapToEdge').action?.());
    act(() => menuItem(records[0], 'openSettingsWindow').action?.());
    act(() => menuItem(records[0], 'quitApplication').action?.());
    await flushAsync();

    expect(mocks.setAlwaysOnTop.mock.calls).toEqual([[true], [false]]);
    expect(useSettingsStore.getState().alwaysOnTop).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to toggle always-on-top',
      errors.always,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to close overlay window',
      errors.close,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to snap overlay to edge',
      errors.snap,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to open settings window',
      errors.settings,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to quit application',
      errors.quit,
    );
  });

  it('main visibility 조회 실패는 메뉴를 유지하되 설정 action을 비활성화한다', async () => {
    const error = new Error('visibility failed');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getByLabel.mockRejectedValueOnce(error);
    const records = installMenuRecorder();
    await mount();

    await emitContextMenu();

    expect(menuItem(records[0], 'openSettingsWindow').enabled).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to resolve main window visibility',
      error,
    );
  });
});

describe('모서리 스냅', () => {
  beforeEach(setupOverlay);
  afterEach(teardownOverlay);

  // 컨텍스트 메뉴를 열어 스냅 항목의 action을 실행
  const runSnap = async (window: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  }) => {
    let items: { id: string; action?: () => void }[] = [];
    mocks.menuNew.mockImplementation(
      (options: { items: { id: string; action?: () => void }[] }) => {
        items = options.items;
        return Promise.resolve({
          popup: () => Promise.resolve(),
          close: () => Promise.resolve(),
        });
      },
    );
    mocks.overlayWindow.outerPosition.mockResolvedValue(window.position);
    mocks.overlayWindow.outerSize.mockResolvedValue(window.size);

    await mount();
    await act(async () => {
      mocks.hitContextMenuListeners.forEach((listener) =>
        listener({ x: 0, y: 0 }),
      );
    });
    await flushAsync();

    items.find((item) => item.id === 'snapToEdge')?.action?.();
    await flushAsync();

    return mocks.overlayWindow.setPosition.mock.calls.at(-1)?.[0];
  };

  // 작업 영역을 화면과 다르게 둬서, 기준이 작업 영역으로 돌아가면 단언이 깨지게 한다
  const monitorWithInsets = {
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: {
      position: { x: 0, y: 40 },
      size: { width: 1920, height: 940 },
    },
  };

  it.each([
    {
      quadrant: '좌상단',
      position: { x: 50, y: 20 },
      expected: { x: 0, y: 0 },
    },
    {
      quadrant: '우상단',
      position: { x: 1500, y: 20 },
      expected: { x: 1620, y: 0 },
    },
    {
      quadrant: '좌하단',
      position: { x: 50, y: 800 },
      expected: { x: 0, y: 880 },
    },
    {
      quadrant: '우하단',
      position: { x: 1500, y: 800 },
      expected: { x: 1620, y: 880 },
    },
  ])(
    '$quadrant은 전체 화면의 해당 모서리로 붙는다',
    async ({ position, expected }) => {
      mocks.currentMonitor.mockResolvedValue(monitorWithInsets);

      const applied = await runSnap({
        position,
        size: { width: 300, height: 200 },
      });

      // workArea 기준이면 상단은 y=40, 하단은 y=780에서 멈춘다
      expect(applied).toMatchObject(expected);
    },
  );

  it('창이 화면보다 크면 화면 위쪽 밖으로 밀어내지 않는다', async () => {
    mocks.currentMonitor.mockResolvedValue(monitorWithInsets);

    const applied = await runSnap({
      position: { x: 100, y: 300 },
      size: { width: 2400, height: 1600 },
    });

    // 보정 전에는 1080 - 1600 = -520으로 화면 위로 사라졌다
    expect(applied).toMatchObject({ x: 0, y: 0 });
  });
});

describe('OBS 오버레이', () => {
  beforeEach(setupOverlay);
  afterEach(teardownOverlay);

  it('네이티브 창이 없으므로 리사이즈를 호출하지 않는다', async () => {
    window.__dmn_runtime = 'obs';

    await mount();

    // allowlist 밖이라 호출은 어차피 거부되고, 실패 처리가 기준선을 지워 반복된다
    expect(mocks.resize).not.toHaveBeenCalled();
  });

  it('네이티브 런타임에서는 리사이즈를 호출한다', async () => {
    await mount();

    expect(mocks.resize).toHaveBeenCalled();
  });
});
