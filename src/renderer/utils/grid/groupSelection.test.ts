/**
 * 캔버스 클릭 그룹 확장 선택 테스트
 * 혼합 그룹(native+플러그인)에서 어느 멤버를 클릭해도 전체가 선택되어야 한다
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

import {
  expandGroupSelection,
  expandGroupSelectionFromStores,
  type GroupSelectionSource,
} from './groupSelection';

const GROUP_ID = 'group-1';
const KEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOLO_KEY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLUGIN_FULL_ID = 'plugin-a::11111111-1111-4111-8111-111111111111';
const OTHER_PLUGIN_FULL_ID = 'plugin-a::22222222-2222-4222-8222-222222222222';

const pluginElement = (fullId: string, groupId?: string, tabId?: string) =>
  ({ fullId, groupId, tabId } as Pick<
    PluginDisplayElementInternal,
    'fullId' | 'tabId' | 'groupId'
  >);

const mixedSource = (
  overrides: Partial<GroupSelectionSource> = {},
): GroupSelectionSource => ({
  mode: '4key',
  keyPositions: [{ id: KEY_ID, groupId: GROUP_ID }, { id: SOLO_KEY_ID }],
  statPositions: [{ id: STAT_ID, groupId: GROUP_ID }],
  graphPositions: [],
  knobPositions: [],
  spritePositions: [],
  pluginElements: [pluginElement(PLUGIN_FULL_ID, GROUP_ID, '4key')],
  modeGroups: [{ id: GROUP_ID }],
  ...overrides,
});

describe('expandGroupSelection', () => {
  it('혼합 그룹의 native 멤버 클릭은 플러그인 멤버까지 전체 선택한다', () => {
    const result = expandGroupSelection(
      { type: 'key', id: KEY_ID, index: 0 },
      mixedSource(),
    );

    expect(result).toEqual([
      { type: 'key', id: KEY_ID, index: 0 },
      { type: 'stat', id: STAT_ID, index: 0 },
      { type: 'plugin', id: PLUGIN_FULL_ID },
    ]);
  });

  it('플러그인 멤버 클릭도 native 멤버까지 전체 선택한다', () => {
    const result = expandGroupSelection(
      { type: 'plugin', id: PLUGIN_FULL_ID },
      mixedSource(),
    );

    expect(result).toEqual([
      { type: 'plugin', id: PLUGIN_FULL_ID },
      { type: 'key', id: KEY_ID, index: 0 },
      { type: 'stat', id: STAT_ID, index: 0 },
    ]);
  });

  it('native 전용 그룹은 기존 확장 동작을 유지한다', () => {
    const result = expandGroupSelection(
      { type: 'key', id: KEY_ID, index: 0 },
      mixedSource({ pluginElements: [] }),
    );

    expect(result).toEqual([
      { type: 'key', id: KEY_ID, index: 0 },
      { type: 'stat', id: STAT_ID, index: 0 },
    ]);
  });

  it('그룹 def가 없는 dangling groupId는 확장하지 않는다', () => {
    const source = mixedSource({ modeGroups: [] });

    expect(
      expandGroupSelection({ type: 'key', id: KEY_ID, index: 0 }, source),
    ).toEqual([{ type: 'key', id: KEY_ID, index: 0 }]);
    expect(
      expandGroupSelection({ type: 'plugin', id: PLUGIN_FULL_ID }, source),
    ).toEqual([{ type: 'plugin', id: PLUGIN_FULL_ID }]);
  });

  it('그룹 미소속 요소 클릭은 단일 선택을 유지한다', () => {
    const source = mixedSource({
      pluginElements: [pluginElement(OTHER_PLUGIN_FULL_ID, undefined, '4key')],
    });

    expect(
      expandGroupSelection({ type: 'key', id: SOLO_KEY_ID, index: 1 }, source),
    ).toEqual([{ type: 'key', id: SOLO_KEY_ID, index: 1 }]);
    expect(
      expandGroupSelection(
        { type: 'plugin', id: OTHER_PLUGIN_FULL_ID },
        source,
      ),
    ).toEqual([{ type: 'plugin', id: OTHER_PLUGIN_FULL_ID }]);
  });

  it('다른 탭의 플러그인 멤버는 제외하고 tabId 없는 요소는 포함한다', () => {
    const result = expandGroupSelection(
      { type: 'key', id: KEY_ID, index: 0 },
      mixedSource({
        pluginElements: [
          pluginElement(PLUGIN_FULL_ID, GROUP_ID, '5key'),
          pluginElement(OTHER_PLUGIN_FULL_ID, GROUP_ID),
        ],
      }),
    );

    expect(result).toEqual([
      { type: 'key', id: KEY_ID, index: 0 },
      { type: 'stat', id: STAT_ID, index: 0 },
      { type: 'plugin', id: OTHER_PLUGIN_FULL_ID },
    ]);
  });
});

describe('expandGroupSelectionFromStores', () => {
  beforeEach(() => {
    const keyPosition = {
      ...createDefaultKeyPosition(),
      id: KEY_ID,
      groupId: GROUP_ID,
    };
    useKeyStore.setState({
      positions: { '4key': [keyPosition] },
      canonicalPositions: { '4key': [keyPosition] },
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group' }] },
    });
    usePluginDisplayElementStore.setState({
      elements: [
        pluginElement(
          PLUGIN_FULL_ID,
          GROUP_ID,
          '4key',
        ) as PluginDisplayElementInternal,
      ],
    });
    useGridSelectionStore.setState({
      selectedElements: [],
      selectedGroupIds: [],
    });
  });

  it('스토어 스냅샷으로 확장하고 선택 스토어에 반영된다', () => {
    const expanded = expandGroupSelectionFromStores(
      { type: 'plugin', id: PLUGIN_FULL_ID },
      '4key',
    );
    useGridSelectionStore.getState().setSelectedElements(expanded);

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'plugin', id: PLUGIN_FULL_ID },
      { type: 'key', id: KEY_ID, index: 0 },
    ]);
  });

  it('모드에 그룹 def가 없으면 단일 선택으로 남는다', () => {
    useLayerGroupStore.setState({ layerGroups: {} });

    expect(
      expandGroupSelectionFromStores(
        { type: 'plugin', id: PLUGIN_FULL_ID },
        '4key',
      ),
    ).toEqual([{ type: 'plugin', id: PLUGIN_FULL_ID }]);
  });
});
