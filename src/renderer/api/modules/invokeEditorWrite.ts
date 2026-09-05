import { invoke } from '@tauri-apps/api/core';
import { trackEditorWrite } from '@src/renderer/editor/runtime/editorWriteBarrier';

// 영속 변경 명령 전용, 프론트 정산을 기다리는 종료·history 요청에는 사용하지 않음
export const invokeEditorWrite = <T>(
  ...args: Parameters<typeof invoke>
): Promise<T> => trackEditorWrite(invoke<T>(...args));
