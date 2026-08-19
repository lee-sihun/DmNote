import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

import { groupSelectedElements, ungroupSelectedElements } from './groupActions';

const mocks = vi.hoisted(() => ({
  commitPatch: vi.fn(() => Promise.resolve()),
  setMixedElementGroups: vi.fn(() => Promise.resolve(true)),
  setElementGroupsViaAuthority: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitPatch: mocks.commitPatch },
}));

vi.mock('@src/renderer/editor/runtime/mixedElementGroups', () => ({
  setMixedElementGroups: mocks.setMixedElementGroups,
}));

vi.mock('@plugins/runtime/displayElement/pluginElementActions', () => ({
  setElementGroupsViaAuthority: mocks.setElementGroupsViaAuthority,
}));

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLUGIN_FULL_ID = 'plugin-a::11111111-1111-4111-8111-111111111111';

const seedKey = (groupId?: string) => {
  const position = { ...createDefaultKeyPosition(), id: ID_A, groupId };
  useKeyStore.setState({
    positions: { '4key': [position] },
    canonicalPositions: { '4key': [position] },
  });
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useLayerGroupStore.setState({
    layerGroups: groupId ? { '4key': [{ id: groupId, name: 'Existing' }] } : {},
  });
};

const seedPluginElement = (groupId?: string) => {
  usePluginDisplayElementStore.setState({
    elements: [
      {
        id: PLUGIN_FULL_ID.split('::')[1],
        fullId: PLUGIN_FULL_ID,
        pluginId: 'plugin-a',
        definitionId: 'plugin-a',
        position: { x: 0, y: 0 },
        tabId: '4key',
        groupId,
      } as unknown as PluginDisplayElementInternal,
    ],
  });
};

describe('grid group structural routes', () => {
  beforeEach(() => {
    mocks.commitPatch.mockClear();
    mocks.setMixedElementGroups.mockClear();
    mocks.setMixedElementGroups.mockResolvedValue(true);
    mocks.setElementGroupsViaAuthority.mockClear();
    mocks.setElementGroupsViaAuthority.mockResolvedValue(true);
    window.__dmn_window_type = 'main';
    seedKey();
    seedPluginElement();
  });

  it('stable selection은 현재 ID의 existing group descriptor를 쓴다', async () => {
    seedKey('group-a');

    await expect(
      groupSelectedElements(
        '4key',
        [
          { type: 'key', id: ID_A, index: 99 },
          { type: 'plugin', id: PLUGIN_FULL_ID },
        ],
        'New Group',
      ),
    ).resolves.toBe(true);

    expect(mocks.setMixedElementGroups).toHaveBeenCalledWith(
      '4key',
      [{ elementType: 'key', id: ID_A }],
      [PLUGIN_FULL_ID],
      { kind: 'existing', id: 'group-a' },
    );
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('플러그인 소속도 existing group 판정에 포함된다', async () => {
    seedKey('group-a');
    seedPluginElement('group-a');
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...createDefaultKeyPosition(), id: ID_A }],
      },
    });

    await expect(
      groupSelectedElements(
        '4key',
        [
          { type: 'key', id: ID_A, index: 0 },
          { type: 'plugin', id: PLUGIN_FULL_ID },
        ],
        'New Group',
      ),
    ).resolves.toBe(true);

    expect(mocks.setMixedElementGroups).toHaveBeenCalledWith(
      '4key',
      [{ elementType: 'key', id: ID_A }],
      [PLUGIN_FULL_ID],
      { kind: 'existing', id: 'group-a' },
    );
  });

  it('모드에 def가 없는 plugin groupId는 재사용하지 않고 새 그룹을 만든다', async () => {
    seedPluginElement('group-missing');

    await expect(
      groupSelectedElements(
        '4key',
        [
          { type: 'key', id: ID_A, index: 0 },
          { type: 'plugin', id: PLUGIN_FULL_ID },
        ],
        'New Group',
      ),
    ).resolves.toBe(true);

    const [, , , targetGroup] = mocks.setMixedElementGroups.mock
      .calls[0] as unknown as [
      string,
      unknown[],
      string[],
      { kind: string; id: string },
    ];
    expect(targetGroup.kind).toBe('create');
    expect(targetGroup.id).not.toBe('group-missing');
  });

  it('plugin-only 선택도 그룹 생성 대상으로 수용한다', async () => {
    await expect(
      groupSelectedElements(
        '4key',
        [{ type: 'plugin', id: PLUGIN_FULL_ID }],
        'New Group',
      ),
    ).resolves.toBe(true);

    expect(mocks.setMixedElementGroups).toHaveBeenCalledTimes(1);
    const [mode, nativeTargets, pluginTargets, targetGroup] = mocks
      .setMixedElementGroups.mock.calls[0] as unknown as [
      string,
      unknown[],
      string[],
      { kind: string; id: string; name?: string },
    ];
    expect(mode).toBe('4key');
    expect(nativeTargets).toEqual([]);
    expect(pluginTargets).toEqual([PLUGIN_FULL_ID]);
    expect(targetGroup.kind).toBe('create');
    expect(targetGroup.name).toBe('New Group 1');
  });

  it('stable ungroup은 클릭 뒤 store reorder와 무관하게 원래 ID를 유지한다', async () => {
    const selected = [{ type: 'key' as const, id: ID_A, index: 0 }];
    const pending = ungroupSelectedElements('4key', selected);
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [
          {
            ...createDefaultKeyPosition(),
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        ],
      },
    });

    await pending;

    expect(mocks.setMixedElementGroups).toHaveBeenCalledWith(
      '4key',
      [{ elementType: 'key', id: ID_A }],
      [],
      null,
    );
  });

  it('invalid native selection은 fail-closed로 writer를 호출하지 않는다', async () => {
    seedKey('group-a');
    await expect(
      ungroupSelectedElements('4key', [{ type: 'key', id: 'key-0', index: 0 }]),
    ).resolves.toBe(false);

    expect(mocks.setMixedElementGroups).not.toHaveBeenCalled();
    expect(mocks.setElementGroupsViaAuthority).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('empty selection은 writer를 호출하지 않는다', async () => {
    await expect(ungroupSelectedElements('4key', [])).resolves.toBe(false);

    expect(mocks.setMixedElementGroups).not.toHaveBeenCalled();
    expect(mocks.setElementGroupsViaAuthority).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });
});
