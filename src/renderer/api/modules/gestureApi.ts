import { invoke } from '@tauri-apps/api/core';

import { assertSafeEditorRevision } from '@src/types/editor';

import type { SavedPluginInstanceWire } from './pluginInstancesApi';
import type { EditorField, EditorPatchV1 } from '@src/types/editor';

export interface GesturePluginInstancesChange {
  pluginId: string;
  instances: SavedPluginInstanceWire[];
}

export interface GestureCommitRequest {
  gestureId: string;
  mutationId: string;
  editorBaseRevision: number;
  pluginBaseRevision: number;
  observedHistoryEpoch?: number;
  authorityGeneration: number;
  editorChanges?: EditorPatchV1;
  pluginChanges: GesturePluginInstancesChange[];
}

export interface GestureCommitResult {
  editorRevision: number;
  changedFields: EditorField[];
  pluginModelRevision: number;
  changedPluginIds: string[];
  authorityGeneration: number;
}

const assertGestureCommitResult = (
  result: GestureCommitResult,
): GestureCommitResult => {
  assertSafeEditorRevision(result.editorRevision, 'editorRevision');
  assertSafeEditorRevision(result.pluginModelRevision, 'pluginModelRevision');
  assertSafeEditorRevision(result.authorityGeneration, 'authorityGeneration');
  if (
    !Array.isArray(result.changedFields) ||
    !Array.isArray(result.changedPluginIds) ||
    result.changedPluginIds.some((pluginId) => typeof pluginId !== 'string')
  ) {
    throw new Error('commit_gesture returned an invalid result');
  }
  return result;
};

export const gestureApi = {
  commit: async (request: GestureCommitRequest): Promise<GestureCommitResult> =>
    assertGestureCommitResult(
      await invoke<GestureCommitResult>('commit_gesture', { request }),
    ),
};
