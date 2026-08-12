import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: runtime.invoke }));

import { EditorProtocolError } from '@src/types/editor';
import { editorCommitRaw } from './editorApi';

describe('editorCommitRaw semantic op protocol', () => {
  beforeEach(() => {
    runtime.invoke.mockReset();
    window.__dmn_runtime = 'tauri';
  });

  it('op 요청 길이와 순서에 대응하는 결과만 수용한다', async () => {
    runtime.invoke.mockResolvedValueOnce({
      revision: 1,
      changedFields: ['keyPositions'],
      opResults: [
        {
          status: 'applied',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    });
    const request = {
      baseRevision: 0,
      mutationId: '00000000-0000-4000-8000-000000000001',
      opsVersion: 1 as const,
      ops: [
        {
          kind: 'setBounds' as const,
          elementType: 'key' as const,
          id: '00000000-0000-4000-8000-000000000002',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    };

    await expect(editorCommitRaw(request)).resolves.toMatchObject({
      opResults: [{ status: 'applied' }],
    });
    expect(runtime.invoke).toHaveBeenCalledWith('editor_commit', { request });
  });

  it('patch 응답의 opResults와 길이가 다른 opResults를 거절한다', async () => {
    runtime.invoke.mockResolvedValueOnce({
      revision: 0,
      changedFields: [],
      opResults: [],
    });
    await expect(
      editorCommitRaw({
        baseRevision: 0,
        mutationId: '00000000-0000-4000-8000-000000000003',
        changes: { schemaVersion: 1 as const },
      }),
    ).rejects.toBeInstanceOf(EditorProtocolError);

    runtime.invoke.mockResolvedValueOnce({
      revision: 0,
      changedFields: [],
      opResults: [],
    });
    await expect(
      editorCommitRaw({
        baseRevision: 0,
        mutationId: '00000000-0000-4000-8000-000000000004',
        opsVersion: 1,
        ops: [
          {
            kind: 'setBounds',
            elementType: 'key',
            id: '00000000-0000-4000-8000-000000000005',
            bounds: { dx: 1, dy: 2, width: 3, height: 4 },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(EditorProtocolError);
  });
});
