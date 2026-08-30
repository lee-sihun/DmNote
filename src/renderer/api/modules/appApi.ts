import { invoke } from '@tauri-apps/api/core';

import type {
  AppAutoUpdateResult,
  ReadyUnsubscribe,
  UpdateProgressEvent,
} from '@src/types/plugin/api';
import { subscribe } from './shared';
import { assertCanonicalEditorDocument } from '@src/types/editor';

import type {
  BootstrapPayload,
  CanonicalBootstrapPayload,
} from '@src/types/app';

interface FlushableEditorCoordinator {
  flush(): Promise<unknown>;
}

export type EditorCoordinatorLoader = () => Promise<{
  editorCoordinator: FlushableEditorCoordinator;
}>;

const loadEditorCoordinator: EditorCoordinatorLoader = () =>
  import('@src/renderer/editor/runtime/editorStateCoordinator');

export async function runAfterEditorFlush<T>(
  action: string,
  run: () => Promise<T>,
  load: EditorCoordinatorLoader = loadEditorCoordinator,
): Promise<T> {
  try {
    const { editorCoordinator } = await load();
    await editorCoordinator.flush();
  } catch (error) {
    console.error(`[Editor] ${action} canceled because saving failed`, error);
    throw error;
  }
  return run();
}

export const acknowledgeLifecycleAfterEditorFlush = (handshakeId: string) =>
  runAfterEditorFlush('app lifecycle', async () => {
    const editorBarrier = await import(
      '@src/renderer/editor/runtime/editorWriteBarrier'
    );
    if (!(await editorBarrier.drainEditorWrites())) {
      throw new Error('pending window writes failed to drain');
    }
    return invoke<void>('app_quit_after_editor_flush', { handshakeId });
  });

export const cancelLifecycleEditorFlush = (handshakeId: string) =>
  invoke<void>('app_cancel_editor_flush', { handshakeId });

export const appApi = {
  bootstrap: async (): Promise<CanonicalBootstrapPayload> => {
    const payload = await invoke<BootstrapPayload>('app_bootstrap');
    // 구버전 payload 호환: 스프라이트 미포함이면 빈 컬렉션
    payload.spritePositions ??= {};
    assertCanonicalEditorDocument(
      {
        schemaVersion: 1,
        keys: payload.keys,
        keyPositions: payload.positions,
        statPositions: payload.statPositions,
        graphPositions: payload.graphPositions,
        knobPositions: payload.knobPositions,
        spritePositions: payload.spritePositions,
        layerGroups: payload.layerGroups,
      },
      'app_bootstrap editor document',
    );
    return payload as CanonicalBootstrapPayload;
  },
  autoUpdate: (tag: string) => {
    if (window.__dmn_window_type !== 'main') {
      return Promise.reject(
        new Error('automatic update is only available in the main window'),
      );
    }
    // 설치만 수행 — 재시작은 호출자가 appApi.restart()로 이어서 요청 (실패를 구분하기 위해 분리)
    return runAfterEditorFlush('app update', () =>
      invoke<AppAutoUpdateResult>('app_auto_update', { tag }),
    );
  },
  // 자동 업데이트 진행 단계 (다운로드 % / 검증 / 설치)
  onUpdateProgress: (
    listener: (event: UpdateProgressEvent) => void,
  ): ReadyUnsubscribe =>
    subscribe<UpdateProgressEvent>('update:progress', listener),
  openExternal: (url: string) => invoke<void>('app_open_external', { url }),
  restart: () =>
    runAfterEditorFlush('app restart', () => invoke<void>('app_restart')),
  quit: () => runAfterEditorFlush('app quit', () => invoke<void>('app_quit')),
};

export const windowApi = {
  get type() {
    return window.__dmn_window_type as 'main' | 'overlay';
  },
  minimize: () => invoke<void>('window_minimize'),
  close: () =>
    runAfterEditorFlush('window close', () => invoke<void>('window_close')),
  showMain: () => invoke<void>('window_show_main'),
  openDevtoolsAll: () => invoke<void>('window_open_devtools_all'),
};
