import { describe, expect, it } from 'vitest';

import { buildSavedPluginInstances } from './defineElement';

type PluginElement = Parameters<typeof buildSavedPluginInstances>[0][number];

const baseElement = {
  fullId: 'plugin-a:one',
  definitionId: 'plugin-a',
  position: { x: 10, y: 20 },
  settings: { enabled: true },
  measuredSize: { width: 100, height: 80 },
  estimatedSize: { width: 90, height: 70 },
  tabId: '4key',
  state: { frame: 1 },
  html: '<div>one</div>',
  hidden: false,
  zIndex: 1,
} as unknown as PluginElement;

describe('plugin instance persistence projection', () => {
  it('임시 렌더 필드를 제외하고 실제 저장 필드만 비교한다', () => {
    const baseline = buildSavedPluginInstances([baseElement], 'plugin-a');
    const transientChanges: Array<Partial<PluginElement>> = [
      { state: { frame: 2 } },
      { html: '<div>two</div>' },
      { estimatedSize: { width: 120, height: 90 } },
      { onClick: () => undefined },
      { contextMenu: { enableDelete: false } },
    ];

    transientChanges.forEach((change) => {
      expect(
        buildSavedPluginInstances(
          [{ ...baseElement, ...change } as PluginElement],
          'plugin-a',
        ),
      ).toEqual(baseline);
    });

    const persistentChanges: Array<Partial<PluginElement>> = [
      { position: { x: 11, y: 20 } },
      { settings: { enabled: false } },
      { measuredSize: { width: 101, height: 80 } },
      { tabId: '8key' },
      { hidden: true },
      { zIndex: 9 },
    ];

    persistentChanges.forEach((change) => {
      expect(
        buildSavedPluginInstances(
          [{ ...baseElement, ...change } as PluginElement],
          'plugin-a',
        ),
      ).not.toEqual(baseline);
    });
  });

  it('대상 요소의 추가, 삭제, 순서 변경을 보존한다', () => {
    const second = {
      ...baseElement,
      fullId: 'plugin-a:two',
      position: { x: 30, y: 40 },
    } as PluginElement;
    const unrelated = {
      ...baseElement,
      fullId: 'plugin-b:one',
      definitionId: 'plugin-b',
    } as PluginElement;

    const one = buildSavedPluginInstances([baseElement], 'plugin-a');
    const two = buildSavedPluginInstances(
      [baseElement, second, unrelated],
      'plugin-a',
    );

    expect(two).toHaveLength(2);
    expect(two).not.toEqual(one);
    expect(
      buildSavedPluginInstances([second, baseElement], 'plugin-a'),
    ).not.toEqual(two);
    expect(buildSavedPluginInstances([unrelated], 'plugin-a')).toEqual([]);
  });
});
