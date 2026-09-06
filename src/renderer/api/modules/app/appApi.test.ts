import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, coordinatorFlush, drainEditorWrites } = vi.hoisted(() => ({
  invoke: vi.fn(),
  coordinatorFlush: vi.fn(),
  drainEditorWrites: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock(
  '@src/renderer/editor/runtime/coordinator/editorStateCoordinator',
  () => ({
    editorCoordinator: { flush: coordinatorFlush },
  }),
);
vi.mock('@src/renderer/editor/runtime/lifecycle/editorWriteBarrier', () => ({
  beginEditorWriteBarrier: () => drainEditorWrites,
}));

import {
  acknowledgeLifecycleAfterEditorFlush,
  appApi,
  runAfterEditorFlush,
} from './appApi';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

const bootstrapPayload = () => ({
  keys: { '4key': ['A'] },
  positions: {
    '4key': [
      {
        ...createDefaultKeyPosition(),
        id: '00000000-0000-4000-8000-000000000001',
      },
    ],
  },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  layerGroups: {},
});

describe('runAfterEditorFlush', () => {
  beforeEach(() => {
    drainEditorWrites.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    invoke.mockReset();
    coordinatorFlush.mockReset();
    drainEditorWrites.mockReset();
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

  it('bootstrap native ID가 canonical일 때만 payload를 반환한다', async () => {
    invoke.mockResolvedValueOnce(bootstrapPayload());

    await expect(appApi.bootstrap()).resolves.toMatchObject({
      positions: {
        '4key': [{ id: '00000000-0000-4000-8000-000000000001' }],
      },
    });
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'key-0'],
    ['nil', '00000000-0000-0000-0000-000000000000'],
  ])('bootstrap의 %s native ID를 반환 전에 거절한다', async (_label, id) => {
    const payload = bootstrapPayload();
    if (id === undefined) delete payload.positions['4key'][0].id;
    else payload.positions['4key'][0].id = id;
    invoke.mockResolvedValueOnce(payload);

    await expect(appApi.bootstrap()).rejects.toThrow();
  });

  it('bootstrap의 전역 중복 native ID를 반환 전에 거절한다', async () => {
    const payload = bootstrapPayload();
    payload.statPositions = {
      '4key': [
        {
          ...payload.positions['4key'][0],
          statType: 'kps',
        },
      ],
    };
    invoke.mockResolvedValueOnce(payload);

    await expect(appApi.bootstrap()).rejects.toThrow();
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

  it('installs the update after the editor flush without restarting', async () => {
    window.__dmn_window_type = 'main';
    coordinatorFlush.mockResolvedValue(undefined);
    const updateResult = {
      previousVersion: '1.6.1',
      updatedTo: '1.7.0',
      downloadUrl: 'https://example.test/update',
    };
    invoke.mockResolvedValueOnce(updateResult);

    await expect(appApi.autoUpdate('1.7.0')).resolves.toEqual(updateResult);

    expect(coordinatorFlush).toHaveBeenCalledOnce();
    // 재시작은 호출자(useUpdateStore)가 appApi.restart()로 별도 요청
    expect(invoke.mock.calls).toEqual([['app_auto_update', { tag: '1.7.0' }]]);
  });

  it('acks lifecycle only after the editor write queue drains', async () => {
    coordinatorFlush.mockResolvedValue(undefined);
    let releaseEditor!: (value: boolean) => void;
    drainEditorWrites.mockReturnValue(
      new Promise<boolean>((resolve) => {
        releaseEditor = resolve;
      }),
    );
    invoke.mockResolvedValue(undefined);

    const pending = acknowledgeLifecycleAfterEditorFlush('handshake-1');
    await vi.waitFor(() => {
      expect(drainEditorWrites).toHaveBeenCalledOnce();
    });
    expect(invoke).not.toHaveBeenCalled();

    releaseEditor(true);
    await pending;

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('app_quit_after_editor_flush', {
      handshakeId: 'handshake-1',
    });
  });

  it('does not ack lifecycle when the editor queue fails to drain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    coordinatorFlush.mockResolvedValue(undefined);
    drainEditorWrites.mockResolvedValue(false);

    await expect(
      acknowledgeLifecycleAfterEditorFlush('handshake-failed'),
    ).rejects.toThrow('pending window writes failed to drain');

    expect(invoke).not.toHaveBeenCalled();
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
