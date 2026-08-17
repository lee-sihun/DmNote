import { invoke } from '@tauri-apps/api/core';

import type { AppAutoUpdateResult } from '@src/types/plugin/api';
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
    const [editorBarrier, pluginElements, pluginSettings] = await Promise.all([
      import('@src/renderer/editor/runtime/editorWriteBarrier'),
      import('@plugins/rpc/pluginElementActions'),
      import('@plugins/rpc/pluginSettingsMirror'),
    ]);
    const drained = await Promise.all([
      editorBarrier.drainEditorWrites(),
      pluginElements.drainPendingPluginElementWrites(),
      pluginSettings.drainPendingPluginSettingsWrites(),
    ]);
    if (drained.some((succeeded) => !succeeded)) {
      throw new Error('pending window writes failed to drain');
    }
    return invoke<void>('app_quit_after_editor_flush', { handshakeId });
  });

export const cancelLifecycleEditorFlush = (handshakeId: string) =>
  invoke<void>('app_cancel_editor_flush', { handshakeId });

export const appApi = {
  bootstrap: async (): Promise<CanonicalBootstrapPayload> => {
    const payload = await invoke<BootstrapPayload>('app_bootstrap');
    assertCanonicalEditorDocument(
      {
        schemaVersion: 1,
        keys: payload.keys,
        keyPositions: payload.positions,
        statPositions: payload.statPositions,
        graphPositions: payload.graphPositions,
        knobPositions: payload.knobPositions,
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
