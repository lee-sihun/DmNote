import { beforeEach, describe, expect, it } from 'vitest';

import { normalizeLayerGroupsForMode } from '@utils/layerGroupUtils';

import {
  currentPluginGroupMembers,
  registerLoadedPluginIdsProvider,
  registerPluginGroupMemberProvider,
  registerStoredPluginGroupRefsProvider,
} from './pluginGroupMembers';

const emptyPositions = {
  keyPositions: {},
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
};

beforeEach(() => {
  registerPluginGroupMemberProvider(() => []);
  registerLoadedPluginIdsProvider(() => new Set());
  registerStoredPluginGroupRefsProvider(() => ({}));
});

describe('currentPluginGroupMembers 병합 규칙', () => {
  it('제공자 미등록(기본) 상태는 빈 목록이다', () => {
    expect(currentPluginGroupMembers()).toEqual([]);
  });

  it('로드된 플러그인은 런타임 요소를 그대로 반환한다', () => {
    registerPluginGroupMemberProvider(() => [
      { tabId: '4key', groupId: 'group-a' },
      { tabId: '6key', groupId: undefined },
    ]);

    expect(currentPluginGroupMembers()).toEqual([
      { tabId: '4key', groupId: 'group-a' },
      { tabId: '6key', groupId: undefined },
    ]);
  });

  it('미로드 플러그인의 저장 그룹 참조를 미러에서 보충한다', () => {
    registerPluginGroupMemberProvider(() => [
      { tabId: '4key', groupId: 'runtime-group' },
    ]);
    registerStoredPluginGroupRefsProvider(() => ({
      'idle-plugin': { '4key': ['stored-a'], '6key': ['stored-b'] },
    }));

    expect(currentPluginGroupMembers()).toEqual([
      { tabId: '4key', groupId: 'runtime-group' },
      { tabId: '4key', groupId: 'stored-a' },
      { tabId: '6key', groupId: 'stored-b' },
    ]);
  });

  it('로드된 플러그인의 저장 참조는 무시한다 - 런타임 요소가 원본', () => {
    // eager 로컬 삭제가 아직 커밋되지 않은 창에서 store의 낡은 참조가
    // 런타임 상태를 덮으면 안 된다
    registerPluginGroupMemberProvider(() => []);
    registerLoadedPluginIdsProvider(() => new Set(['loaded-plugin']));
    registerStoredPluginGroupRefsProvider(() => ({
      'loaded-plugin': { '4key': ['stale-group'] },
      'idle-plugin': { '4key': ['stored-a'] },
    }));

    expect(currentPluginGroupMembers()).toEqual([
      { tabId: '4key', groupId: 'stored-a' },
    ]);
  });

  it('미러 미초기화 창은 런타임 요소만 반환한다 (기존 동작 폴백)', () => {
    registerPluginGroupMemberProvider(() => [
      { tabId: '4key', groupId: 'runtime-group' },
    ]);

    expect(currentPluginGroupMembers()).toEqual([
      { tabId: '4key', groupId: 'runtime-group' },
    ]);
  });
});

// F1 재현 회귀: 미로드 플러그인이 그룹의 유일 멤버일 때 native 삭제 replay가
// 그룹 생존을 예측해야 한다 - Rust remove_empty_layer_groups는 store 전체
// 인스턴스를 보므로 프론트 모집단이 좁으면 EditorProtocolError나 def 무음
// 파괴로 이어진다
describe('normalize replay 모집단 정합', () => {
  it('미로드 플러그인이 유일 멤버인 그룹은 native 삭제 후에도 잔존한다', () => {
    registerStoredPluginGroupRefsProvider(() => ({
      'idle-plugin': { '4key': ['group-g'] },
    }));

    // native 멤버는 이미 삭제된 상태의 replay - 남은 멤버는 store 인스턴스뿐
    const normalized = normalizeLayerGroupsForMode({
      mode: '4key',
      ...emptyPositions,
      layerGroups: { '4key': [{ id: 'group-g', name: 'G' }] },
      pluginElements: currentPluginGroupMembers(),
    });

    expect(normalized.groupsChanged).toBe(false);
    expect(normalized.layerGroups['4key']).toEqual([
      { id: 'group-g', name: 'G' },
    ]);
  });

  it('미러가 비어 있으면 기존과 동일하게 그룹이 해체된다', () => {
    const normalized = normalizeLayerGroupsForMode({
      mode: '4key',
      ...emptyPositions,
      layerGroups: { '4key': [{ id: 'group-g', name: 'G' }] },
      pluginElements: currentPluginGroupMembers(),
    });

    expect(normalized.groupsChanged).toBe(true);
    expect(normalized.removedGroupIds).toEqual(['group-g']);
  });
});
