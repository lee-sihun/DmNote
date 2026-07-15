import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import { useBatchHandlers } from './useBatchHandlers';

import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';

const { commitPatchMock } = vi.hoisted(() => ({
  commitPatchMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitPatch: commitPatchMock },
}));

type BatchOptions = { skipHistory?: boolean; deferSave?: boolean };

const position = (width = 40) =>
  ({ dx: 0, dy: 0, width, height: 40 } as KeyPosition);

const applyUpdates = <T extends object>(
  values: T[],
  updates: Array<{ index: number } & Partial<T>>,
): T[] =>
  values.map((value, index) => {
    const update = updates.find((candidate) => candidate.index === index);
    if (!update) return value;
    const { index: _index, ...changes } = update;
    return { ...value, ...changes };
  });

describe('useBatchHandlers mixed collection commits', () => {
  beforeEach(() => {
    commitPatchMock.mockClear();
    useKeyStore.setState({
      selectedKeyType: '4key',
      positions: { '4key': [position()] },
    });
    useStatItemStore.setState({
      positions: { '4key': [position() as StatItemPosition] },
    });
    useGraphItemStore.setState({
      positions: { '4key': [position() as GraphItemPosition] },
    });
    useKnobItemStore.setState({
      positions: { '4key': [position() as KnobItemPosition] },
    });
  });

  it('saves a four-type resize as one editor patch', () => {
    const deferredOptions: BatchOptions[] = [];
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [
        { type: 'key', index: 0 },
        { type: 'stat', index: 0 },
        { type: 'graph', index: 0 },
        { type: 'knob', index: 0 },
      ],
      keyPositions: useKeyStore.getState().positions,
      statPositions: useStatItemStore.getState().positions,
      graphPositions: useGraphItemStore.getState().positions,
      knobPositions: useKnobItemStore.getState().positions,
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchUpdate: (updates, options) => {
        deferredOptions.push(options ?? {});
        const current = useKeyStore.getState().positions;
        useKeyStore.getState().setPositions({
          ...current,
          '4key': applyUpdates(current['4key'], updates),
        });
      },
      onStatUpdate: vi.fn(),
      onStatBatchUpdate: (updates, options) => {
        deferredOptions.push(options ?? {});
        const current = useStatItemStore.getState().positions;
        useStatItemStore.getState().setPositions({
          ...current,
          '4key': applyUpdates(current['4key'], updates),
        });
      },
      onGraphBatchUpdate: (updates, options) => {
        deferredOptions.push(options ?? {});
        const current = useGraphItemStore.getState().positions;
        useGraphItemStore.getState().setPositions({
          ...current,
          '4key': applyUpdates(current['4key'], updates),
        });
      },
      onKnobBatchUpdate: (updates, options) => {
        deferredOptions.push(options ?? {});
        const current = useKnobItemStore.getState().positions;
        useKnobItemStore.getState().setPositions({
          ...current,
          '4key': applyUpdates(current['4key'], updates),
        });
      },
    });

    handlers.handleBatchResize('width', 88);

    expect(deferredOptions).toHaveLength(4);
    expect(deferredOptions.every((options) => options.deferSave)).toBe(true);
    expect(commitPatchMock).toHaveBeenCalledOnce();
    expect(commitPatchMock).toHaveBeenCalledWith({
      schemaVersion: 1,
      keyPositions: { '4key': [expect.objectContaining({ width: 88 })] },
      statPositions: { '4key': [expect.objectContaining({ width: 88 })] },
      graphPositions: { '4key': [expect.objectContaining({ width: 88 })] },
      knobPositions: { '4key': [expect.objectContaining({ width: 88 })] },
    });
  });
});
