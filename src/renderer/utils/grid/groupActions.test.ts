import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import { groupSelectedElements, ungroupSelectedElements } from './groupActions';

const mocks = vi.hoisted(() => ({
  commitPatch: vi.fn(() => Promise.resolve()),
  setElementGroups: vi.fn(() => Promise.resolve(true)),
  setElementGroupsViaAuthority: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitPatch: mocks.commitPatch },
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  setElementGroupsByTargets: mocks.setElementGroups,
}));

vi.mock('@plugins/rpc/pluginElementActions', () => ({
  setElementGroupsViaAuthority: mocks.setElementGroupsViaAuthority,
}));

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

describe('grid group structural routes', () => {
  beforeEach(() => {
    mocks.commitPatch.mockClear();
    mocks.setElementGroups.mockClear();
    mocks.setElementGroups.mockResolvedValue(true);
    mocks.setElementGroupsViaAuthority.mockClear();
    mocks.setElementGroupsViaAuthority.mockResolvedValue(true);
    window.__dmn_window_type = 'main';
    seedKey();
  });

  it('stable selection은 현재 ID의 existing group descriptor를 쓴다', async () => {
    seedKey('group-a');

    await expect(
      groupSelectedElements(
        '4key',
        [
          { type: 'key', id: ID_A, index: 99 },
          { type: 'plugin', id: 'plugin-a:item', index: 0 },
        ],
        'New Group',
      ),
    ).resolves.toBe(true);

    expect(mocks.setElementGroups).toHaveBeenCalledWith(
      '4key',
      [{ elementType: 'key', id: ID_A }],
      { kind: 'existing', id: 'group-a' },
    );
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('stable ungroup은 panel authority에 frozen native targets만 보낸다', async () => {
    window.__dmn_window_type = 'panel';

    await expect(
      ungroupSelectedElements('4key', [
        { type: 'key', id: ID_A, index: 5 },
        { type: 'plugin', id: 'plugin-a:item', index: 0 },
      ]),
    ).resolves.toBe(true);

    expect(mocks.setElementGroupsViaAuthority).toHaveBeenCalledWith(
      '4key',
      [{ elementType: 'key', id: ID_A }],
      null,
    );
    expect(mocks.setElementGroups).not.toHaveBeenCalled();
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

    expect(mocks.setElementGroups).toHaveBeenCalledWith(
      '4key',
      [{ elementType: 'key', id: ID_A }],
      null,
    );
  });

  it('synthetic native selection은 whole-record legacy를 유지한다', async () => {
    seedKey('group-a');
    await expect(
      ungroupSelectedElements('4key', [{ type: 'key', id: 'key-0', index: 0 }]),
    ).resolves.toBe(true);

    expect(mocks.setElementGroups).not.toHaveBeenCalled();
    expect(mocks.setElementGroupsViaAuthority).not.toHaveBeenCalled();
    expect(mocks.commitPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        keyPositions: expect.any(Object),
        layerGroups: expect.any(Object),
      }),
    );
  });

  it('plugin-only와 empty selection은 native writer를 호출하지 않는다', async () => {
    await expect(
      groupSelectedElements(
        '4key',
        [{ type: 'plugin', id: 'plugin-a:item', index: 0 }],
        'New Group',
      ),
    ).resolves.toBe(false);
    await expect(ungroupSelectedElements('4key', [])).resolves.toBe(false);

    expect(mocks.setElementGroups).not.toHaveBeenCalled();
    expect(mocks.setElementGroupsViaAuthority).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });
});
