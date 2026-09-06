// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actions: undefined as unknown,
  handleMouseDown: vi.fn(),
  handleGroupMouseDown: vi.fn(),
  renameLayer: vi.fn(() => Promise.resolve(true)),
  renameGroup: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@components/main/common/IconSwap', () => ({
  default: ({ active }: { active: boolean }) => (
    <span data-active={String(active)} />
  ),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', changeLanguage: () => {} },
  }),
}));

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({
    scrollContainerRef: () => {},
    lenisInstance: { current: null },
  }),
}));

// 입력 계약 테스트는 액션을 통째로 대체하고, 취소·저장 흐름 테스트는 실제 훅을 쓴다
vi.mock('./useLayerActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useLayerActions')>();
  return {
    useLayerActions: (params: Parameters<typeof actual.useLayerActions>[0]) =>
      mocks.actions ?? actual.useLayerActions(params),
  };
});

vi.mock('./useLayerDnD', () => ({
  useLayerDnD: () => ({
    draggedItemId: null,
    isDragging: false,
    draggedGroupId: null,
    dragOverItemDisplayIndex: null,
    dragOverIntoGroupId: null,
    dragOverTargetGroupId: null,
    dragOverDisplayIndex: null,
    getDidDrag: () => false,
    resetDidDrag: vi.fn(),
    getIsDraggingRef: () => false,
    handleMouseDown: mocks.handleMouseDown,
    handleGroupMouseDown: mocks.handleGroupMouseDown,
  }),
}));

vi.mock('@src/renderer/editor/runtime/operations/elementOps', () => ({
  patchElementHiddenById: vi.fn(),
  patchElementLayerNameById: mocks.renameLayer,
  renameLayerGroupById: mocks.renameGroup,
}));

