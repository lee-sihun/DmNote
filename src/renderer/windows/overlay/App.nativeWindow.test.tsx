import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useKeyStore } from '@stores/data/useKeyStore';
import { resetAllKeySignals } from '@stores/signals/keySignals';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  resize: vi.fn(),
  currentMonitor: vi.fn(),
  menuNew: vi.fn(),
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
  Window: { getByLabel: vi.fn() },
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
  const useSettingsStore = create(() => ({
    developerModeEnabled: false,
    backgroundColor: 'transparent',
    alwaysOnTop: false,
    trayEnabled: true,
    setAlwaysOnTop: vi.fn(),
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
vi.mock('@api/modules/overlayApi', () => ({
  overlayApi: {
    resize: mocks.resize,
    setVisible: vi.fn(() => Promise.resolve()),
    transitionFade: vi.fn(() => Promise.resolve(true)),
  },
}));
vi.mock('@components/shared/OverlayScene', () => ({ default: () => null }));
vi.mock('@utils/core/axisEventBus', () => ({
  axisEventBus: { initialize: vi.fn() },
}));
vi.mock('@utils/core/keyEventBus', () => ({
  keyEventBus: {
    subscribe: vi.fn(() => vi.fn()),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@api/modules/obsApi', () => ({
  obsApi: { onResync: vi.fn(() => vi.fn()) },
}));

import App from './App';

const flushAsync = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

let container: HTMLDivElement;
let root: Root;
let originalApi: Window['api'];
let originalRuntime: Window['__dmn_runtime'];

const mount = async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  await flushAsync();
};

const setupOverlay = () => {
  originalApi = window.api;
  originalRuntime = window.__dmn_runtime;
  mocks.bootstrap.mockReset().mockResolvedValue({ activeKeys: [] });
  mocks.resize.mockReset().mockResolvedValue(undefined);
  mocks.currentMonitor.mockReset().mockResolvedValue(null);
  mocks.menuNew.mockReset();
  mocks.overlayWindow.setPosition.mockClear();
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
  });
  resetAllKeySignals();
};

const teardownOverlay = () => {
  act(() => root.unmount());
  container.remove();
  resetAllKeySignals();
  window.api = originalApi;
  if (originalRuntime === undefined) delete window.__dmn_runtime;
  else window.__dmn_runtime = originalRuntime;
  vi.restoreAllMocks();
};

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
      globalThis.window.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true }),
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

  it('아래로 붙일 때 독·작업 표시줄 자리까지 내려간다', async () => {
    mocks.currentMonitor.mockResolvedValue(monitorWithInsets);

    const applied = await runSnap({
      position: { x: 1500, y: 800 },
      size: { width: 300, height: 200 },
    });

    // 작업 영역 기준이면 y=780에서 멈춰 하단 인셋만큼 떠 보인다
    expect(applied).toMatchObject({ x: 1620, y: 880 });
  });

  it('위로 붙일 때 메뉴 바 자리까지 올라간다', async () => {
    mocks.currentMonitor.mockResolvedValue(monitorWithInsets);

    const applied = await runSnap({
      position: { x: 50, y: 20 },
      size: { width: 300, height: 200 },
    });

    // 작업 영역 기준이면 y=40
    expect(applied).toMatchObject({ x: 0, y: 0 });
  });

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
