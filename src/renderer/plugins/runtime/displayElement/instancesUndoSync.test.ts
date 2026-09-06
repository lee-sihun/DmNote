import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';

import {
  applyCanonicalPluginInstances,
  applyCommittedPluginInstancesProjection,
  registerPluginInstancesReapplier,
} from './instancesUndoSync';

const { instancesGetMock } = vi.hoisted(() => ({
  instancesGetMock: vi.fn(),
}));

vi.mock('@api/modules/plugin/pluginInstancesApi', () => ({
  pluginInstancesApi: { get: instancesGetMock, onChanged: vi.fn() },
}));

describe('plugin instances committed projection', () => {
  it('projection 구독이 예약한 trailing save를 적용 직후 취소한다', () => {
    const order: string[] = [];
    const cancelPendingSave = vi.fn(() => order.push('cancel'));
    const unregister = registerPluginInstancesReapplier(
      'plugin-projection',
      'definition-a',
      {
        cancelPendingSave,
        reapply: vi.fn(),
      },
    );

    applyCommittedPluginInstancesProjection('plugin-projection', () => {
      order.push('apply');
    });

    expect(order).toEqual(['apply', 'cancel']);
    expect(cancelPendingSave).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('해제된 definition의 저장 취소 핸들러는 호출하지 않는다', () => {
    const cancelPendingSave = vi.fn();
    const unregister = registerPluginInstancesReapplier(
      'plugin-unloaded',
      'definition-a',
      {
        cancelPendingSave,
        reapply: vi.fn(),
      },
    );
    unregister();

    applyCommittedPluginInstancesProjection('plugin-unloaded', vi.fn());

    expect(cancelPendingSave).not.toHaveBeenCalled();
  });
});

describe('canonical 재주입 후 선택 정리', () => {
  const pluginElement = (pluginId: string, suffix: string) => ({
    id: suffix,
    fullId: `${pluginId}:${suffix}`,
    pluginId,
    html: '<div />',
    position: { x: 0, y: 0 },
  });

  beforeEach(() => {
    instancesGetMock.mockReset();
    useGridSelectionStore.setState({ selectedElements: [] });
    usePluginDisplayElementStore.setState({ elements: [] });
  });

  it('canonical 재주입 후 옛 plugin 선택을 정리한다', async () => {
    const pluginId = 'plugin-prune-a';
    usePluginDisplayElementStore.setState({
      elements: [pluginElement(pluginId, 'old')],
    });
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'plugin', id: `${pluginId}:old` },
      { type: 'key', id: '11111111-1111-4111-8111-111111111111', index: 0 },
    ]);
    const unregister = registerPluginInstancesReapplier(pluginId, 'def-a', {
      cancelPendingSave: vi.fn(),
      // diff 적용은 생존 fullId를 보존한다 - 스냅샷에 없는 옛 요소만 소멸하고
      // 신규가 추가된 상황 (소멸 fullId를 쥔 선택이 prune 대상)
      reapply: () => {
        usePluginDisplayElementStore.setState({
          elements: [pluginElement(pluginId, 'new')],
        });
      },
    });
    instancesGetMock.mockResolvedValue({ modelRevision: 5, instances: [] });

    await applyCanonicalPluginInstances(pluginId);

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: '11111111-1111-4111-8111-111111111111', index: 0 },
    ]);
    unregister();
  });

  it('다른 플러그인의 pull은 리로드 공백 중인 플러그인 선택을 지우지 않는다', async () => {
    const pulled = 'plugin-prune-pulled';
    const idle = 'plugin-prune-idle';
    // idle 플러그인은 리로드 공백 - reapplier는 등록됐지만 인스턴스 복원이
    // setTimeout+비동기 IPC라 요소가 아직 스토어에 없다
    usePluginDisplayElementStore.setState({
      elements: [pluginElement(pulled, 'own')],
    });
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'plugin', id: `${idle}:alive` },
      { type: 'plugin', id: `${pulled}:own` },
    ]);
    const unregister = registerPluginInstancesReapplier(pulled, 'def-p', {
      cancelPendingSave: vi.fn(),
      reapply: () => {
        usePluginDisplayElementStore.setState({
          elements: [pluginElement(pulled, 'own')],
        });
      },
    });
    instancesGetMock.mockResolvedValue({ modelRevision: 9, instances: [] });

    await applyCanonicalPluginInstances(pulled);

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'plugin', id: `${idle}:alive` },
      { type: 'plugin', id: `${pulled}:own` },
    ]);
    unregister();
  });

  it('생존 fullId를 보존한 diff 재적용은 선택을 유지한다', async () => {
    const pluginId = 'plugin-prune-kept';
    usePluginDisplayElementStore.setState({
      elements: [pluginElement(pluginId, 'kept')],
    });
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'plugin', id: `${pluginId}:kept` }]);
    const reference = useGridSelectionStore.getState().selectedElements;
    const unregister = registerPluginInstancesReapplier(pluginId, 'def-kept', {
      cancelPendingSave: vi.fn(),
      // diff 적용: 같은 fullId가 생존하고 소유 필드만 갱신된 상황
      reapply: () => {
        usePluginDisplayElementStore.setState({
          elements: [
            { ...pluginElement(pluginId, 'kept'), position: { x: 9, y: 9 } },
          ],
        });
      },
    });
    instancesGetMock.mockResolvedValue({ modelRevision: 5, instances: [] });

    await applyCanonicalPluginInstances(pluginId);

    // prune no-op - 생존 fullId를 쥔 선택이 그대로 유지된다
    expect(useGridSelectionStore.getState().selectedElements).toBe(reference);
    unregister();
  });

  it('reapplier 미등록이면 선택을 건드리지 않는다', async () => {
    const pluginId = 'plugin-prune-b';
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'plugin', id: `${pluginId}:dead` }]);
    const reference = useGridSelectionStore.getState().selectedElements;
    instancesGetMock.mockResolvedValue({ modelRevision: 1, instances: [] });

    await applyCanonicalPluginInstances(pluginId);

    expect(useGridSelectionStore.getState().selectedElements).toBe(reference);
  });

  it('낡은 revision pull은 선택을 건드리지 않는다', async () => {
    const pluginId = 'plugin-prune-c';
    usePluginDisplayElementStore.setState({
      elements: [pluginElement(pluginId, 'kept')],
    });
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'plugin', id: `${pluginId}:kept` }]);
    const unregister = registerPluginInstancesReapplier(pluginId, 'def-c', {
      cancelPendingSave: vi.fn(),
      reapply: vi.fn(),
    });
    instancesGetMock.mockResolvedValue({ modelRevision: 5, instances: [] });
    await applyCanonicalPluginInstances(pluginId);

    // 늦게 도착한 낡은 pull - 단조 게이트가 reapply와 prune 모두 스킵
    usePluginDisplayElementStore.setState({ elements: [] });
    const reference = useGridSelectionStore.getState().selectedElements;
    instancesGetMock.mockResolvedValue({ modelRevision: 4, instances: [] });

    await applyCanonicalPluginInstances(pluginId);

    expect(useGridSelectionStore.getState().selectedElements).toBe(reference);
    unregister();
  });
});
