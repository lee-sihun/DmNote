// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyManager } from '@hooks/useKeyManager';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

const apiMocks = vi.hoisted(() => ({
  resetMode: vi.fn(),
  update: vi.fn(),
  rebindKeySlotById: vi.fn(async (_id: string, _slot: unknown) => true),
}));

vi.mock('@api/modules/editor/keysApi', () => ({
  keysApi: {
    resetMode: (...args: unknown[]) => apiMocks.resetMode(...args),
    update: (...args: unknown[]) => apiMocks.update(...args),
  },
}));

vi.mock('@src/renderer/editor/runtime/operations/elementOps', () => ({
  rebindKeySlotById: (id: string, slot: unknown) =>
    apiMocks.rebindKeySlotById(id, slot),
}));

vi.mock(
  '@src/renderer/editor/runtime/coordinator/editorStateCoordinator',
  () => ({
    editorCoordinator: {
      flush: vi.fn(),
      getState: vi.fn(() => ({ revision: 1 })),
      sync: vi.fn(),
    },
  }),
);

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
  const keyIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ];
  const originalApi = window.api;
  const resetMode = apiMocks.resetMode;
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
          { ...createDefaultKeyPosition(), id: keyIds[0] },
          { ...createDefaultKeyPosition(), id: keyIds[1] },
          { ...createDefaultKeyPosition(), id: keyIds[2] },
        ],
      },
      canonicalPositions: {
        '4key': [
          { ...createDefaultKeyPosition(), id: keyIds[0] },
          { ...createDefaultKeyPosition(), id: keyIds[1] },
          { ...createDefaultKeyPosition(), id: keyIds[2] },
        ],
      },
      isBootstrapped: false,
      isLocalUpdateInProgress: false,
    });
    useGridSelectionStore.getState().clearSelection();
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useGridSelectionStore.getState().clearSelection();
    window.api = originalApi;
  });

  it('현재 탭 리셋 성공 시 grid 선택을 해제한다', async () => {
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'key', id: keyIds[0], index: 0 }]);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleResetCurrentMode());

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
  });

  it('현재 탭 리셋 실패 시 grid 선택을 보존한다', async () => {
    resetMode.mockResolvedValueOnce({ success: false });
    const selection = [{ type: 'key' as const, id: keyIds[0], index: 0 }];
    useGridSelectionStore.getState().setSelectedElements(selection);
    act(() => root.render(<Harness />));

    await act(async () => latest().handleResetCurrentMode());

    expect(useGridSelectionStore.getState().selectedElements).toEqual(
      selection,
    );
  });

  it('키 매핑은 canonical ID로만 저장하고 잘못된 index에서 후퇴하지 않는다', () => {
    act(() => root.render(<Harness />));

    act(() => latest().handleKeyMappingChange(1, 'Z'));
    expect(apiMocks.rebindKeySlotById).toHaveBeenCalledWith(keyIds[1], 'Z');

    apiMocks.rebindKeySlotById.mockClear();
    act(() => latest().handleKeyMappingChange(99, 'X'));
    expect(apiMocks.rebindKeySlotById).not.toHaveBeenCalled();
    expect(apiMocks.update).not.toHaveBeenCalled();
  });

  it('저장 대기 중 대상 키가 사라지면 무시된 편집을 기록한다', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    apiMocks.rebindKeySlotById.mockResolvedValueOnce(false);
    act(() => root.render(<Harness />));
    await act(async () => latest().handleKeyMappingChange(1, 'Z'));

    expect(warning).toHaveBeenCalledWith(
      'Element operation skipped (fail-closed)',
      'key mapping target disappeared',
    );
    warning.mockRestore();
  });
});
