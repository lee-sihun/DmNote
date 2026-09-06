// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedSaveRequest {
  gestureId?: string;
  captureCurrentSnapshot: boolean;
}

interface CapturedSaveDebounceOptions {
  delayMs: number;
  save: (request: CapturedSaveRequest) => Promise<void>;
  onError: (error: unknown, request: CapturedSaveRequest) => void;
}

const mocks = vi.hoisted(() => ({
  instancesCommit: vi.fn(() =>
    Promise.resolve({ modelRevision: 1, changed: false }),
  ),
  instancesReconcile: vi.fn(() =>
    Promise.resolve({ modelRevision: 1, changed: false }),
  ),
  instancesGet: vi.fn(),
  debounceSchedule: vi.fn(),
  debounceFlush: vi.fn(),
  debounceCancel: vi.fn(),
  saveDebounces: [] as CapturedSaveDebounceOptions[],
  isStaged: vi.fn(() => false),
  hasConflicting: vi.fn(() => false),
  hasActiveContext: vi.fn(() => false),
  flushEditSession: vi.fn(),
  stagedReleaseListeners: new Map<string, (gestureId: string) => void>(),
  syncHistoryStatus: vi.fn(() => Promise.resolve()),
  historyEpoch: 1,
  enqueueGate: null as Promise<void> | null,
}));

vi.mock('@api/modules/plugin/pluginInstancesApi', () => ({
  pluginInstancesApi: {
    commit: mocks.instancesCommit,
    reconcile: mocks.instancesReconcile,
    get: mocks.instancesGet,
    onChanged: vi.fn(() => () => undefined),
  },
}));

