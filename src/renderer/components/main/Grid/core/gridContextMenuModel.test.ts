import { describe, expect, it } from 'vitest';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { GroupSelectionSource } from '@utils/grid/groupSelection';
import {
  buildMixedSelectionMenuItems,
  gridAddTypeForMenuItem,
  isStableNativeSelection,
  shouldOpenMixedSelectionMenu,
} from './gridContextMenuModel';

const t = (key: string) => key;

const source = (
  overrides: Partial<GroupSelectionSource> = {},
): GroupSelectionSource => ({
  mode: 'default',
  keyPositions: [],
  statPositions: [],
  graphPositions: [],
  knobPositions: [],
  pluginElements: [],
  modeGroups: [{ id: 'group-a' }, { id: 'group-b' }],
  ...overrides,
});

const ids = (items: ReturnType<typeof buildMixedSelectionMenuItems>) =>
  items.map((item) => item.id);

describe('gridContextMenuModel', () => {
  it('단일 선택은 그룹 상태를 읽지 않고 기존 공통 메뉴 순서를 유지한다', () => {
    expect(
      ids(
        buildMixedSelectionMenuItems(
          [{ type: 'key', id: 'key:one', index: 0 }],
          null,
          t,
        ),
      ),
    ).toEqual(['delete', 'duplicate', 'bringToFront', 'sendToBack']);
  });

  it('그룹이 없는 다중 선택에는 그룹화만 노출한다', () => {
    const selected: SelectedElement[] = [
      { type: 'key', id: 'key:one', index: 0 },
      { type: 'stat', id: 'stat:one', index: 0 },
    ];
    expect(
      ids(
        buildMixedSelectionMenuItems(
          selected,
          source({
            keyPositions: [{ id: 'key:one' }],
            statPositions: [{ id: 'stat:one' }],
          }),
          t,
        ),
      ),
    ).toEqual([
      'delete',
      'duplicate',
      'groupSelected',
      'bringToFront',
      'sendToBack',
    ]);
  });

  it('같은 그룹의 native와 plugin 선택에는 그룹 해제만 노출한다', () => {
    const selected: SelectedElement[] = [
      { type: 'key', id: 'key:one', index: 0 },
      { type: 'plugin', id: 'plugin:one' },
    ];
    expect(
      ids(
        buildMixedSelectionMenuItems(
          selected,
          source({
            keyPositions: [{ id: 'key:one', groupId: 'group-a' }],
            pluginElements: [
              {
                fullId: 'plugin:one',
                tabId: 'default',
                groupId: 'group-a',
              },
            ],
          }),
          t,
        ),
      ),
    ).toEqual([
      'delete',
      'duplicate',
      'ungroupSelected',
      'bringToFront',
      'sendToBack',
    ]);
  });

  it('그룹 소속이 섞인 선택에는 그룹화와 해제를 기존 순서로 모두 노출한다', () => {
    const selected: SelectedElement[] = [
      { type: 'key', id: 'key:one', index: 0 },
      { type: 'graph', id: 'graph:one', index: 0 },
    ];
    expect(
      ids(
        buildMixedSelectionMenuItems(
          selected,
          source({
            keyPositions: [{ id: 'key:one', groupId: 'group-a' }],
            graphPositions: [{ id: 'graph:one' }],
          }),
          t,
        ),
      ),
    ).toEqual([
      'delete',
      'duplicate',
      'groupSelected',
      'ungroupSelected',
      'bringToFront',
      'sendToBack',
    ]);
  });

  it('native dangling group은 해제 대상으로, plugin dangling group은 무소속으로 유지한다', () => {
    const danglingNative: SelectedElement[] = [
      { type: 'key', id: 'key:one', index: 0 },
      { type: 'stat', id: 'stat:one', index: 0 },
    ];
    expect(
      ids(
        buildMixedSelectionMenuItems(
          danglingNative,
          source({
            keyPositions: [{ id: 'key:one', groupId: 'missing' }],
            statPositions: [{ id: 'stat:one', groupId: 'missing' }],
          }),
          t,
        ),
      ),
    ).toContain('ungroupSelected');

    const danglingPlugins: SelectedElement[] = [
      { type: 'plugin', id: 'plugin:one' },
      { type: 'plugin', id: 'plugin:two' },
    ];
    expect(
      ids(
        buildMixedSelectionMenuItems(
          danglingPlugins,
          source({
            pluginElements: [
              { fullId: 'plugin:one', groupId: 'missing' },
              { fullId: 'plugin:two', groupId: 'missing' },
            ],
          }),
          t,
        ),
      ),
    ).toContain('groupSelected');
  });

  it('혼합 메뉴는 둘 이상의 현재 선택 멤버를 클릭할 때만 열린다', () => {
    const selected: SelectedElement[] = [
      { type: 'key', id: 'key:one', index: 0 },
      { type: 'plugin', id: 'plugin:one' },
    ];
    expect(shouldOpenMixedSelectionMenu(selected, 'plugin:one')).toBe(true);
    expect(shouldOpenMixedSelectionMenu(selected, 'missing')).toBe(false);
    expect(shouldOpenMixedSelectionMenu(selected.slice(0, 1), 'key:one')).toBe(
      false,
    );
  });

  it('native 안정 ID와 그리드 추가 메뉴 ID를 fail-closed로 분류한다', () => {
    const nativeId = '11111111-1111-4111-8111-111111111111';
    expect(isStableNativeSelection({ type: 'key', id: nativeId })).toBe(true);
    expect(isStableNativeSelection({ type: 'plugin', id: nativeId })).toBe(
      false,
    );
    expect(isStableNativeSelection({ type: 'key', id: '' })).toBe(false);
    expect(isStableNativeSelection({ type: 'key', id: 'legacy' })).toBe(false);

    expect(gridAddTypeForMenuItem('add')).toBe('key');
    expect(gridAddTypeForMenuItem('addStat')).toBe('stat');
    expect(gridAddTypeForMenuItem('addGraph')).toBe('graph');
    expect(gridAddTypeForMenuItem('addKnob')).toBe('knob');
    expect(gridAddTypeForMenuItem('addPlugin')).toBeNull();
  });
});