vi.mock('@components/main/Modal/listPopup/ListPopup', () => ({
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

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import LayerTabContent from './LayerTabContent';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GROUP_ID = 'group-a';
const INPUT_CLASS =
  'flex-1 text-body bg-transparent border-none p-0 outline-none text-fg min-w-0 caret-accent';

interface RenameActions {
  events: string[];
  contextMenuOpen: boolean;
  contextMenuPosition: { x: number; y: number };
  contextMenuItems: [];
  setContextMenuOpen: ReturnType<typeof vi.fn>;
  setContextMenuGroupId: ReturnType<typeof vi.fn>;
  renamingItemId: string;
  renameValue: string;
  setRenameValue: ReturnType<typeof vi.fn>;
  renameInputRef: { current: HTMLInputElement | null };
  renameCancelledRef: { current: boolean };
  setRenamingItemId: ReturnType<typeof vi.fn>;
  handleToggleVisibility: ReturnType<typeof vi.fn>;
  handleToggleGroupVisibility: ReturnType<typeof vi.fn>;
  handleLayerRenameCommit: ReturnType<typeof vi.fn>;
  handleGroupRenameCommit: ReturnType<typeof vi.fn>;
  handleContextMenu: ReturnType<typeof vi.fn>;
  handleGroupHeaderContextMenu: ReturnType<typeof vi.fn>;
  handleContextMenuSelect: ReturnType<typeof vi.fn>;
}

const createActions = (renamingItemId: string): RenameActions => ({
  events: [],
  contextMenuOpen: false,
  contextMenuPosition: { x: 0, y: 0 },
  contextMenuItems: [],
  setContextMenuOpen: vi.fn(),
  setContextMenuGroupId: vi.fn(),
  renamingItemId,
  renameValue: 'Before',
  setRenameValue: vi.fn(),
  renameInputRef: { current: null },
  renameCancelledRef: { current: false },
  setRenamingItemId: vi.fn(),
  handleToggleVisibility: vi.fn(),
  handleToggleGroupVisibility: vi.fn(),
  handleLayerRenameCommit: vi.fn(),
  handleGroupRenameCommit: vi.fn(),
  handleContextMenu: vi.fn(),
  handleGroupHeaderContextMenu: vi.fn(),
  handleContextMenuSelect: vi.fn(),
});

const trackRenameOrder = (actions: RenameActions) => {
  let cancelled = false;
  Object.defineProperty(actions.renameCancelledRef, 'current', {
    configurable: true,
    get: () => {
      actions.events.push(`cancelled:get:${String(cancelled)}`);
      return cancelled;
    },
    set: (value: boolean) => {
      cancelled = value;
      actions.events.push(`cancelled:set:${String(value)}`);
    },
  });
  actions.setRenamingItemId.mockImplementation(() => {
    actions.events.push('cancel');
  });
  actions.handleGroupRenameCommit.mockImplementation(() => {
    actions.events.push('group:commit');
  });
  actions.handleLayerRenameCommit.mockImplementation(() => {
    actions.events.push('item:commit');
  });
};

const setNativeValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
};

describe('LayerTab rename input contract', () => {
  let host: HTMLDivElement;
  let root: Root;
  let actions: RenameActions;

  const mount = async (renamingItemId: string) => {
    actions = createActions(renamingItemId);
    trackRenameOrder(actions);
    mocks.actions = actions;

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<LayerTabContent />);
    });

    const input = host.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) throw new Error('rename input not found');
    return input;
  };

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['A'] },
      positions: {
        '4key': [
          {
            id: ITEM_ID,
            layerName: 'Layer A',
            dx: 0,
            dy: 0,
            width: 60,
            height: 60,
            zIndex: 1,
            groupId: GROUP_ID,
          },
        ],
      } as never,
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useSpriteStore.setState({ positions: {} });
    useLayerGroupStore.setState({
      layerGroups: { '4key': [{ id: GROUP_ID, name: 'Group A' }] },
      collapsedGroups: new Set(),
    });
    usePluginDisplayElementStore.setState({ elements: [] });
    useGridSelectionStore.setState({
      selectedElements: [],
      selectedGroupIds: [],
    });
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    host?.remove();
    mocks.actions = undefined;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'group',
      renamingItemId: `group:${GROUP_ID}`,
      expectedCommit: () => actions.handleGroupRenameCommit,
      expectedArgs: [GROUP_ID, 'Before'] as const,
    },
    {
      name: 'item',
      renamingItemId: ITEM_ID,
      expectedCommit: () => actions.handleLayerRenameCommit,
      expectedArgs: [
        expect.objectContaining({ id: ITEM_ID }),
        'Before',
      ] as const,
    },
  ])(
    '$name 입력은 ref/class/change와 Enter blur commit adapter를 보존한다',
    async ({ renamingItemId, expectedCommit, expectedArgs }) => {
      const input = await mount(renamingItemId);

      expect(actions.renameInputRef.current).toBe(input);
      expect(input.className).toBe(INPUT_CLASS);
      expect(input.value).toBe('Before');

      await act(async () => {
        setNativeValue(input, 'After');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(actions.setRenameValue).toHaveBeenCalledWith('After');

      input.focus();
      expect(document.activeElement).toBe(input);
      const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        input.dispatchEvent(enter);
      });

      expect(enter.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(input);
      expect(expectedCommit()).toHaveBeenCalledTimes(1);
      expect(expectedCommit()).toHaveBeenCalledWith(...expectedArgs);
      expect(actions.events).toEqual([
        'cancelled:get:false',
        `${renamingItemId.startsWith('group:') ? 'group' : 'item'}:commit`,
        'cancelled:set:false',
      ]);
      expect(actions.renameCancelledRef.current).toBe(false);
      expect(actions.setRenamingItemId).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['group', `group:${GROUP_ID}`],
    ['item', ITEM_ID],
  ])(
    '%s 입력 Escape는 cancel 후 blur commit을 억제하고 ref를 reset한다',
    async (_name, renamingItemId) => {
      const input = await mount(renamingItemId);
      input.focus();
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });

      await act(async () => {
        input.dispatchEvent(escape);
      });

      expect(escape.defaultPrevented).toBe(true);
      expect(actions.setRenamingItemId).toHaveBeenCalledWith(null);
      expect(actions.events).toEqual(['cancelled:set:true', 'cancel']);
      expect(actions.handleGroupRenameCommit).not.toHaveBeenCalled();
      expect(actions.handleLayerRenameCommit).not.toHaveBeenCalled();

      await act(async () => input.blur());

      expect(actions.handleGroupRenameCommit).not.toHaveBeenCalled();
      expect(actions.handleLayerRenameCommit).not.toHaveBeenCalled();
      expect(actions.events).toEqual([
        'cancelled:set:true',
        'cancel',
        'cancelled:get:true',
        'cancelled:set:false',
      ]);
      expect(actions.renameCancelledRef.current).toBe(false);
    },
  );

  it.each([
    ['group', `group:${GROUP_ID}`],
    ['item', ITEM_ID],
  ])(
    '%s 입력 mouse/click/doubleclick은 행과 외부로 전파하지 않는다',
    async (_name, renamingItemId) => {
      const input = await mount(renamingItemId);
      const propagated = vi.fn();
      document.body.addEventListener('mousedown', propagated);
      document.body.addEventListener('click', propagated);
      document.body.addEventListener('dblclick', propagated);

      await act(async () => {
        input.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        input.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
        input.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
        );
      });

      expect(propagated).not.toHaveBeenCalled();
      expect(mocks.handleMouseDown).not.toHaveBeenCalled();
      expect(mocks.handleGroupMouseDown).not.toHaveBeenCalled();
      document.body.removeEventListener('mousedown', propagated);
      document.body.removeEventListener('click', propagated);
      document.body.removeEventListener('dblclick', propagated);
    },
  );
});

describe('레이어 이름 입력의 취소와 저장 경계', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.actions = undefined;
    mocks.renameLayer.mockClear();
    mocks.renameGroup.mockClear();
    const positions = {
      '4key': [
        {
          id: ITEM_ID,
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
      setNativeValue(input, value);
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
          ITEM_ID,
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
