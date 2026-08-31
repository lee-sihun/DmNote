import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

import {
  assertEditorCommitResult,
  assertEditorOpCommitResult,
  assertEditorCommittedEvent,
  assertEditorGetResult,
  assertEditorOpsV1,
  assertSafeEditorRevision,
} from '@src/types/editor';
import { EditorReadOnlyError } from '@src/renderer/editor/runtime/editorCoordinator';

import type {
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  CanonicalEditorGetResult,
  EditorGetResult,
  PluginEditorCommitRequest,
} from '@src/types/editor';

// envelope 무가공 전송. 플러그인 게이트웨이 전용 - multiKey 기본값을 주입하지
// 않아 플러그인이 선언한 값만 백엔드 게이트에 도달한다 (계약 §10)
export const editorCommitRaw = async (
  // 플러그인 요청은 스프라이트가 input 타입(poseId 생략 허용)이라 별도 멤버
  request: EditorCommitRequest | PluginEditorCommitRequest,
): Promise<EditorCommitResult> => {
  if (window.__dmn_runtime === 'obs') throw new EditorReadOnlyError();
  assertSafeEditorRevision(request.baseRevision, 'baseRevision');
  if (request.ops) assertEditorOpsV1(request.ops);
  const result = await invoke<EditorCommitResult>('editor_commit', {
    request,
  });
  if (request.ops) assertEditorOpCommitResult(result, request.ops);
  else assertEditorCommitResult(result);
  return result;
};

export const editorApi = {
  get: async (): Promise<CanonicalEditorGetResult> => {
    const result = await invoke<EditorGetResult>('editor_get');
    assertEditorGetResult(result);
    return result as CanonicalEditorGetResult;
  },
  // 자사 표면: 멀티 키 지원을 항상 선언 (명시값이 있으면 그 값 우선, 계약 §10)
  commit: (
    request: EditorCommitRequest | PluginEditorCommitRequest,
  ): Promise<EditorCommitResult> =>
    editorCommitRaw({ multiKey: true, ...request }),
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