vi.mock('../displayElement/instancesCommitQueue', () => ({
  createPluginInstancesSaveDebounce: (options: CapturedSaveDebounceOptions) => {
    mocks.saveDebounces.push(options);
    return {
      schedule: mocks.debounceSchedule,
      flush: mocks.debounceFlush,
      cancel: mocks.debounceCancel,
    };
  },
  enqueuePluginInstancesCommit: (
    _pluginId: string,
    task: () => Promise<unknown>,
  ) => (mocks.enqueueGate ? mocks.enqueueGate.then(() => task()) : task()),
  flushPluginInstancesEditSession: mocks.flushEditSession,
  hasActivePluginInstancesEditContext: mocks.hasActiveContext,
  hasConflictingPluginInstancesGesture: mocks.hasConflicting,
  isPluginInstancesGestureStaged: mocks.isStaged,
  registerPluginInstancesEditSessionFlush: () => () => undefined,
  registerPluginInstancesStagedRelease: (
    pluginId: string,
    listener: (gestureId: string) => void,
  ) => {
    mocks.stagedReleaseListeners.set(pluginId, listener);
    return () => {
      mocks.stagedReleaseListeners.delete(pluginId);
    };
  },
  rotatePluginInstancesEditSession: vi.fn(),
  touchPluginInstancesEditSession: (
    _pluginId: string,
    preferredGestureId?: string,
  ) => preferredGestureId ?? 'gesture-token',
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
  useHistoryStatusStore: {
    getState: () => ({ historyEpoch: mocks.historyEpoch }),
  },
  syncHistoryStatus: mocks.syncHistoryStatus,
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { drainEditorWrites } from '@src/renderer/editor/runtime/lifecycle/editorWriteBarrier';
import {
  applyCanonicalPluginInstances,
  applyCommittedPluginInstancesProjection,
} from '../displayElement/instancesUndoSync';
import {
  displayElementInstanceRegistry,
  getDisplayElementInstance,
} from '../displayElement/instanceRegistry';
import {
  addDisplayElementInternal,
  displayElementApi,
} from '../displayElement/displayElementApi';
import {
  buildSavedPluginInstances,
  createDefineElement,
  type SavedInstance,
} from './defineElement';

const ID_A = '50000000-0000-4000-8000-000000000001';
const ID_B = '50000000-0000-4000-8000-000000000002';
const ID_C = '50000000-0000-4000-8000-000000000003';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const saved = (
  instanceId: string | undefined,
  overrides: Partial<SavedInstance> = {},
): SavedInstance => ({
  instanceId,
  position: { x: 0, y: 0 },
  tabId: '4key',
  hidden: false,
  zIndex: 1,
  ...overrides,
});

describe('plugin instance reapply diff-patch', () => {
  const cleanups: Array<() => void> = [];

  const defineFor = (
    pluginId: string,
    stored: SavedInstance[] | null,
    definitionOverrides: Record<string, unknown> = {},
  ) => {
    window.__dmn_current_plugin_id = pluginId;
    mocks.instancesGet.mockResolvedValue({
      pluginId,
      instances: stored ?? [],
      modelRevision: 1,
      authorityGeneration: 1,
    });
    createDefineElement({
      pluginId,
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
      registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
      wrapFunctionWithContext: (fn: (...args: unknown[]) => unknown) => fn,
      isReloading: () => false,
      waitForReloadEnd: vi.fn().mockResolvedValue(undefined),
    } as never)({
      name: 'Example',
      template: () => '',
      ...definitionOverrides,
    });
  };

  const defElements = (pluginId: string) =>
    usePluginDisplayElementStore
      .getState()
      .elements.filter((element) => element.definitionId === pluginId);

  const findElement = (fullId: string) =>
    usePluginDisplayElementStore
      .getState()
      .elements.find((element) => element.fullId === fullId);

  // canonical pull 경유 undo 재결합 - 실제 등록된 reapplier가 diff 적용
  const reapply = async (
    pluginId: string,
    revision: number,
    instances: SavedInstance[],
  ) => {
    mocks.instancesGet.mockResolvedValue({
      pluginId,
      instances,
      modelRevision: revision,
      authorityGeneration: 1,
    });
    await applyCanonicalPluginInstances(pluginId);
  };

  beforeEach(() => {
    window.__dmn_window_type = 'main';
    mocks.instancesCommit.mockClear();
    mocks.instancesReconcile.mockClear();
    mocks.instancesGet.mockReset();
    mocks.debounceSchedule.mockClear();
    mocks.debounceFlush.mockClear();
    mocks.debounceCancel.mockClear();
    mocks.saveDebounces.length = 0;
    mocks.isStaged.mockReset().mockReturnValue(false);
    mocks.hasConflicting.mockReset().mockReturnValue(false);
    mocks.hasActiveContext.mockReset().mockReturnValue(false);
    mocks.flushEditSession.mockClear();
    mocks.stagedReleaseListeners.clear();
    mocks.syncHistoryStatus.mockClear();
    mocks.historyEpoch = 1;
    mocks.enqueueGate = null;
    useKeyStore.setState({
      isBootstrapped: true,
      customTabs: [],
      selectedKeyType: '4key',
    });
    useGridSelectionStore.setState({ selectedElements: [] });
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
    });
  });

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    displayElementInstanceRegistry.clearAll();
    usePluginDisplayElementStore.setState({
      elements: [],
      definitions: new Map(),
    });
    useGridSelectionStore.setState({ selectedElements: [] });
    useKeyStore.setState({ isBootstrapped: false });
    delete window.__dmn_current_plugin_id;
    delete window.__dmn_window_type;
  });

  it('생존 요소는 소유 7필드만 갱신하고 핸들과 렌더러 필드를 보존한다', async () => {
    const pluginId = 'plugin-diff-live';
    defineFor(pluginId, [
      saved(ID_A, { position: { x: 10, y: 20 } }),
      saved(ID_B, { position: { x: 30, y: 40 } }),
    ]);
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(2));
    const fullIdA = `${pluginId}::${ID_A}`;
    const handleA = getDisplayElementInstance(fullIdA);
    expect(handleA).toBeDefined();

    // 렌더러 소유 필드 변이 (런타임 갱신 시뮬레이션)
    usePluginDisplayElementStore.getState().updateElement(fullIdA, {
      html: '<div>live</div>',
      state: { tick: 7 },
    });
    const before = findElement(fullIdA)!;

    await reapply(pluginId, 5, [
      saved(ID_A, {
        position: { x: 99, y: 88 },
        settings: { volume: 2 },
        measuredSize: { width: 50, height: 60 },
        hidden: true,
        zIndex: 4,
        groupId: 'group-a',
      }),
      saved(ID_B, { position: { x: 30, y: 40 } }),
    ]);

    const after = findElement(fullIdA)!;
    // canonical 소유 7필드 갱신
    expect(after.position).toEqual({ x: 99, y: 88 });
    expect(after.settings).toEqual({ volume: 2 });
    expect(after.measuredSize).toEqual({ width: 50, height: 60 });
    expect(after.tabId).toBe('4key');
    expect(after.hidden).toBe(true);
    expect(after.zIndex).toBe(4);
    expect(after.groupId).toBe('group-a');
    // 렌더러 소유 필드 불변
    expect(after.html).toBe('<div>live</div>');
    expect(after.state).toEqual({ tick: 7 });
    expect(after.onClick).toBe(before.onClick);
    expect(after._onClickId).toBe(before._onClickId);
    // 핸들 미dispose - 같은 인스턴스가 유효하게 동작
    expect(getDisplayElementInstance(fullIdA)).toBe(handleA);
    handleA!.update({ position: { x: 1, y: 2 } });
    expect(findElement(fullIdA)!.position).toEqual({ x: 1, y: 2 });
  });

  it('same-fullId 스냅샷 재적용 후 선택이 유지된다', async () => {
    const pluginId = 'plugin-diff-selection';
    defineFor(pluginId, [saved(ID_A)]);
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(1));
    const fullIdA = `${pluginId}::${ID_A}`;
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'plugin', id: fullIdA }]);
    const reference = useGridSelectionStore.getState().selectedElements;

    await reapply(pluginId, 5, [saved(ID_A, { position: { x: 77, y: 66 } })]);

    // pruneStalePluginSelection no-op - 생존 fullId 선택 유지
    expect(useGridSelectionStore.getState().selectedElements).toBe(reference);
    expect(findElement(fullIdA)!.position).toEqual({ x: 77, y: 66 });
  });

  it('reapply 후에도 열린 모달이 캡처한 fullId update가 store에 도달한다', async () => {
    const pluginId = 'plugin-diff-modal';
    defineFor(pluginId, [saved(ID_A)]);
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(1));
    // 모달이 open 시점에 캡처하는 instanceId
    const fullIdA = `${pluginId}::${ID_A}`;

    await reapply(pluginId, 5, [saved(ID_A, { settings: { volume: 1 } })]);

    // 모달 commitSettingValue와 동일한 update 경로
    displayElementApi.update(fullIdA, { settings: { volume: 9 } });
    expect(findElement(fullIdA)!.settings).toEqual({ volume: 9 });
  });

  it('삭제 undo는 같은 fullId로 재추가하고 새 핸들을 등록한다', async () => {
    const pluginId = 'plugin-diff-revive';
    defineFor(pluginId, [saved(ID_A), saved(ID_B)]);
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(2));
    const fullIdB = `${pluginId}::${ID_B}`;
    const oldHandle = getDisplayElementInstance(fullIdB)!;

    // 사용자 삭제 후 undo가 canonical에 같은 instanceId로 복원한 상황
    displayElementApi.remove(fullIdB);
    expect(findElement(fullIdB)).toBeUndefined();

    await reapply(pluginId, 5, [saved(ID_A), saved(ID_B)]);

    const revived = findElement(fullIdB)!;
    expect(revived.id).toBe(ID_B);
    const newHandle = getDisplayElementInstance(fullIdB)!;
    expect(newHandle).not.toBe(oldHandle);
    // 구핸들은 destroyed 유지 - update가 store에 닿지 않는다
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    oldHandle.update({ position: { x: 5, y: 5 } });
    warn.mockRestore();
    expect(findElement(fullIdB)!.position).toEqual({ x: 0, y: 0 });
    // 새 핸들은 유효
    newHandle.update({ position: { x: 6, y: 6 } });
    expect(findElement(fullIdB)!.position).toEqual({ x: 6, y: 6 });
  });

  it('초기 복원 창에서 추가된 요소는 잔존하고 reapply 소멸은 유지된다', async () => {
    const pluginId = 'plugin-diff-restore-window';
    defineFor(pluginId, [saved(ID_A)]);

    // define 직후, 초기 복원이 착지하기 전의 사용자 추가
    const added = addDisplayElementInternal({
      html: '<!-- plugin-element -->',
      position: { x: 5, y: 5 },
      draggable: true,
      definitionId: pluginId,
    } as never);
    const addedFullId = added.id;
    expect(findElement(addedFullId)).toBeDefined();

    // 초기 복원 완료 - 스냅샷 밖 요소지만 소멸 단계를 스킵해 잔존
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(2));
    expect(findElement(addedFullId)).toBeDefined();
    expect(findElement(`${pluginId}::${ID_A}`)).toBeDefined();

    // 복원 완료 후 reapply는 canonical이 진실 - 기대 밖 요소 소멸 유지
    await reapply(pluginId, 5, [saved(ID_A)]);
    expect(findElement(addedFullId)).toBeUndefined();
    expect(defElements(pluginId).map((element) => element.fullId)).toEqual([
      `${pluginId}::${ID_A}`,
    ]);
  });

  it('무ID 항목이 섞이면 그 스냅샷만 전량 재주입으로 폴백한다', async () => {
    const pluginId = 'plugin-diff-fallback';
    defineFor(pluginId, [saved(ID_A)]);
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(1));
    const fullIdA = `${pluginId}::${ID_A}`;
    const oldHandle = getDisplayElementInstance(fullIdA)!;
    usePluginDisplayElementStore
      .getState()
      .updateElement(fullIdA, { html: '<div>live</div>' });

    // backfill 전 데이터 창: 무ID 항목이 하나라도 있으면 diff 신원이 없다
    await reapply(pluginId, 5, [
      saved(ID_A),
      saved(undefined, { position: { x: 1, y: 2 }, zIndex: 2 }),
    ]);

    const elements = defElements(pluginId);
    expect(elements).toHaveLength(2);
    // 전량 재주입 - 유ID 요소도 새 요소로 갈리고 렌더러 필드가 초기화된다
    const reA = findElement(fullIdA)!;
    expect(reA.html).toBe('<!-- plugin-element -->');
    expect(getDisplayElementInstance(fullIdA)).not.toBe(oldHandle);
    // 유ID 항목은 저장 ID 유지, 무ID 항목은 새 UUID 발급
    const other = elements.find((element) => element.fullId !== fullIdA)!;
    expect(other.id).toMatch(UUID_PATTERN);
    expect(other.id).not.toBe(ID_A);
    expect(other.fullId).toBe(`${pluginId}::${other.id}`);
  });

  it('순서와 zIndex 변경 스냅샷은 store를 재배열하고 round-trip이 일치한다', async () => {
    const pluginId = 'plugin-diff-order';
    defineFor(pluginId, [saved(ID_A), saved(ID_B)]);
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(2));

    const snapshot = [
      saved(ID_B, {
        position: { x: 30, y: 40 },
        settings: { volume: 2 },
        measuredSize: { width: 12, height: 34 },
        zIndex: 9,
      }),
      saved(ID_A, {
        position: { x: 10, y: 20 },
        settings: { volume: 1 },
        measuredSize: { width: 56, height: 78 },
        zIndex: 1,
      }),
    ];
    await reapply(pluginId, 5, snapshot);

    // buildSavedPluginInstances가 순서 민감 - def 블록이 스냅샷 순서를 따른다
    expect(defElements(pluginId).map((element) => element.id)).toEqual([
      ID_B,
      ID_A,
    ]);
    expect(
      buildSavedPluginInstances(
        usePluginDisplayElementStore.getState().elements,
        pluginId,
      ),
    ).toEqual(snapshot);
  });

  it('maxInstances 캡은 탭별로 적용하되 canonical 순서를 보존한다', async () => {
    const pluginId = 'plugin-cap-order';
    // 탭이 섞인 canonical 순서 - 탭별 재그룹이 있었다면 [A, C, B]로 어긋난다
    const snapshot = [
      saved(ID_A, { tabId: '4key', settings: { volume: 1 } }),
      saved(ID_B, { tabId: '5key', settings: { volume: 2 } }),
      saved(ID_C, { tabId: '4key', settings: { volume: 3 } }),
    ];
    defineFor(pluginId, snapshot, { maxInstances: 2 });
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(3));
    expect(defElements(pluginId).map((element) => element.id)).toEqual([
      ID_A,
      ID_B,
      ID_C,
    ]);

    // undo 재결합도 동일 순서 - trailing echo 저장이 no-op으로 수렴하는 전제
    await reapply(pluginId, 5, snapshot);
    expect(defElements(pluginId).map((element) => element.id)).toEqual([
      ID_A,
      ID_B,
      ID_C,
    ]);
    expect(
      buildSavedPluginInstances(
        usePluginDisplayElementStore.getState().elements,
        pluginId,
      ),
    ).toEqual(snapshot);
    // 재배열 diff가 없어 echo가 실변경 커밋으로 이어지지 않는다
    expect(mocks.debounceSchedule).not.toHaveBeenCalled();
    expect(mocks.instancesCommit).not.toHaveBeenCalled();
  });

  it('maxInstances 초과분은 탭별로 잘라내고 원순서를 보존한다', async () => {
    const pluginId = 'plugin-cap-trim';
    defineFor(
      pluginId,
      [
        saved(ID_A, { tabId: '4key' }),
        saved(ID_B, { tabId: '5key' }),
        saved(ID_C, { tabId: '4key' }),
      ],
      { maxInstances: 1 },
    );
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(2));
    expect(defElements(pluginId).map((element) => element.id)).toEqual([
      ID_A,
      ID_B,
    ]);
  });

  it('diff 적용 변이는 저장을 예약하지 않는다', async () => {
    const pluginId = 'plugin-diff-barrier';
    defineFor(pluginId, [saved(ID_A), saved(ID_B)]);
    await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(2));
    // 초기 복원의 add 변이는 save barrier 안 - 예약도 커밋도 없다
    expect(mocks.debounceSchedule).not.toHaveBeenCalled();
    expect(mocks.instancesCommit).not.toHaveBeenCalled();

    // 내용이 같은 canonical 재적용 - 갱신·재배열 diff가 전부 no-op
    await reapply(pluginId, 5, [saved(ID_A), saved(ID_B)]);
    expect(mocks.debounceSchedule).not.toHaveBeenCalled();
    expect(mocks.instancesCommit).not.toHaveBeenCalled();
  });

  describe('staged 저장 배리어', () => {
    const stagedMutation = async (pluginId: string) => {
      defineFor(pluginId, [saved(ID_A)]);
      await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(1));
      // 복원 tracked write 정산 후 staged 변경만 남긴다
      await drainEditorWrites();

      mocks.isStaged.mockReturnValue(true);
      usePluginDisplayElementStore
        .getState()
        .updateElement(`${pluginId}::${ID_A}`, { position: { x: 5, y: 5 } });
      expect(mocks.debounceSchedule).not.toHaveBeenCalled();
    };

    const startDrainProbe = async () => {
      let drained = false;
      const draining = drainEditorWrites().then((result) => {
        drained = true;
        return result;
      });
      await Promise.resolve();
      await Promise.resolve();
      return { draining, isDrained: () => drained };
    };

    it('staged 중 삼킨 변경은 drain을 pending으로 유지하고 release가 해제한다', async () => {
      const pluginId = 'plugin-staged-barrier';
      await stagedMutation(pluginId);

      const probe = await startDrainProbe();
      expect(probe.isDrained()).toBe(false);

      mocks.isStaged.mockReturnValue(false);
      mocks.stagedReleaseListeners.get(pluginId)?.('gesture-release');
      await expect(probe.draining).resolves.toBe(true);
    });

    it('release는 staged gestureId를 계승해 디바운스 없이 즉시 커밋을 개시한다', async () => {
      const pluginId = 'plugin-staged-release';
      await stagedMutation(pluginId);

      mocks.isStaged.mockReturnValue(false);
      mocks.stagedReleaseListeners.get(pluginId)?.('gesture-staged-owner');

      expect(mocks.debounceSchedule).toHaveBeenCalledTimes(1);
      expect(mocks.debounceSchedule).toHaveBeenCalledWith(
        'gesture-staged-owner',
      );
      expect(mocks.debounceFlush).toHaveBeenCalledTimes(1);
      expect(mocks.debounceSchedule.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.debounceFlush.mock.invocationCallOrder[0],
      );

      // pending 없는 재release는 no-op
      mocks.stagedReleaseListeners.get(pluginId)?.('gesture-staged-owner');
      expect(mocks.debounceSchedule).toHaveBeenCalledTimes(1);
    });

    it('staged pending 폐기 경로에서도 drain이 해제된다', async () => {
      const pluginId = 'plugin-staged-cancel';
      await stagedMutation(pluginId);

      const probe = await startDrainProbe();
      expect(probe.isDrained()).toBe(false);

      // undo 재결합과 동일한 cancelPendingSave 경로
      applyCommittedPluginInstancesProjection(pluginId, () => undefined);
      await expect(probe.draining).resolves.toBe(true);
      expect(mocks.debounceCancel).toHaveBeenCalled();

      // 폐기 후 release는 저장을 예약하지 않는다
      mocks.isStaged.mockReturnValue(false);
      mocks.stagedReleaseListeners.get(pluginId)?.('gesture-any');
      expect(mocks.debounceSchedule).not.toHaveBeenCalled();
    });
  });

  describe('거절·실패 canonical 복구', () => {
    const canonical = (positionX: number) => [
      saved(ID_A, { position: { x: positionX, y: 1 } }),
    ];

    const defineWithLocalEdit = async (pluginId: string) => {
      defineFor(pluginId, canonical(1));
      await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(1));
      mocks.instancesGet.mockClear();
      usePluginDisplayElementStore
        .getState()
        .updateElement(`${pluginId}::${ID_A}`, { position: { x: 50, y: 50 } });
      return mocks.saveDebounces[0];
    };

    const mockCanonicalPull = (pluginId: string, revision: number) => {
      mocks.instancesGet.mockResolvedValue({
        pluginId,
        instances: canonical(1),
        modelRevision: revision,
        authorityGeneration: 1,
      });
    };

    it('history 거절 시 canonical을 강제 재주입하고 저장 호출은 성공 정산한다', async () => {
      const pluginId = 'plugin-conflict-reinject';
      const debounce = await defineWithLocalEdit(pluginId);
      mocks.instancesCommit.mockRejectedValueOnce(
        new Error('HISTORY_EPOCH_CONFLICT: history barrier'),
      );
      mockCanonicalPull(pluginId, 7);
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        debounce.save({
          gestureId: 'gesture-token',
          captureCurrentSnapshot: false,
        }),
      ).resolves.toBeUndefined();
      warn.mockRestore();

      expect(mocks.syncHistoryStatus).toHaveBeenCalled();
      // 재주입 전 큐 잔여 스냅샷 폐기 - canonical 되덮기 방지
      expect(mocks.debounceCancel).toHaveBeenCalled();
      expect(mocks.instancesGet).toHaveBeenCalledWith(pluginId);
      expect(findElement(`${pluginId}::${ID_A}`)!.position).toEqual({
        x: 1,
        y: 1,
      });
    });

    it('큐 대기 중 history가 바뀌어도 스냅샷 캡처 시점 epoch를 보낸다', async () => {
      const pluginId = 'plugin-captured-epoch';
      const debounce = await defineWithLocalEdit(pluginId);
      let releaseQueue!: () => void;
      mocks.enqueueGate = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });

      const saving = debounce.save({
        gestureId: 'gesture-before-history',
        captureCurrentSnapshot: true,
      });
      await Promise.resolve();
      mocks.historyEpoch = 2;
      releaseQueue();
      await saving;

      expect(mocks.instancesCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          gestureId: 'gesture-before-history',
          observedHistoryEpoch: 1,
        }),
      );
    });

    it('다른 gesture가 소유 중이면 거절 복구 재주입을 건너뛴다', async () => {
      const pluginId = 'plugin-conflict-skip';
      const debounce = await defineWithLocalEdit(pluginId);
      mocks.instancesCommit.mockRejectedValueOnce(
        new Error('HISTORY_EPOCH_CONFLICT: history barrier'),
      );
      mocks.hasConflicting.mockReturnValue(true);
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        debounce.save({
          gestureId: 'gesture-token',
          captureCurrentSnapshot: false,
        }),
      ).resolves.toBeUndefined();
      warn.mockRestore();

      expect(mocks.hasConflicting).toHaveBeenCalledWith(
        pluginId,
        'gesture-token',
      );
      expect(mocks.syncHistoryStatus).toHaveBeenCalled();
      expect(mocks.instancesGet).not.toHaveBeenCalled();
      expect(mocks.debounceCancel).not.toHaveBeenCalled();
      // 소유 gesture의 로컬 편집은 그대로 유지
      expect(findElement(`${pluginId}::${ID_A}`)!.position).toEqual({
        x: 50,
        y: 50,
      });
    });

    it('재주입 후 trailing save는 1회 no-op으로 수렴한다', async () => {
      const pluginId = 'plugin-conflict-converge';
      const debounce = await defineWithLocalEdit(pluginId);
      mocks.instancesCommit.mockRejectedValueOnce(
        new Error('HISTORY_EPOCH_CONFLICT: history barrier'),
      );
      mockCanonicalPull(pluginId, 7);
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);

      await debounce.save({
        gestureId: 'gesture-token',
        captureCurrentSnapshot: false,
      });
      // 재주입 직후 잔여 trailing save - canonical과 같은 상태를 커밋
      await debounce.save({
        gestureId: 'gesture-token',
        captureCurrentSnapshot: false,
      });
      warn.mockRestore();

      expect(mocks.instancesCommit).toHaveBeenCalledTimes(2);
      expect(mocks.instancesGet).toHaveBeenCalledTimes(1);
      const [trailingRequest] = mocks.instancesCommit.mock
        .calls[1] as unknown as [{ instances: SavedInstance[] }];
      expect(trailingRequest.instances[0].position).toEqual({ x: 1, y: 1 });
      expect(findElement(`${pluginId}::${ID_A}`)!.position).toEqual({
        x: 1,
        y: 1,
      });
    });

    it('디바운스 저장 실패는 canonical 롤백을 수행한다', async () => {
      const pluginId = 'plugin-save-error-rollback';
      const debounce = await defineWithLocalEdit(pluginId);
      mockCanonicalPull(pluginId, 9);
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      debounce.onError(new Error('save failed'), {
        gestureId: 'gesture-token',
        captureCurrentSnapshot: false,
      });
      await vi.waitFor(() =>
        expect(findElement(`${pluginId}::${ID_A}`)!.position).toEqual({
          x: 1,
          y: 1,
        }),
      );

      // 다른 gesture 소유 중이면 롤백 스킵
      mocks.instancesGet.mockClear();
      mocks.hasConflicting.mockReturnValue(true);
      debounce.onError(new Error('save failed'), {
        gestureId: 'gesture-token',
        captureCurrentSnapshot: false,
      });
      await Promise.resolve();
      consoleError.mockRestore();
      expect(mocks.instancesGet).not.toHaveBeenCalled();
    });

    it('플러그인 self update 스트림은 여전히 200ms 디바운스 예약만 한다', async () => {
      const pluginId = 'plugin-update-stream';
      defineFor(pluginId, [saved(ID_A)]);
      await vi.waitFor(() => expect(defElements(pluginId)).toHaveLength(1));

      expect(mocks.saveDebounces[0].delayMs).toBe(200);

      usePluginDisplayElementStore
        .getState()
        .updateElement(`${pluginId}::${ID_A}`, { position: { x: 2, y: 2 } });
      usePluginDisplayElementStore
        .getState()
        .updateElement(`${pluginId}::${ID_A}`, { position: { x: 3, y: 3 } });

      expect(mocks.debounceSchedule).toHaveBeenCalledTimes(2);
      expect(mocks.debounceFlush).not.toHaveBeenCalled();
      expect(mocks.flushEditSession).not.toHaveBeenCalled();
    });
  });
});
