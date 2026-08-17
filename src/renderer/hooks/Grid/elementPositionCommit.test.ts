import { beforeEach, describe, expect, it, vi } from 'vitest';

const patches = vi.hoisted(() => ({
  commitElementGeometryById: vi.fn(async () => true),
  reportElementOpSkipped: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  commitElementGeometryById: patches.commitElementGeometryById,
}));
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpError: vi.fn(),
  reportElementOpSkipped: patches.reportElementOpSkipped,
}));

import { commitElementPosition } from './elementPositionCommit';

describe('commitElementPosition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('정규 native ID를 ID applier로 적용한다', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    commitElementPosition('key', id, 12, 34);

    expect(patches.commitElementGeometryById).toHaveBeenCalledWith('key', id, {
      dx: 12,
      dy: 34,
    });
  });

  it('합성 ID는 wire와 로컬 쓰기를 모두 중단한다', () => {
    commitElementPosition('stat', 'stat-0', 1, 2);

    expect(patches.commitElementGeometryById).not.toHaveBeenCalled();
    expect(patches.reportElementOpSkipped).toHaveBeenCalledTimes(1);
  });

  it('빈 ID도 fail-close로 중단한다', () => {
    commitElementPosition('stat', '', 1, 2);

    expect(patches.commitElementGeometryById).not.toHaveBeenCalled();
    expect(patches.reportElementOpSkipped).toHaveBeenCalledTimes(1);
  });
});
