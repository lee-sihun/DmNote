import { invoke } from '@tauri-apps/api/core';

import type { AppAutoUpdateResult } from '@src/types/plugin/api';
import type { BootstrapPayload } from '@src/types/app';

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
  runAfterEditorFlush('app lifecycle', () =>
    invoke<void>('app_quit_after_editor_flush', { handshakeId }),
  );

export const cancelLifecycleEditorFlush = (handshakeId: string) =>
  invoke<void>('app_cancel_editor_flush', { handshakeId });

export const appApi = {
  bootstrap: () => invoke<BootstrapPayload>('app_bootstrap'),
  autoUpdate: (tag: string) => {
    if (window.__dmn_window_type !== 'main') {
      return Promise.reject(
        new Error('automatic update is only available in the main window'),
      );
    }
    return runAfterEditorFlush('app update', async () => {
      const result = await invoke<AppAutoUpdateResult>('app_auto_update', {
        tag,
      });
      await invoke<void>('app_restart');
      return result;
    });
  },
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
