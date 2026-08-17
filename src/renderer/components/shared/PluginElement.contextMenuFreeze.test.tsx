/**
 * 플러그인 요소 컨텍스트 메뉴 커스텀 항목 동결 테스트
 * 열림 중 플러그인이 customItems를 교체해도 표시와 index 디스패치가
 * 열림 시점 배열을 유지하는지 검증
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { I18nContext } from '@contexts/I18nContextDef';
import { PluginElement } from '@components/shared/PluginElement';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

const popup = vi.hoisted(() => ({
  open: false,
  items: [] as Array<{ id: string; label: string }>,
  onSelect: null as null | ((id: string) => void),
  onClose: null as null | (() => void),
}));

vi.mock('@components/main/Modal/ListPopup', () => ({
  default: (props: {
    open: boolean;
    items: Array<{ id: string; label: string }>;
    onSelect?: (id: string) => void;
    onClose: () => void;
  }) => {
    popup.open = props.open;
    popup.items = props.items;
    popup.onSelect = props.onSelect ?? null;
    popup.onClose = props.onClose;
    return null;
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PLUGIN_FULL_ID = 'plugin-a::11111111-1111-4111-8111-111111111111';

type CustomItem = {
  id: string;
  label: string;
  onClick: (context: unknown) => void;
  position?: 'top' | 'bottom';
};

const makeElement = (customItems: CustomItem[]): PluginDisplayElementInternal =>
  ({
    id: PLUGIN_FULL_ID.split('::')[1],
    fullId: PLUGIN_FULL_ID,
    pluginId: 'plugin-a',
    position: { x: 10, y: 10 },
    tabId: '4key',
    contextMenu: { enableDelete: true, customItems },
  } as unknown as PluginDisplayElementInternal);

const seedStores = () => {
  useKeyStore.setState({
    selectedKeyType: '4key',
    positions: { '4key': [] },
    canonicalPositions: { '4key': [] },
  });
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useLayerGroupStore.setState({ layerGroups: {} });
  useGridSelectionStore.setState({
    selectedElements: [],
    selectedGroupIds: [],
    lastSelectedKeyBounds: null,
  });
  usePropertiesPanelStore.setState({ isCanvasPanelOpen: false });
};

let container: HTMLDivElement;
let root: Root;

const renderElement = (element: PluginDisplayElementInternal) => {
  act(() => {
    root.render(
      <I18nContext.Provider
        value={{ locale: 'ko', setLocale: () => {}, t: (key) => key }}
      >
        <PluginElement element={element} windowType="main" />
      </I18nContext.Provider>,
    );
  });
  return container.querySelector(
    `[data-plugin-element="${PLUGIN_FULL_ID}"]`,
  ) as HTMLElement;
};

const openContextMenu = (node: HTMLElement) => {
  act(() => {
    node.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
  });
};

beforeEach(() => {
  popup.open = false;
  popup.items = [];
  popup.onSelect = null;
  popup.onClose = null;
  seedStores();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  usePluginDisplayElementStore.setState({ elements: [] });
});

describe('플러그인 컨텍스트 메뉴 항목 동결', () => {
  it('열림 중 customItems 교체에도 동결 배열로 표시하고 디스패치한다', () => {
    const alpha = vi.fn();
    const beta = vi.fn();
    const swapped = vi.fn();
    const elementV1 = makeElement([
      { id: 'a', label: 'Alpha', onClick: alpha, position: 'top' },
      { id: 'b', label: 'Beta', onClick: beta, position: 'top' },
    ]);
    usePluginDisplayElementStore.setState({ elements: [elementV1] });
    const node = renderElement(elementV1);

    openContextMenu(node);
    expect(popup.open).toBe(true);
    expect(popup.items.map((item) => item.id)).toEqual([
      'custom-0',
      'custom-1',
      'delete',
      'bringToFront',
      'sendToBack',
    ]);

    // 열림 중 플러그인이 항목 배열을 교체 (displayElement.update 경로)
    const elementV2 = makeElement([
      { id: 'x', label: 'Swapped', onClick: swapped, position: 'top' },
    ]);
    usePluginDisplayElementStore.setState({ elements: [elementV2] });
    renderElement(elementV2);

    // 표시가 동결 배열 유지 - 항목 수·라벨이 열림 시점 그대로
    expect(popup.items.map((item) => item.id)).toEqual([
      'custom-0',
      'custom-1',
      'delete',
      'bringToFront',
      'sendToBack',
    ]);
    expect(popup.items[1].label).toBe('Beta');

    // 디스패치도 동결 배열 기준 - 교체된 액션이 대신 실행되지 않는다
    act(() => popup.onSelect?.('custom-1'));
    expect(beta).toHaveBeenCalledTimes(1);
    expect(alpha).not.toHaveBeenCalled();
    expect(swapped).not.toHaveBeenCalled();
  });

  it('닫고 다시 열면 교체된 항목이 반영된다', () => {
    const alpha = vi.fn();
    const swapped = vi.fn();
    const elementV1 = makeElement([
      { id: 'a', label: 'Alpha', onClick: alpha, position: 'top' },
    ]);
    usePluginDisplayElementStore.setState({ elements: [elementV1] });
    const node = renderElement(elementV1);

    openContextMenu(node);
    expect(popup.items[0].label).toBe('Alpha');
    act(() => popup.onClose?.());

    const elementV2 = makeElement([
      { id: 'x', label: 'Swapped', onClick: swapped, position: 'top' },
    ]);
    usePluginDisplayElementStore.setState({ elements: [elementV2] });
    const nodeV2 = renderElement(elementV2);

    // 재열림은 새 배열로 재동결
    openContextMenu(nodeV2);
    expect(popup.items[0].label).toBe('Swapped');
    act(() => popup.onSelect?.('custom-0'));
    expect(swapped).toHaveBeenCalledTimes(1);
    expect(alpha).not.toHaveBeenCalled();
  });
});
