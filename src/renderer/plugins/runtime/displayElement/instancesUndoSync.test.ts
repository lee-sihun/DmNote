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

vi.mock('@api/modules/pluginInstancesApi', () => ({
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
      // 재주입은 fullId를 새로 발급 - 옛 요소를 새 요소로 통째 교체
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
