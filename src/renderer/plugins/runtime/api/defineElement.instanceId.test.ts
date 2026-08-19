// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reappliers: new Map<
    string,
    { cancelPendingSave: () => void; reapply: (instances: unknown[]) => void }
  >(),
  instancesCommit: vi.fn(() =>
    Promise.resolve({ modelRevision: 1, changed: false }),
  ),
  instancesReconcile: vi.fn(() =>
    Promise.resolve({ modelRevision: 1, changed: false }),
  ),
}));

vi.mock('@api/modules/pluginInstancesApi', () => ({
  pluginInstancesApi: {
    commit: mocks.instancesCommit,
    reconcile: mocks.instancesReconcile,
    get: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  },
}));

vi.mock('../displayElement/instancesCommitQueue', () => ({
  createPluginInstancesSaveDebounce: () => ({
    schedule: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  }),
  enqueuePluginInstancesCommit: (
    _pluginId: string,
    task: () => Promise<unknown>,
  ) => task(),
  flushPluginInstancesEditSession: vi.fn(),
  hasActivePluginInstancesEditContext: () => false,
  hasConflictingPluginInstancesGesture: () => false,
  isPluginInstancesGestureStaged: () => false,
  registerPluginInstancesEditSessionFlush: () => () => undefined,
  registerPluginInstancesStagedRelease: () => () => undefined,
  rotatePluginInstancesEditSession: vi.fn(),
  touchPluginInstancesEditSession: () => 'gesture-token',
}));

vi.mock('../displayElement/instancesUndoSync', () => ({
  applyCanonicalPluginInstances: vi.fn(() => Promise.resolve()),
  notePluginInstancesMutation: vi.fn(),
  registerPluginInstancesReapplier: (
    _pluginId: string,
    defId: string,
    handlers: {
      cancelPendingSave: () => void;
      reapply: (instances: unknown[]) => void;
    },
  ) => {
    mocks.reappliers.set(defId, handlers);
    return () => {
      mocks.reappliers.delete(defId);
    };
  },
}));

vi.mock('@plugins/runtime/pluginAuthorityGeneration', () => ({
  getPluginAuthorityGeneration: () => 1,
}));

vi.mock('@plugins/runtime/pluginModelRevision', () => ({
  noteBackendPluginRevision: vi.fn(),
}));

vi.mock('@utils/plugin/panelModelSync', () => ({
  schedulePluginPanelModelSync: vi.fn(),
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: vi.fn(),
}));

vi.mock('@stores/data/useHistoryStatusStore', () => ({
  useHistoryStatusStore: { getState: () => ({ historyEpoch: 1 }) },
  syncHistoryStatus: vi.fn(),
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  buildSavedPluginInstances,
  createDefineElement,
  type SavedInstance,
} from './defineElement';

const SAVED_ID = '40000000-0000-4000-8000-000000000001';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const savedInstance = (
  overrides: Partial<SavedInstance> = {},
): SavedInstance => ({
  instanceId: SAVED_ID,
  position: { x: 10, y: 20 },
  tabId: '4key',
  hidden: false,
  zIndex: 1,
  ...overrides,
});

describe('plugin instance id restore round-trip', () => {
  const cleanups: Array<() => void> = [];

  const defineWithStorage = (stored: SavedInstance[] | null) => {
    createDefineElement({
      pluginId: 'plugin-a',
      api: {
        settings: { get: vi.fn().mockResolvedValue({ language: 'ko' }) },
        ui: {
          contextMenu: {
            addGridMenuItem: vi.fn(() => 'menu-1'),
            removeMenuItem: vi.fn(),
          },
          displayElement: { update: vi.fn() },
        },
      },
      namespacedStorage: { get: vi.fn().mockResolvedValue(stored) },
      registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
      wrapFunctionWithContext: (fn: (...args: unknown[]) => unknown) => fn,
      isReloading: () => false,
      waitForReloadEnd: vi.fn().mockResolvedValue(undefined),
    } as never)({
      name: 'Example',
      template: () => '',
    });
  };

  const storeElements = () => usePluginDisplayElementStore.getState().elements;

  beforeEach(() => {
    window.__dmn_window_type = 'main';
    window.__dmn_current_plugin_id = 'plugin-a';
    mocks.reappliers.clear();
    useKeyStore.setState({
      isBootstrapped: true,
      customTabs: [],
      selectedKeyType: '4key',
    });
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
    });
  });

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
    });
    useKeyStore.setState({ isBootstrapped: false });
    delete window.__dmn_current_plugin_id;
    delete window.__dmn_window_type;
  });

  it('저장된 instanceId를 요소 id로 복원하고 재저장에서 보존한다', async () => {
    defineWithStorage([savedInstance()]);

    await vi.waitFor(() => expect(storeElements()).toHaveLength(1));
    const [element] = storeElements();
    expect(element.id).toBe(SAVED_ID);
    expect(element.fullId).toBe(`plugin-a::${SAVED_ID}`);

    // round-trip: 적용된 요소를 다시 스냅샷으로 만들어도 같은 ID
    const resaved = buildSavedPluginInstances(storeElements(), 'plugin-a');
    expect(resaved).toHaveLength(1);
    expect(resaved[0].instanceId).toBe(SAVED_ID);
  });

  it('instanceId 없는 구데이터 복원은 새 UUID를 발급한다', async () => {
    defineWithStorage([savedInstance({ instanceId: undefined })]);

    await vi.waitFor(() => expect(storeElements()).toHaveLength(1));
    const [element] = storeElements();
    expect(element.id).toMatch(UUID_PATTERN);
    expect(
      buildSavedPluginInstances(storeElements(), 'plugin-a')[0].instanceId,
    ).toBe(element.id);
  });

  it('undo 재결합 reapply도 저장 instanceId를 요소 id로 재주입한다', async () => {
    defineWithStorage([savedInstance()]);
    await vi.waitFor(() => expect(storeElements()).toHaveLength(1));

    const otherId = '40000000-0000-4000-8000-000000000002';
    const handlers = mocks.reappliers.get('plugin-a');
    expect(handlers).toBeDefined();
    handlers!.reapply([
      savedInstance(),
      savedInstance({ instanceId: otherId, position: { x: 30, y: 40 } }),
    ]);

    const ids = storeElements().map((element) => element.id);
    expect(ids).toEqual([SAVED_ID, otherId]);
    expect(
      buildSavedPluginInstances(storeElements(), 'plugin-a').map(
        (instance) => instance.instanceId,
      ),
    ).toEqual([SAVED_ID, otherId]);
  });
});
