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

type BatchOptions = { deferSave?: boolean };

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
      canonicalPositions: { '4key': [position()] },
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
    expect(commitPatchMock).toHaveBeenCalledWith(
      {
        schemaVersion: 1,
        keyPositions: { '4key': [expect.objectContaining({ width: 88 })] },
        statPositions: { '4key': [expect.objectContaining({ width: 88 })] },
        graphPositions: { '4key': [expect.objectContaining({ width: 88 })] },
        knobPositions: { '4key': [expect.objectContaining({ width: 88 })] },
      },
      undefined,
    );
  });

  it('routes a four-type style preview to each collection once', () => {
    const onKeyBatchPreview = vi.fn();
    const onStatBatchPreview = vi.fn();
    const onGraphBatchPreview = vi.fn();
    const onKnobBatchPreview = vi.fn();
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
      onKeyBatchPreview,
      onStatUpdate: vi.fn(),
      onStatBatchPreview,
      onGraphBatchPreview,
      onKnobBatchPreview,
    });

    handlers.handleBatchStyleChange('width', 72);

    expect(onKeyBatchPreview).toHaveBeenCalledWith([{ index: 0, width: 72 }]);
    expect(onStatBatchPreview).toHaveBeenCalledWith([{ index: 0, width: 72 }]);
    expect(onGraphBatchPreview).toHaveBeenCalledWith([{ index: 0, width: 72 }]);
    expect(onKnobBatchPreview).toHaveBeenCalledWith([{ index: 0, width: 72 }]);
  });

  it.each([
    ['left', 'dx', [10, 10, 10]],
    ['centerH', 'dx', [65, 60, 55]],
    ['right', 'dx', [120, 110, 100]],
    ['top', 'dy', [20, 20, 20]],
    ['centerV', 'dy', [70, 65, 60]],
    ['bottom', 'dy', [120, 110, 100]],
  ] as const)(
    '%s 정렬은 전체 선택 경계와 각 요소 크기를 보존해 좌표를 계산한다',
    (direction, field, expected) => {
      const positions = [
        { dx: 10, dy: 20, width: 20, height: 10 },
        { dx: 55, dy: 65, width: 30, height: 20 },
        { dx: 100, dy: 100, width: 40, height: 30 },
      ] as KeyPosition[];
      const onKeyBatchUpdate = vi.fn();
      const handlers = useBatchHandlers({
        selectedKeyLikeElements: positions.map((_, index) => ({
          type: 'key' as const,
          index,
        })),
        keyPositions: { '4key': positions },
        statPositions: {},
        selectedKeyType: '4key',
        onKeyUpdate: vi.fn(),
        onKeyBatchUpdate,
        onStatUpdate: vi.fn(),
      });

      handlers.handleBatchAlign(direction);

      expect(onKeyBatchUpdate).toHaveBeenCalledWith(
        expected.map((value, index) => ({ index, [field]: value })),
        { deferSave: true },
      );
    },
  );

  it.each([
    ['horizontal', 'dx', [10, 50, 100]],
    ['vertical', 'dy', [20, 55, 100]],
  ] as const)(
    '%s 분배는 첫·마지막 경계와 요소 크기에서 균등 간격을 계산한다',
    (direction, field, expected) => {
      const positions = [
        { dx: 10, dy: 20, width: 20, height: 10 },
        { dx: 55, dy: 65, width: 30, height: 20 },
        { dx: 100, dy: 100, width: 40, height: 30 },
      ] as KeyPosition[];
      const onKeyBatchUpdate = vi.fn();
      const handlers = useBatchHandlers({
        selectedKeyLikeElements: positions.map((_, index) => ({
          type: 'key' as const,
          index,
        })),
        keyPositions: { '4key': positions },
        statPositions: {},
        selectedKeyType: '4key',
        onKeyUpdate: vi.fn(),
        onKeyBatchUpdate,
        onStatUpdate: vi.fn(),
      });

      handlers.handleBatchDistribute(direction);

      expect(onKeyBatchUpdate).toHaveBeenCalledWith(
        expected.map((value, index) => ({ index, [field]: value })),
        { deferSave: true },
      );
    },
  );

  it('spacing은 0.1px 단위로 반올림한다', () => {
    const positions = [
      { dx: 0, dy: 0, width: 10, height: 10 },
      { dx: 30, dy: 0, width: 10, height: 10 },
      { dx: 80, dy: 0, width: 10, height: 10 },
    ] as KeyPosition[];
    const onKeyBatchUpdate = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: positions.map((_, index) => ({
        type: 'key' as const,
        index,
      })),
      keyPositions: { '4key': positions },
      statPositions: {},
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchUpdate,
      onStatUpdate: vi.fn(),
    });

    handlers.handleBatchSpacing(2.26, { gestureId: 'spacing-gesture' });

    expect(onKeyBatchUpdate).toHaveBeenCalledWith(
      [
        { index: 1, dx: 12.3 },
        { index: 2, dx: 24.6 },
      ],
      { deferSave: true },
    );
    expect(commitPatchMock).toHaveBeenCalledWith(expect.any(Object), {
      gestureId: 'spacing-gesture',
    });
  });

  it('stable geometry는 index legacy writer 대신 고수준 operation을 위임한다', () => {
    const onStableGeometryCommit = vi.fn();
    const onKeyBatchUpdate = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [
        { type: 'key', id: 'a', index: 0 },
        { type: 'key', id: 'b', index: 1 },
      ],
      keyPositions: {
        '4key': [
          { dx: 0, dy: 0, width: 10, height: 10 } as KeyPosition,
          { dx: 20, dy: 0, width: 10, height: 10 } as KeyPosition,
        ],
      },
      statPositions: {},
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchUpdate,
      onStatUpdate: vi.fn(),
      stableGeometryEnabled: true,
      onStableGeometryCommit,
    });

    handlers.handleBatchAlign('left');
    handlers.handleBatchDistribute('horizontal');
    handlers.handleBatchSpacingCommit(3.2, {
      gestureId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
    handlers.handleBatchResize('width', 88);

    expect(onStableGeometryCommit.mock.calls).toEqual([
      [{ kind: 'align', direction: 'left' }],
      [{ kind: 'distribute', direction: 'horizontal' }],
      [
        { kind: 'spacing', spacing: 3.2 },
        { gestureId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      ],
      [{ kind: 'resize', dimension: 'width', value: 88 }],
    ]);
    expect(onKeyBatchUpdate).not.toHaveBeenCalled();
    expect(commitPatchMock).not.toHaveBeenCalled();
  });

  it('stable W/H preview는 ID-aware callback만 호출한다', () => {
    const onStableGeometryPreview = vi.fn();
    const onKeyBatchPreview = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [
        { type: 'key', id: 'a', index: 0 },
        { type: 'key', id: 'b', index: 1 },
      ],
      keyPositions: { '4key': [position(), position()] },
      statPositions: {},
      selectedKeyType: '4key',
      onKeyUpdate: vi.fn(),
      onKeyBatchPreview,
      onStatUpdate: vi.fn(),
      stableGeometryEnabled: true,
      onStableGeometryPreview,
    });

    handlers.handleBatchStyleChange('height', 91);

    expect(onStableGeometryPreview).toHaveBeenCalledWith({
      kind: 'resize',
      dimension: 'height',
      value: 91,
    });
    expect(onKeyBatchPreview).not.toHaveBeenCalled();
  });
});
