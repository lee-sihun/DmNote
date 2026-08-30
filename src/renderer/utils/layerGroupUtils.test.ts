import { describe, expect, it } from 'vitest';

import {
  isPluginGroupMemberInMode,
  normalizeLayerGroupsForMode,
} from './layerGroupUtils';

const emptyPositions = {
  keyPositions: {},
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  spritePositions: {},
};

// Rust remove_empty_layer_groups와 같은 시나리오를 고정하는 교차 테스트 -
// 모드 판정(tab_id normalize)이 갈리면 커밋마다 가짜 diff가 생긴다
describe('normalizeLayerGroupsForMode plugin member counting', () => {
  it('플러그인 멤버만 남은 그룹은 생존한다', () => {
    const normalized = normalizeLayerGroupsForMode({
      mode: '4key',
      ...emptyPositions,
      layerGroups: { '4key': [{ id: 'group-a', name: 'A' }] },
      pluginElements: [{ tabId: '4key', groupId: 'group-a' }],
    });

    expect(normalized.groupsChanged).toBe(false);
    expect(normalized.layerGroups['4key']).toEqual([
      { id: 'group-a', name: 'A' },
    ]);
  });

  it('멤버가 전혀 없는 그룹은 제거된다', () => {
    const normalized = normalizeLayerGroupsForMode({
      mode: '4key',
      ...emptyPositions,
      layerGroups: { '4key': [{ id: 'group-a', name: 'A' }] },
      pluginElements: [],
    });

    expect(normalized.groupsChanged).toBe(true);
    expect(normalized.removedGroupIds).toEqual(['group-a']);
  });

  it('다른 모드 플러그인의 groupId는 집계에 넣지 않는다', () => {
    const normalized = normalizeLayerGroupsForMode({
      mode: '4key',
      ...emptyPositions,
      layerGroups: { '4key': [{ id: 'group-a', name: 'A' }] },
      pluginElements: [{ tabId: '7key', groupId: 'group-a' }],
    });

    expect(normalized.groupsChanged).toBe(true);
    expect(normalized.removedGroupIds).toEqual(['group-a']);
  });

  it('tabId 없는 플러그인은 저장 규칙대로 4key 멤버로만 집계한다', () => {
    const keep = normalizeLayerGroupsForMode({
      mode: '4key',
      ...emptyPositions,
      layerGroups: { '4key': [{ id: 'group-a', name: 'A' }] },
      pluginElements: [{ tabId: undefined, groupId: 'group-a' }],
    });
    expect(keep.groupsChanged).toBe(false);

    const drop = normalizeLayerGroupsForMode({
      mode: '7key',
      ...emptyPositions,
      layerGroups: { '7key': [{ id: 'group-b', name: 'B' }] },
      pluginElements: [{ tabId: undefined, groupId: 'group-b' }],
    });
    expect(drop.groupsChanged).toBe(true);
  });

  it('groupId 없는 플러그인은 그룹 생존에 기여하지 않는다', () => {
    const normalized = normalizeLayerGroupsForMode({
      mode: '4key',
      ...emptyPositions,
      layerGroups: { '4key': [{ id: 'group-a', name: 'A' }] },
      pluginElements: [{ tabId: '4key', groupId: undefined }],
    });

    expect(normalized.groupsChanged).toBe(true);
  });
});

describe('isPluginGroupMemberInMode', () => {
  it('저장 규칙(tab_id normalize)과 동일하게 판정한다', () => {
    expect(isPluginGroupMemberInMode({ tabId: '4key' }, '4key')).toBe(true);
    expect(isPluginGroupMemberInMode({ tabId: '7key' }, '4key')).toBe(false);
    // 미지정 tabId는 4key로 저장되므로 4key 멤버
    expect(isPluginGroupMemberInMode({ tabId: undefined }, '4key')).toBe(true);
    expect(isPluginGroupMemberInMode({ tabId: undefined }, '7key')).toBe(false);
  });
});
