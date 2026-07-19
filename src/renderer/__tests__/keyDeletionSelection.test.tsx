// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyManager } from '@hooks/useKeyManager';
import { useKeyStore } from '@stores/data/useKeyStore';
import {
  useHistoryStore,
  type HistoryState,
} from '@stores/data/useHistoryStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { persistRestoredState } from '@src/renderer/editor/runtime/editorSnapshot';

vi.mock('@src/renderer/editor/runtime/editorSnapshot', () => ({
  pushCurrentStateToHistory: vi.fn(),
  applyRestoredStateToStores: vi.fn(),
  applyRestoredPluginElements: vi.fn(),
  persistRestoredState: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/persistState', () => ({
  persistPositionsWithSync: vi.fn(),
  persistMappingsAndPositions: vi.fn(),
  persistPositions: vi.fn(),
  persistPositionsWithFlag: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: {
    flush: vi.fn(),
    getState: vi.fn(() => ({ revision: 1 })),
    sync: vi.fn(),
  },
}));

vi.mock('@api/pluginDisplayElements', () => ({
  setUndoRedoInProgress: vi.fn(),
}));

vi.mock('@plugins/runtime/displayElement/displayElementApi', () => ({
  removeDisplayElementsInternal: vi.fn(),
}));

type KeyManager = ReturnType<typeof useKeyManager>;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('키 삭제 선택 정리', () => {
  const originalApi = window.api;
  const resetMode = vi.fn();
  let root: Root;
  let host: HTMLDivElement;
  let manager: KeyManager | null;

  const Harness = () => {
    const value = useKeyManager();
    useEffect(() => {
      manager = value;
    }, [value]);
    return null;
  };

  const latest = () => {
    if (!manager) throw new Error('key manager not captured');
    return manager;
  };

  const restoredState = (): HistoryState => ({
    keyMappings: { '4key': ['A', 'B', 'C', 'D'] },
    positions: {
      '4key': [
        createDefaultKeyPosition(),
        createDefaultKeyPosition(),
        createDefaultKeyPosition(),
        createDefaultKeyPosition(),
      ],
    },
    statPositions: { '4key': [] },
    graphPositions: { '4key': [] },
    knobPositions: { '4key': [] },
    pluginElements: [],
    layerGroups: { '4key': [] },
    keyCounters: {},
    customTabs: [],
    selectedKeyType: '4key',
  });

  beforeEach(() => {
    resetMode.mockReset().mockResolvedValue({ success: true });
    window.api = {
      keys: { resetMode },
    } as unknown as Window['api'];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    manager = null;
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['A', 'B', 'C'] },
      positions: {
        '4key': [
          createDefaultKeyPosition(),
          createDefaultKeyPosition(),
          createDefaultKeyPosition(),
        ],
      },
      isBootstrapped: false,
      isLocalUpdateInProgress: false,
    });
    useGridSelectionStore.getState().clearSelection();
    useHistoryStore.setState({ past: [], future: [] });
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useGridSelectionStore.getState().clearSelection();
    useHistoryStore.setState({ past: [], future: [] });
    window.api = originalApi;
  });

  it('실제 삭제 핸들러가 삭제된 키의 grid 선택을 제거한다', () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    act(() => root.render(<Harness />));

    act(() => latest().handleDeleteKey(0));

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
    expect(useKeyStore.getState().keyMappings['4key']).toEqual(['B', 'C']);
  });

  it('삭제 뒤 키 인덱스를 당기고 다른 요소 선택은 보존한다', () => {
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'key', id: 'key-2', index: 2 },
      { type: 'stat', id: 'stat-0', index: 0 },
    ]);
    act(() => root.render(<Harness />));

    act(() => latest().handleDeleteKey(0));

    expect(useGridSelectionStore.getState().selectedElements).toEqual([
      { type: 'key', id: 'key-1', index: 1 },
      { type: 'stat', id: 'stat-0', index: 0 },
    ]);
  });

  it('현재 탭 리셋 성공 시 grid 선택을 해제한다', async () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleResetCurrentMode());

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
  });

  it('현재 탭 리셋 실패 시 grid 선택을 보존한다', async () => {
    resetMode.mockResolvedValueOnce({ success: false });
    const selection = [{ type: 'key' as const, id: 'key-0', index: 0 }];
    useGridSelectionStore.getState().setSelectedElements(selection);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleResetCurrentMode());

    expect(useGridSelectionStore.getState().selectedElements).toEqual(
      selection,
    );
  });

  it('undo로 선택된 종류의 배열 길이가 바뀌면 선택을 해제한다', async () => {
    useKeyStore.setState({
      keyMappings: { '4key': ['B', 'C', 'D'] },
      positions: {
        '4key': [
          createDefaultKeyPosition(),
          createDefaultKeyPosition(),
          createDefaultKeyPosition(),
        ],
      },
    });
    useHistoryStore.setState({ past: [restoredState()], future: [] });
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleUndo());

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
  });

  it('redo로 선택된 종류의 배열 길이가 바뀌면 선택을 해제한다', async () => {
    useKeyStore.setState({
      keyMappings: { '4key': ['B', 'C', 'D'] },
      positions: {
        '4key': [
          createDefaultKeyPosition(),
          createDefaultKeyPosition(),
          createDefaultKeyPosition(),
        ],
      },
    });
    useHistoryStore.setState({ past: [], future: [restoredState()] });
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleRedo());

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
  });

  it('길이가 같은 스타일 undo는 선택을 보존한다', async () => {
    const target = restoredState();
    target.keyMappings = { '4key': ['A', 'B', 'C'] };
    target.positions = {
      '4key': [
        { ...createDefaultKeyPosition(), backgroundColor: '#123456' },
        createDefaultKeyPosition(),
        createDefaultKeyPosition(),
      ],
    };
    useHistoryStore.setState({ past: [target], future: [] });
    const selection = [{ type: 'key' as const, id: 'key-0', index: 0 }];
    useGridSelectionStore.getState().setSelectedElements(selection);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleUndo());

    expect(useGridSelectionStore.getState().selectedElements).toEqual(
      selection,
    );
  });

  it('같은 개수의 프리셋 교체 undo와 redo는 모두 선택을 해제한다', async () => {
    const target = restoredState();
    target.keyMappings = { '4key': ['D', 'E', 'F'] };
    target.positions = {
      '4key': [
        createDefaultKeyPosition(),
        createDefaultKeyPosition(),
        createDefaultKeyPosition(),
      ],
    };
    target.invalidatesGridSelection = true;
    useHistoryStore.setState({ past: [target], future: [] });
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleUndo());

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
    expect(
      useHistoryStore.getState().future.at(-1)?.invalidatesGridSelection,
    ).toBe(true);

    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]);
    await act(async () => latest().handleRedo());

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
    expect(
      useHistoryStore.getState().past.at(-1)?.invalidatesGridSelection,
    ).toBe(true);
  });

  it('끝에 요소만 복원하는 undo는 앞쪽 선택을 보존한다', async () => {
    useHistoryStore.setState({ past: [restoredState()], future: [] });
    const selection = [{ type: 'key' as const, id: 'key-0', index: 0 }];
    useGridSelectionStore.getState().setSelectedElements(selection);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleUndo());

    expect(useGridSelectionStore.getState().selectedElements).toEqual(
      selection,
    );
  });

  it('undo 저장 실패 시 선택을 보존한다', async () => {
    vi.mocked(persistRestoredState).mockRejectedValueOnce(
      new Error('injected failure'),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const target = restoredState();
    target.invalidatesGridSelection = true;
    useHistoryStore.setState({ past: [target], future: [] });
    const selection = [{ type: 'key' as const, id: 'key-0', index: 0 }];
    useGridSelectionStore.getState().setSelectedElements(selection);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleUndo());

    expect(useGridSelectionStore.getState().selectedElements).toEqual(
      selection,
    );
  });
});
