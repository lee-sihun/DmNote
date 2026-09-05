import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

const { commitPatch } = vi.hoisted(() => ({
  commitPatch: vi.fn(),
}));

vi.mock(
  '@src/renderer/editor/runtime/coordinator/editorStateCoordinator',
  () => ({
    editorCoordinator: { commitPatch },
  }),
);

import { keysApi, updatePositionsWithGesture } from './keysApi';
import {
  graphItemsApi,
  knobItemsApi,
  layerGroupsApi,
  statItemsApi,
} from './itemsApi';

import type { EditorDocumentV1 } from '@src/types/editor';
import type { KeyPositions } from '@src/types/key/keys';

const document: EditorDocumentV1 = {
  schemaVersion: 1,
  keys: { '4key': ['A'] },
  keyPositions: { '4key': [createDefaultKeyPosition()] },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  layerGroups: { '4key': [{ id: 'group-1', name: 'Group 1' }] },
};

describe('editor API compatibility adapters', () => {
  beforeEach(() => {
    commitPatch.mockReset();
    commitPatch.mockResolvedValue(structuredClone(document));
  });

  it('routes key writers through editor_commit and preserves return shapes', async () => {
    const mappings = { '4key': ['A'] };
    // 입력 echo와 canonical fixture가 값 비교되므로 id까지 같은 사본을 쓴다
    const positions = structuredClone(document.keyPositions) as KeyPositions;

    await expect(keysApi.update(mappings)).resolves.toEqual(document.keys);
    await expect(keysApi.updatePositions(positions)).resolves.toEqual(
      document.keyPositions,
    );
    await expect(
      keysApi.updateWithPositions(mappings, positions),
    ).resolves.toEqual({
      keys: document.keys,
      positions: document.keyPositions,
    });

    expect(commitPatch.mock.calls).toEqual([
      [{ schemaVersion: 1, keys: mappings }],
      [{ schemaVersion: 1, keyPositions: positions }, undefined],
      [
        {
          schemaVersion: 1,
          keys: mappings,
          keyPositions: positions,
        },
        undefined,
      ],
    ]);

    commitPatch.mockClear();
    commitPatch.mockResolvedValue(structuredClone(document));
    await updatePositionsWithGesture(
      positions,
      '6f9c2f6a-0b1d-4e5f-8a3c-2d7e9b4c1a50',
    );
    expect(commitPatch).toHaveBeenCalledWith(
      { schemaVersion: 1, keyPositions: positions },
      { gestureId: '6f9c2f6a-0b1d-4e5f-8a3c-2d7e9b4c1a50' },
    );
  });

  it('routes every item collection writer and returns its canonical field', async () => {
    await expect(statItemsApi.updatePositions({})).resolves.toEqual({});
    await expect(graphItemsApi.updatePositions({})).resolves.toEqual({});
    await expect(knobItemsApi.updatePositions({})).resolves.toEqual({});
    await expect(layerGroupsApi.update(document.layerGroups)).resolves.toEqual(
      document.layerGroups,
    );

    expect(commitPatch.mock.calls).toEqual([
      [{ schemaVersion: 1, statPositions: {} }],
      [{ schemaVersion: 1, graphPositions: {} }],
      [{ schemaVersion: 1, knobPositions: {} }],
      [{ schemaVersion: 1, layerGroups: document.layerGroups }],
    ]);
  });

  it('preserves each legacy caller return value when writes are queued together', async () => {
    const first = { '4key': ['B'] };
    const second = { '4key': ['C'] };
    let resolveFirst!: (value: EditorDocumentV1) => void;
    const firstCommit = new Promise<EditorDocumentV1>((resolve) => {
      resolveFirst = resolve;
    });
    commitPatch
      .mockImplementationOnce(() => firstCommit)
      .mockResolvedValueOnce({ ...document, keys: second });

    const firstWrite = keysApi.update(first);
    const secondWrite = keysApi.update(second);

    await vi.waitFor(() => expect(commitPatch).toHaveBeenCalledOnce());
    resolveFirst({ ...document, keys: first });
    await expect(firstWrite).resolves.toEqual(first);
    await vi.waitFor(() => expect(commitPatch).toHaveBeenCalledTimes(2));
    await expect(secondWrite).resolves.toEqual(second);
  });

  it('does not reject an acknowledged legacy write when the next queued write fails', async () => {
    const first = { '4key': ['B'] };
    const second = { '4key': ['C'] };
    const secondError = new Error('second write failed');
    let resolveFirst!: (value: EditorDocumentV1) => void;
    const firstCommit = new Promise<EditorDocumentV1>((resolve) => {
      resolveFirst = resolve;
    });
    commitPatch
      .mockImplementationOnce(() => firstCommit)
      .mockRejectedValueOnce(secondError);

    const firstWrite = keysApi.update(first);
    const secondWrite = keysApi.update(second);
    const secondOutcome = secondWrite.catch((error) => error);

    await vi.waitFor(() => expect(commitPatch).toHaveBeenCalledOnce());
    resolveFirst({ ...document, keys: first });
    await expect(firstWrite).resolves.toEqual(first);
    await vi.waitFor(() => expect(commitPatch).toHaveBeenCalledTimes(2));
    await expect(secondOutcome).resolves.toBe(secondError);
  });
});
