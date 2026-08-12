import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  commitSemanticOpsInternal: vi.fn(),
  discardSemanticGesture: vi.fn(),
}));

vi.mock('./editorStateCoordinator', () => ({
  editorCoordinator: {
    commitSemanticOpsInternal: api.commitSemanticOpsInternal,
    discardSemanticGesture: api.discardSemanticGesture,
  },
}));

import { enqueueEditorCompatibilityWrite } from './editorCompatibilityQueue';
import { commitSemanticOps } from './editorSemanticOps';

describe('commitSemanticOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const op = {
    kind: 'setBounds' as const,
    elementType: 'key' as const,
    id: '00000000-0000-4000-8000-000000000001',
    bounds: { dx: 0, dy: 0, width: 10, height: 10 },
  };

  it('coordinator 편입 전 실패는 preview gesture를 폐기한다', async () => {
    api.commitSemanticOpsInternal.mockRejectedValueOnce(
      new Error('conflict pending'),
    );

    await expect(
      commitSemanticOps(
        [
          {
            kind: 'setBounds',
            elementType: 'key',
            id: '00000000-0000-4000-8000-000000000002',
            bounds: { dx: 0, dy: 0, width: 10, height: 10 },
          },
        ],
        { gestureId: 'pre-enrollment' },
      ),
    ).rejects.toThrow('conflict pending');

    expect(api.discardSemanticGesture).toHaveBeenCalledWith('pre-enrollment');
  });

  it('compatibility writer 뒤에서 coordinator 직렬 슬롯에 합류한다', async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueueEditorCompatibilityWrite(
      () => blocker,
      () => undefined,
    );
    const outcome = {
      document: {
        schemaVersion: 1 as const,
        keys: {},
        keyPositions: {},
        statPositions: {},
        graphPositions: {},
        knobPositions: {},
        layerGroups: {},
      },
      opResults: [{ status: 'targetMissing' as const }],
    };
    api.commitSemanticOpsInternal.mockResolvedValueOnce(outcome);

    const pending = commitSemanticOps([op]);
    await Promise.resolve();
    expect(api.commitSemanticOpsInternal).not.toHaveBeenCalled();

    release();
    await first;
    await expect(pending).resolves.toEqual(outcome);
    expect(api.commitSemanticOpsInternal).toHaveBeenCalledOnce();
  });

  it('semantic op 뒤의 legacy writer는 op 완료를 기다린다', async () => {
    let release!: () => void;
    api.commitSemanticOpsInternal.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ document: {}, opResults: [] });
        }),
    );
    const semantic = commitSemanticOps([op]);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const legacyWrite = vi.fn(async () => undefined);
    const legacy = enqueueEditorCompatibilityWrite(
      legacyWrite,
      () => undefined,
    );

    await Promise.resolve();
    expect(legacyWrite).not.toHaveBeenCalled();
    release();
    await semantic;
    await legacy;
    expect(legacyWrite).toHaveBeenCalledOnce();
  });
});
