import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorCommittedV1, EditorDocumentV1 } from '@src/types/editor';

const runtime = vi.hoisted(() => {
  const document: EditorDocumentV1 = {
    schemaVersion: 1,
    keys: {},
    keyPositions: {},
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    spritePositions: {},
    layerGroups: {},
  };
  let listener: ((event: EditorCommittedV1) => void) | null = null;
  const endSessions = vi.fn();
  const applyRemoteEnvelope = vi.fn();
  const cancel = vi.fn(async () => {});
  const subscribe = vi.fn(async () => 1);
  const get = vi.fn(async () => ({ revision: 0, document }));
  const commit = vi.fn();
  const onCommitted = vi.fn(
    (nextListener: (event: EditorCommittedV1) => void) => {
      listener = nextListener;
      return Object.assign(
        () => {
          listener = null;
        },
        { ready: Promise.resolve() },
      );
    },
  );

  return {
    commit,
    applyRemoteEnvelope,
    cancel,
    endSessions,
    get,
    onCommitted,
    subscribe,
    emit: (event: EditorCommittedV1) => listener?.(event),
  };
});

vi.mock('@api/modules/editorApi', () => ({
  editorApi: {
    get: runtime.get,
    commit: runtime.commit,
    onCommitted: runtime.onCommitted,
  },
}));

vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    cancel: runtime.cancel,
    subscribe: runtime.subscribe,
  },
}));

vi.mock('./previewOverlay', () => ({
  previewOverlay: {
    applyRemoteEnvelope: runtime.applyRemoteEnvelope,
    endSessions: runtime.endSessions,
  },
}));

import { editorCoordinator } from './editorStateCoordinator';

const committedEvent = (
  mutationId: string,
  gestures: Pick<EditorCommittedV1, 'gestureId' | 'gestureIds'>,
): EditorCommittedV1 => ({
  schemaVersion: 1,
  revision: 0,
  mutationId,
  changedFields: [],
  patch: { schemaVersion: 1 },
  ...gestures,
});

describe('editor state coordinator committed preview cleanup', () => {
  afterEach(() => {
    editorCoordinator.stop();
  });

  it('recovers lazy subscription and maps committed gesture cleanup', async () => {
    const initializationError = new Error('bootstrap get failed');
    runtime.get.mockRejectedValueOnce(initializationError);

    await expect(editorCoordinator.start()).rejects.toBe(initializationError);
    expect(runtime.subscribe).not.toHaveBeenCalled();

    await editorCoordinator.start();
    await editorCoordinator.start();
    expect(runtime.subscribe).toHaveBeenCalledOnce();

    runtime.emit(
      committedEvent('merged', {
        gestureIds: [
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
        ],
      }),
    );
    await vi.waitFor(() => expect(runtime.endSessions).toHaveBeenCalledOnce());
    expect(runtime.endSessions).toHaveBeenLastCalledWith([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);

    runtime.emit(
      committedEvent('legacy', {
        gestureId: '00000000-0000-4000-8000-000000000003',
      }),
    );
    await vi.waitFor(() =>
      expect(runtime.endSessions).toHaveBeenCalledTimes(2),
    );
    expect(runtime.endSessions).toHaveBeenLastCalledWith([
      '00000000-0000-4000-8000-000000000003',
    ]);
  });
});
