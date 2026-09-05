import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  renameLayer: vi.fn(() => Promise.resolve(true)),
  renameGroup: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@components/main/common/IconSwap', () => ({
  default: () => <span />,
}));
vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  patchElementHiddenById: vi.fn(),
  patchElementLayerNameById: mocks.renameLayer,
  renameLayerGroupById: mocks.renameGroup,
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({
    scrollContainerRef: () => {},
    lenisInstance: { current: null },
  }),
}));
vi.mock('@components/main/Modal/ListPopup', () => ({
  default: ({
    open,
    items,
    onSelect,
  }: {
    open: boolean;
    items: { id: string; label: string }[];
    onSelect: (id: string) => void;
  }) =>
    open ? (
      <div data-testid="layer-menu">
        {items.map((item) => (
          <button key={item.id} onClick={() => onSelect(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
    ) : null,
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import LayerTabContent from './LayerTabContent';

const KEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP_ID = 'group-a';

describe('레이어 이름 입력의 취소와 저장 경계', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.renameLayer.mockClear();
    mocks.renameGroup.mockClear();
    const positions = {
      '4key': [
        {
          id: KEY_ID,
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          groupId: GROUP_ID,
          layerName: 'Key A',
        },
      ],
    };
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['A'] },
      positions: positions as never,
      canonicalPositions: positions as never,
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useSpriteStore.setState({ positions: {} });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group A' }] },
      collapsedGroups: new Set(),
    });
    usePluginDisplayElementStore.setState({
      elements: [
        {
          id: 'item',
          fullId: 'plugin:item',
          pluginId: 'plugin',
          definitionId: 'Plugin A',
          html: '',
          position: { x: 0, y: 0 },
        },
      ],
    });
    useGridSelectionStore.setState({
      selectedElements: [],
      selectedGroupIds: [],
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<LayerTabContent />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const openMenu = async (name: string) => {
    const row = [...host.querySelectorAll('.dmn-row-grabbable')].find(
      (element) => element.textContent === name,
    );
    expect(row).toBeDefined();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    return document.querySelector('[data-testid="layer-menu"]')!;
  };

  const startRename = async (type: 'layer' | 'group') => {
    const menu = await openMenu(type === 'layer' ? 'Key A' : 'Group A');
    const label =
      type === 'layer' ? 'contextMenu.rename' : 'contextMenu.renameGroup';
    const button = [...menu.querySelectorAll('button')].find(
      (element) => element.textContent === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    const input = host.querySelector('input')!;
    expect(input).not.toBeNull();
    await act(async () => input.focus());
    return input;
  };

  const typeName = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const pressKey = async (input: HTMLInputElement, key: string) => {
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  };

  it.each(['layer', 'group'] as const)(
    '%s 이름을 Escape로 취소한 뒤 새 이름을 Enter로 저장한다',
    async (type) => {
      const cancelled = await startRename(type);
      await typeName(cancelled, 'Cancelled');
      const blur = vi.fn();
      cancelled.addEventListener('blur', blur);
      await pressKey(cancelled, 'Escape');

      expect(host.querySelector('input')).toBeNull();
      expect(blur).not.toHaveBeenCalled();
      expect(mocks.renameLayer).not.toHaveBeenCalled();
      expect(mocks.renameGroup).not.toHaveBeenCalled();

      const input = await startRename(type);
      await typeName(input, 'Saved');
      await pressKey(input, 'Enter');

      if (type === 'layer') {
        expect(mocks.renameLayer).toHaveBeenCalledExactlyOnceWith(
          'key',
          KEY_ID,
          'Saved',
        );
      } else {
        expect(mocks.renameGroup).toHaveBeenCalledExactlyOnceWith(
          '4key',
          GROUP_ID,
          'Saved',
        );
      }
    },
  );

  it('인스턴스 이름 저장을 지원하지 않는 플러그인에는 이름 변경을 제공하지 않는다', async () => {
    const menu = await openMenu('Plugin A');
    expect(menu.textContent).not.toContain('contextMenu.rename');
    expect(menu.textContent).toContain('propertiesPanel.delete');
  });
});
