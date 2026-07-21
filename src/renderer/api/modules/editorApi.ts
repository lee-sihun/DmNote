import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

import {
  assertEditorCommitResult,
  assertEditorCommittedEvent,
  assertEditorGetResult,
  assertSafeEditorRevision,
} from '@src/types/editor';
import { EditorReadOnlyError } from '@src/renderer/editor/runtime/editorCoordinator';

import type {
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorGetResult,
} from '@src/types/editor';

export const editorApi = {
  get: async (): Promise<EditorGetResult> => {
    const result = await invoke<EditorGetResult>('editor_get');
    assertEditorGetResult(result);
    return result;
  },
  commit: async (request: EditorCommitRequest): Promise<EditorCommitResult> => {
    if (window.__dmn_runtime === 'obs') throw new EditorReadOnlyError();
    assertSafeEditorRevision(request.baseRevision, 'baseRevision');
    const result = await invoke<EditorCommitResult>('editor_commit', {
      request,
    });
    assertEditorCommitResult(result);
    return result;
  },
  onCommitted: (listener: (event: EditorCommittedV1) => void) =>
    subscribe<EditorCommittedV1>('editor:committed', (event) => {
      try {
        assertEditorCommittedEvent(event);
        listener(event);
      } catch (error) {
        console.error('[Editor] Ignored an invalid committed event', error);
      }
    }),
};
