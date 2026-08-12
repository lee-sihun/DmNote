import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: runtime.invoke }));

import { EditorProtocolError } from '@src/types/editor';
import { gestureApi, type GestureCommitRequest } from './gestureApi';

const baseRequest = {
  gestureId: 'gesture-a',
  mutationId: '00000000-0000-4000-8000-000000000001',
  editorBaseRevision: 0,
  pluginBaseRevision: 0,
  authorityGeneration: 0,
  pluginChanges: [],
};

const baseResult = {
  editorRevision: 1,
  pluginModelRevision: 1,
  changedPluginIds: [],
  authorityGeneration: 0,
};

describe('gestureApi semantic op protocol', () => {
  beforeEach(() => runtime.invoke.mockReset());

  it('ordered editorOpResults와 changedFields가 맞는 응답만 수용한다', async () => {
    const request: GestureCommitRequest = {
      ...baseRequest,
      editorOpsVersion: 1,
      editorOps: [
        {
          kind: 'setBounds',
          elementType: 'key',
          id: '00000000-0000-4000-8000-000000000002',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    };
    runtime.invoke.mockResolvedValueOnce({
      ...baseResult,
      changedFields: ['keyPositions'],
      editorOpResults: [
        {
          status: 'applied',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    });

    await expect(gestureApi.commit(request)).resolves.toMatchObject({
      editorOpResults: [{ status: 'applied' }],
    });
  });

  it('ops 결과 누락과 changedFields 불일치를 거절한다', async () => {
    const request: GestureCommitRequest = {
      ...baseRequest,
      editorOpsVersion: 1,
      editorOps: [
        {
          kind: 'setBounds',
          elementType: 'key',
          id: '00000000-0000-4000-8000-000000000002',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    };
    runtime.invoke.mockResolvedValueOnce({
      ...baseResult,
      changedFields: [],
    });
    await expect(gestureApi.commit(request)).rejects.toBeInstanceOf(
      EditorProtocolError,
    );

    runtime.invoke.mockResolvedValueOnce({
      ...baseResult,
      changedFields: [],
      editorOpResults: [
        {
          status: 'applied',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    });
    await expect(gestureApi.commit(request)).rejects.toBeInstanceOf(
      EditorProtocolError,
    );
  });

  it('patch와 plugin-only 응답의 editorOpResults를 거절한다', async () => {
    for (const request of [
      { ...baseRequest, editorChanges: { schemaVersion: 1 as const } },
      baseRequest,
    ]) {
      runtime.invoke.mockResolvedValueOnce({
        ...baseResult,
        changedFields: [],
        editorOpResults: [],
      });
      await expect(
        gestureApi.commit(request as GestureCommitRequest),
      ).rejects.toBeInstanceOf(EditorProtocolError);
    }
  });
});
