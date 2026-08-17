import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

import type { EditorCommitError, EditorDocumentV1 } from '@src/types/editor';

const runtime = vi.hoisted(() => {
  let rejectCommit!: (error: EditorCommitError) => void;
  const pendingCommit = new Promise<never>((_, reject) => {
    rejectCommit = reject;
  });
  const get = vi.fn();
  const commit = vi.fn(() => pendingCommit);
  const onCommitted = vi.fn(() =>
    Object.assign(() => {}, { ready: Promise.resolve() }),
  );
  const subscribe = vi.fn(async () => 1);
  const publish = vi.fn(async () => {});
  const cancel = vi.fn(async () => {});

  return {
    cancel,
    commit,
    get,
    onCommitted,
    publish,
    rejectCommit: (error: EditorCommitError) => rejectCommit(error),
    subscribe,
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
    publish: runtime.publish,
    subscribe: runtime.subscribe,
  },
}));

import { editGestureController } from './editGestureController';
import { editorCoordinator } from './editorStateCoordinator';
import { previewOverlay } from './previewOverlay';

const KEY_ID = '00000000-0000-4000-8000-000000000601';

const makeDocument = (): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: { '4key': ['A'] },
  keyPositions: { '4key': [{ ...createDefaultKeyPosition(), id: KEY_ID }] },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  layerGroups: {},
});

const ioError = (): EditorCommitError => ({
  errorCode: 'IO_ERROR',
  message: 'disk unavailable',
  retryable: true,
});

describe('discarded editor gesture integration', () => {
  afterEach(() => {
    editGestureController.cancel();
    editorCoordinator.stop();
    previewOverlay.clearAll();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps truncated sessions terminal after shared IO failure; old code revived the first session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const document = makeDocument();
    runtime.get.mockResolvedValue({ revision: 0, document });
    await editorCoordinator.start();

    const sessionIds: string[] = [];
    const commits: Array<Promise<EditorDocumentV1>> = [];
    const queueGesture = (index: number) => {
      const width = 61 + index;
      editGestureController.preview('4key', [{ id: KEY_ID, patch: { width } }]);
      const sessionId = editGestureController.activeGestureId();
      expect(sessionId).not.toBeNull();
      sessionIds.push(sessionId!);
      const persisted = editorCoordinator.commitPatch(
        {
          schemaVersion: 1,
          keyPositions: {
            '4key': [{ ...createDefaultKeyPosition(), width }],
          },
        },
        { gestureId: sessionId! },
      );
      editGestureController.settleCommit(persisted);
      commits.push(persisted);
    };

    queueGesture(0);
    await vi.waitFor(() => expect(runtime.commit).toHaveBeenCalledOnce());
    for (let index = 1; index < 34; index += 1) {
      queueGesture(index);
    }

    await vi.waitFor(() =>
      expect(runtime.cancel).toHaveBeenCalledWith(sessionIds[1]),
    );
    runtime.rejectCommit(ioError());
    const results = await Promise.allSettled(commits);

    expect(results.every(({ status }) => status === 'rejected')).toBe(true);
    expect(runtime.cancel).toHaveBeenCalledWith(sessionIds[0]);
    expect(runtime.cancel).toHaveBeenCalledWith(sessionIds[1]);
    expect([sessionIds[0], sessionIds[1]]).not.toContain(
      editGestureController.activeGestureId(),
    );
  });
});
