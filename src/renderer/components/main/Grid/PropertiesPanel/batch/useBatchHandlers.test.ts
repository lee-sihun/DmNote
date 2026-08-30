import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import type { KeyPosition } from '@src/types/key/keys';

import { useBatchHandlers } from './useBatchHandlers';

vi.mock('@src/renderer/editor/model/elementIdMap', () => ({
  resolveElementById: vi.fn(),
}));

const IDS = {
  first: '11111111-1111-4111-8111-111111111111',
  second: '22222222-2222-4222-8222-222222222222',
  third: '33333333-3333-4333-8333-333333333333',
} as const;

const position = (id: string, dx: number, width = 10): KeyPosition =>
  ({ id, dx, dy: 0, width, height: 10 } as KeyPosition);

const createHandlers = () => {
  const onStableGeometryCommit = vi.fn();
  const onStableGeometryPreview = vi.fn();
  // 순수 계산 훅을 고정 fixture에서 직접 호출
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handlers = useBatchHandlers({
    selectedKeyLikeElements: [
      { type: 'key', id: IDS.first },
      { type: 'key', id: IDS.second },
      { type: 'key', id: IDS.third },
    ],
    keyPositions: {
      '4key': [
        position(IDS.second, 30),
        position(IDS.first, 0),
        position(IDS.third, 60),
      ],
    },
    statPositions: {},
    selectedKeyType: '4key',
    onStableGeometryCommit,
    onStableGeometryPreview,
  });
  return { handlers, onStableGeometryCommit, onStableGeometryPreview };
};

describe('useBatchHandlers stable geometry', () => {
  beforeEach(() => {
    vi.mocked(resolveElementById).mockImplementation((_type, id) =>
      id === IDS.first
        ? { type: 'key', mode: '4key', index: 1 }
        : id === IDS.second
        ? { type: 'key', mode: '4key', index: 0 }
        : id === IDS.third
        ? { type: 'key', mode: '4key', index: 2 }
        : null,
    );
  });

  it('현재 ID 위치로 geometry operation만 위임한다', () => {
    const { handlers, onStableGeometryCommit, onStableGeometryPreview } =
      createHandlers();

    handlers.handleBatchAlign('left');
    handlers.handleBatchDistribute('horizontal');
    handlers.handleBatchSpacingPreview(3.2);
    handlers.handleBatchSpacingCommit(3.2, {
      gestureId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
    handlers.handleBatchResizePreview('height', 91);
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
    expect(onStableGeometryPreview.mock.calls).toEqual([
      [{ kind: 'spacing', spacing: 3.2 }],
      [{ kind: 'resize', dimension: 'height', value: 91 }],
    ]);
    expect(handlers.getBatchSpacingValue()).toEqual({
      isMixed: false,
      value: 20,
    });
  });

  it('sprite 대상도 기하 조작에 참여한다', () => {
    vi.mocked(resolveElementById).mockImplementation((type, id) =>
      type === 'key' && id === IDS.first
        ? { type: 'key', mode: '4key', index: 0 }
        : type === 'sprite' && id === IDS.second
        ? { type: 'sprite', mode: '4key', index: 0 }
        : null,
    );
    const onStableGeometryCommit = vi.fn();
    const onStableGeometryPreview = vi.fn();
    const handlers = useBatchHandlers({
      selectedKeyLikeElements: [
        { type: 'key', id: IDS.first },
        { type: 'sprite', id: IDS.second },
      ],
      keyPositions: { '4key': [position(IDS.first, 0)] },
      statPositions: {},
      spritePositions: {
        '4key': [
          { id: IDS.second, dx: 40, dy: 0, width: 20, height: 10 } as never,
        ],
      },
      selectedKeyType: '4key',
      onStableGeometryCommit,
      onStableGeometryPreview,
    });

    handlers.handleBatchAlign('left');
    handlers.handleBatchSpacingPreview(5);

    expect(onStableGeometryCommit).toHaveBeenCalledWith({
      kind: 'align',
      direction: 'left',
    });
    expect(onStableGeometryPreview).toHaveBeenCalledWith({
      kind: 'spacing',
      spacing: 5,
    });
    // sprite 위치가 간격 계산에 실제로 잡힌다
    expect(handlers.getBatchSpacingValue()).toEqual({
      isMixed: false,
      value: 30,
    });
  });

  it('대상 ID를 현재 문서에서 모두 찾지 못하면 preview와 commit을 막는다', () => {
    vi.mocked(resolveElementById).mockImplementation((_type, id) =>
      id === IDS.first ? { type: 'key', mode: '4key', index: 1 } : null,
    );
    const { handlers, onStableGeometryCommit, onStableGeometryPreview } =
      createHandlers();

    handlers.handleBatchAlign('left');
    handlers.handleBatchResizePreview('width', 50);

    expect(onStableGeometryCommit).not.toHaveBeenCalled();
    expect(onStableGeometryPreview).not.toHaveBeenCalled();
  });
});
