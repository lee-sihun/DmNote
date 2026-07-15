import { afterEach, describe, expect, it, vi } from 'vitest';

const { invoke, coordinatorFlush } = vi.hoisted(() => ({
  invoke: vi.fn(),
  coordinatorFlush: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { flush: coordinatorFlush },
}));

import { appApi, runAfterEditorFlush } from './appApi';

describe('runAfterEditorFlush', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    invoke.mockReset();
    coordinatorFlush.mockReset();
    delete window.__dmn_window_type;
  });

  it('runs a lifecycle action only after pending editor state is saved', async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push('flush');
    });
    const run = vi.fn(async () => {
      order.push('quit');
      return 'done';
    });

    const result = await runAfterEditorFlush('app quit', run, async () => ({
      editorCoordinator: { flush },
    }));

    expect(result).toBe('done');
    expect(order).toEqual(['flush', 'quit']);
  });

  it('cancels the lifecycle action when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('disk unavailable');
    const run = vi.fn(async () => undefined);

    await expect(
      runAfterEditorFlush('window close', run, async () => ({
        editorCoordinator: {
          flush: vi.fn().mockRejectedValue(error),
        },
      })),
    ).rejects.toBe(error);

    expect(run).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '[Editor] window close canceled because saving failed',
      error,
    );
  });

  it('restarts through the all-window handshake after a successful update', async () => {
    window.__dmn_window_type = 'main';
    coordinatorFlush.mockResolvedValue(undefined);
    const updateResult = {
      previousVersion: '1.6.1',
      updatedTo: '1.7.0',
      downloadUrl: 'https://example.test/update',
    };
    invoke.mockResolvedValueOnce(updateResult).mockResolvedValueOnce(undefined);

    await expect(appApi.autoUpdate('1.7.0')).resolves.toEqual(updateResult);

    expect(coordinatorFlush).toHaveBeenCalledOnce();
    expect(invoke.mock.calls).toEqual([
      ['app_auto_update', { tag: '1.7.0' }],
      ['app_restart'],
    ]);
  });

  it('rejects automatic update outside the main window', async () => {
    window.__dmn_window_type = 'overlay';

    await expect(appApi.autoUpdate('1.7.0')).rejects.toThrow(
      'automatic update is only available in the main window',
    );
    expect(coordinatorFlush).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
