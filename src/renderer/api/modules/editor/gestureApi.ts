import { invoke } from '@tauri-apps/api/core';

import {
  EDITOR_OPS_VERSION,
  assertEditorCommitResult,
  assertEditorOpCommitResult,
  assertEditorOpsV1,
  assertSafeEditorRevision,
} from '@src/types/editor';

import type { SavedPluginInstanceWire } from '../plugin/pluginInstancesApi';
import type {
  EditorField,
  EditorOpResultV1,
  EditorOpV1,
  EditorPatchV1,
} from '@src/types/editor';

export interface GesturePluginInstancesChange {
  pluginId: string;
  instances: SavedPluginInstanceWire[];
}

interface GestureCommitRequestBase {
  gestureId: string;
  mutationId: string;
  editorBaseRevision: number;
  pluginBaseRevision: number;
  observedHistoryEpoch?: number;
  authorityGeneration: number;
  pluginChanges: GesturePluginInstancesChange[];
}

interface GesturePatchCommitRequest extends GestureCommitRequestBase {
  editorChanges?: EditorPatchV1;
  editorOpsVersion?: never;
  editorOps?: never;
}

interface GestureOpsCommitRequest extends GestureCommitRequestBase {
  editorChanges?: never;
  editorOpsVersion: typeof EDITOR_OPS_VERSION;
  editorOps: EditorOpV1[];
}

export type GestureCommitRequest =
  | GesturePatchCommitRequest
  | GestureOpsCommitRequest;

export interface GestureCommitResult {
  editorRevision: number;
  changedFields: EditorField[];
  pluginModelRevision: number;
  changedPluginIds: string[];
  authorityGeneration: number;
  editorOpResults?: EditorOpResultV1[];
}

const assertGestureCommitResult = (
  result: GestureCommitResult,
  request: GestureCommitRequest,
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
  const editorResult = {
    revision: result.editorRevision,
    changedFields: result.changedFields,
    opResults: result.editorOpResults,
  };
  if (request.editorOps) {
    assertEditorOpCommitResult(editorResult, request.editorOps);
  } else {
    assertEditorCommitResult(editorResult);
  }
  return result;
};

export const gestureApi = {
  commit: async (
    request: GestureCommitRequest,
  ): Promise<GestureCommitResult> => {
    if (request.editorOps) assertEditorOpsV1(request.editorOps);
    return assertGestureCommitResult(
      await invoke<GestureCommitResult>('commit_gesture', { request }),
      request,
    );
  },
};
