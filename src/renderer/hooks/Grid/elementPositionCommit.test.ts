import { beforeEach, describe, expect, it, vi } from 'vitest';

const patches = vi.hoisted(() => ({
  applyElementPatchById: vi.fn(async () => true),
}));

vi.mock('@src/renderer/editor/runtime/elementPatch', () => patches);

import { commitElementPosition } from './elementPositionCommit';

describe('commitElementPosition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('id가 있으면 index 폴백 대신 ID applier로 적용한다', () => {
    const fallback = vi.fn();

    commitElementPosition('key', 'element-id', 12, 34, fallback);

    expect(fallback).not.toHaveBeenCalled();
    expect(patches.applyElementPatchById).toHaveBeenCalledTimes(1);
    const [type, id, updater] = patches.applyElementPatchById.mock
      .calls[0] as unknown as [string, string, () => Record<string, unknown>];
    expect(type).toBe('key');
    expect(id).toBe('element-id');
    expect(updater()).toEqual({ dx: 12, dy: 34 });
  });

  it('합성 id는 안정 ID가 아니므로 index 폴백을 유지한다', () => {
    const fallback = vi.fn();

    commitElementPosition('stat', 'stat-0', 1, 2, fallback);

    expect(patches.applyElementPatchById).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('무ID 요소는 기존 index 폴백을 유지한다', () => {
    const fallback = vi.fn();

    commitElementPosition('stat', undefined, 1, 2, fallback);

    expect(patches.applyElementPatchById).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
