import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorCoordinator } from '@src/renderer/editor/runtime/coordinator/editorCoordinator';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import type {
  CanonicalEditorDocumentV1,
  EditorCommitResult,
} from '@src/types/editor';
import EditorSaveNotice from './EditorSaveNotice';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  coordinator: null as ReturnType<typeof createEditorCoordinator> | null,
  settle: vi.fn(),
  commit: vi.fn(),
}));
vi.mock(
  '@src/renderer/editor/runtime/coordinator/editorStateCoordinator',
  () => ({
    editorCoordinator: {
      getState: () => mocks.coordinator!.getState(),
      subscribe: (
        listener: Parameters<
          ReturnType<typeof createEditorCoordinator>['subscribe']
        >[0],
      ) => mocks.coordinator!.subscribe(listener),
      flush: () => mocks.coordinator!.flush(),
    },
  }),
);
vi.mock('@src/renderer/editor/runtime/lifecycle/lifecycleEditorFlush', () => ({
  flushFocusedEditor: mocks.settle,
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@stores/data/useHistoryStatusStore', () => ({
  useHistoryStatusStore: (selector: (state: { busy: boolean }) => unknown) =>
    selector({ busy: false }),
}));

describe('미저장 편집 안내와 실제 coordinator 재시도', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    mocks.commit.mockReset();
    mocks.settle.mockReset().mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let document: CanonicalEditorDocumentV1 = {
      schemaVersion: 1,
      keys: { '4key': ['A'] },
      keyPositions: {
        '4key': [
          {
            ...createDefaultKeyPosition(),
            id: '11111111-1111-4111-8111-111111111111',
          },
        ],
      },
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      spritePositions: {},
      layerGroups: {},
    };
    mocks.coordinator = createEditorCoordinator({
      transport: {
        get: async () => ({ revision: 0, document: structuredClone(document) }),
        commit: mocks.commit,
        onCommitted: () =>
          Object.assign(() => {}, { ready: Promise.resolve() }),
      },
      readDocument: () => document,
      applyDocument: (next) => {
        document = next;
      },
      focusTarget: null,
      visibilityTarget: null,
    });
    await mocks.coordinator.start();
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<EditorSaveNotice />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mocks.coordinator!.stop();
    vi.restoreAllMocks();
  });

  const failEdit = async (errorCode = 'IO_ERROR') => {
    mocks.commit.mockRejectedValue({
      errorCode,
      message: 'save failed',
      retryable: true,
    });
    await act(async () => {
      await mocks
        .coordinator!.commitPatch({ schemaVersion: 1, keys: { '4key': ['B'] } })
        .catch(() => {});
    });
  };

  it.each(['HISTORY_IN_PROGRESS', 'HISTORY_EPOCH_CONFLICT', 'IO_ERROR'])(
    '%s 이후 초안을 유지하고 명시적 재시도 경로를 표시한다',
    async (code) => {
      await failEdit(code);
      expect(mocks.coordinator!.getState().dirty).toBe(true);
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        'editorSave.pendingFailure',
      );
      expect(container.querySelector('button')?.textContent).toBe(
        'editorSave.retrySave',
      );
      expect(mocks.commit).toHaveBeenCalledOnce();
    },
  );

  it('저장 성공 응답까지 안내를 유지하고 중복 클릭은 한 번만 저장한다', async () => {
    await failEdit();
    let resolve!: (result: EditorCommitResult) => void;
    mocks.commit.mockImplementation(
      () =>
        new Promise<EditorCommitResult>((yes) => {
          resolve = yes;
        }),
    );
    await act(async () => {
      container.querySelector('button')!.click();
      container.querySelector('button')!.click();
      await new Promise((yes) => setTimeout(yes, 0));
    });
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => {
      resolve({ revision: 1, changedFields: ['keys'] });
      await new Promise((yes) => setTimeout(yes, 0));
    });
    expect(mocks.coordinator!.getState().dirty).toBe(false);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('재시도도 실패하면 안내와 초안을 유지한다', async () => {
    await failEdit();
    await act(async () => {
      container.querySelector('button')!.click();
      await new Promise((yes) => setTimeout(yes, 0));
    });
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(mocks.coordinator!.getState().pendingLocal?.keys['4key']).toEqual([
      'B',
    ]);
    expect(container.querySelector('button')?.disabled).toBe(false);
  });

  it('다른 편집 정산이 실패하면 저장을 진행하지 않는다', async () => {
    await failEdit();
    mocks.settle.mockResolvedValue(false);
    await act(async () => {
      container.querySelector('button')!.click();
    });
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('저장 실패가 없으면 안내를 표시하지 않는다', () => {
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
