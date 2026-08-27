import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKeyStore } from '@stores/data/useKeyStore';
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
import { patchPaintById } from './elementOps';
import { editorCoordinator } from './editorStateCoordinator';
import { previewOverlay } from './previewOverlay';

const KEY_ID = '00000000-0000-4000-8000-000000000602';

const makeDocument = (): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: { '4key': ['A'] },
  keyPositions: {
    '4key': [
      {
        ...createDefaultKeyPosition(),
        id: KEY_ID,
        backgroundColor: '#111111',
      },
    ],
  },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  layerGroups: {},
});

const validationError = (): EditorCommitError => ({
  errorCode: 'VALIDATION_FAILED',
  message: 'invalid paint',
  retryable: false,
});

describe('paint gesture discard integration', () => {
  afterEach(() => {
    editGestureController.cancel();
    editorCoordinator.stop();
    previewOverlay.clearAll();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('영구 거절은 commit gestureId와 연결된 paint overlay를 폐기한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const document = makeDocument();
    runtime.get.mockResolvedValue({ revision: 0, document });
    await editorCoordinator.start();

    editGestureController.preview(
      '4key',
      [{ id: KEY_ID, patch: { backgroundColor: '#222222' } }],
      { domain: 'keyPosition' },
    );
    const gestureId = editGestureController.activeGestureId();
    expect(gestureId).not.toBeNull();
    expect(useKeyStore.getState().positions['4key'][0].backgroundColor).toBe(
      '#222222',
    );

    const persisted = patchPaintById(
      'key',
      KEY_ID,
      {
        property: 'backgroundPaint',
        value: { color: '#333333', gradient: null },
      },
      { gestureId: gestureId! },
    );
    editGestureController.settleCommit(persisted);
    await vi.waitFor(() => expect(runtime.commit).toHaveBeenCalledOnce());

    runtime.rejectCommit(validationError());
    await expect(persisted).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED',
    });
    await vi.waitFor(() =>
      expect(editGestureController.activeGestureId()).toBeNull(),
    );

    expect(useKeyStore.getState().positions['4key'][0].backgroundColor).toBe(
      '#111111',
    );
    expect(runtime.cancel).toHaveBeenCalledWith(gestureId);
  });
});
