import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginEditorWriteBarrier } from '@src/renderer/editor/runtime/editorWriteBarrier';
import { overlayApi } from './overlayApi';
import { cssApi } from './cssApi';
import { jsApi } from './jsApi';
import { pluginApi } from './pluginApi';
import { noteTabApi } from './noteTabApi';
import { keysApi } from './keysApi';
import { setKeyMode } from './keyModeApi';
import {
  counterAnimationApi,
  keySoundOutputApi,
  soundApi,
} from './resourceApi';
import { obsApi } from './obsApi';
import { historyApi } from './historyApi';
import { acknowledgeLifecycleAfterEditorFlush } from './appApi';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./shared', () => ({ subscribe: vi.fn() }));
vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { flush: vi.fn(async () => {}) },
}));

const writes: [string, () => Promise<unknown>][] = [
  ['overlay_set_visible', () => overlayApi.setVisible(true)],
  ['overlay_set_lock', () => overlayApi.setLock(true)],
  ['overlay_set_anchor', () => overlayApi.setAnchor('top-left')],
  ['overlay_resize', () => overlayApi.resize({ width: 400, height: 300 })],
  ['overlay_reset_position', () => overlayApi.resetPosition()],
  ['css_toggle', () => cssApi.toggle(true)],
  ['css_set_content', () => cssApi.setContent('body {}')],
  ['css_reset', () => cssApi.reset()],
  ['css_history_activate', () => cssApi.historyActivate('saved.css')],
  ['css_history_remove', () => cssApi.historyRemove('saved.css')],
  ['css_tab_clear', () => cssApi.tab.clear('4key')],
  ['css_tab_toggle', () => cssApi.tab.toggle('4key', true)],
  [
    'css_tab_activate_history',
    () => cssApi.tab.activateHistory('4key', 'saved.css'),
  ],
  ['css_tab_set', () => cssApi.tab.set('4key', null)],
  ['js_toggle', () => jsApi.toggle(true)],
  ['js_reload', () => jsApi.reload()],
  ['js_remove_plugin', () => jsApi.remove('test-plugin')],
  ['js_set_plugin_enabled', () => jsApi.setPluginEnabled('test-plugin', true)],
  ['js_set_content', () => jsApi.setContent('')],
  ['js_reset', () => jsApi.reset()],
  ['plugin_storage_set', () => pluginApi.storage.set('test/key', { value: 1 })],
  ['plugin_storage_remove', () => pluginApi.storage.remove('test/key')],
  ['plugin_storage_clear', () => pluginApi.storage.clear()],
  [
    'plugin_storage_clear_by_prefix',
    () => pluginApi.storage.clearByPrefix('test/'),
  ],
  ['note_tab_set', () => noteTabApi.set('4key', null)],
  ['note_tab_clear', () => noteTabApi.clear('4key')],
  ['keys_set_mode', () => setKeyMode('4key')],
  ['keys_set_counters', () => keysApi.setCounters({})],
  ['keys_reset_counters', () => keysApi.resetCounters()],
  ['keys_reset_counters_mode', () => keysApi.resetCountersMode('4key')],
  ['keys_reset_single_counter', () => keysApi.resetSingleCounter('4key', 'A')],
  ['custom_tabs_select', () => keysApi.customTabs.select('tab-id')],
  ['custom_tabs_restore', () => keysApi.customTabs.restore([], '4key')],
  ['sound_rename', () => soundApi.rename('sound.wav', 'Renamed')],
  ['sound_set_hidden', () => soundApi.setHidden('sound.wav', true)],
  ['sound_set_enabled', () => soundApi.setEnabled('sound.wav', false)],
  [
    'sound_save_processed_wav',
    () => soundApi.saveProcessedWav('wav-data', 'trimmed.wav'),
  ],
  [
    'sound_update_processed_wav',
    () => soundApi.updateProcessedWav('sound.wav', 'wav-data'),
  ],
  [
    'key_sound_set_output_backend',
    () => keySoundOutputApi.setBackend({ kind: 'defaultDevice' }),
  ],
  [
    'counter_animation_create',
    () =>
      counterAnimationApi.create({
        name: 'Saved',
        bezier: [0, 0, 1, 1],
        scale: 1,
        durationMs: 100,
      }),
  ],
  ['obs_start', () => obsApi.start()],
  ['obs_regenerate_token', () => obsApi.regenerateToken()],
];

const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('영속 쓰기 API의 종료 정산', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it.each(writes)(
    '%s 응답 전 정산을 끝내지 않고 실패를 호출자와 barrier에 전달한다',
    async (command, write) => {
      const pending = deferred();
      mocks.invoke.mockReturnValue(pending.promise);
      const drain = beginEditorWriteBarrier();
      const saving = write();
      const rejected = saving.catch((error: unknown) => error);
      let settled = false;
      const draining = drain().then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const settledBeforeResponse = settled;
      const error = new Error('disk write rejected');
      pending.reject(error);
      expect(await rejected).toBe(error);
      expect(await draining).toBe(false);
      expect(settledBeforeResponse).toBe(false);
      expect(mocks.invoke.mock.calls.map(([name]) => name)).toEqual([command]);
    },
  );

  it('성공한 쓰기의 반환값을 유지하고 종료 확인 응답보다 먼저 끝낸다', async () => {
    const pending = deferred();
    mocks.invoke.mockImplementation((command) =>
      command === 'plugin_storage_set' ? pending.promise : Promise.resolve(),
    );
    const saved = pluginApi.storage.set('plugin/key', 1);
    const ack = acknowledgeLifecycleAfterEditorFlush('write-test');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const commandsBeforeSaved = mocks.invoke.mock.calls.map(([name]) => name);
    pending.resolve(undefined);
    await expect(saved).resolves.toBeUndefined();
    await ack;
    expect(commandsBeforeSaved).toEqual(['plugin_storage_set']);
    expect(mocks.invoke.mock.calls.map(([name]) => name)).toEqual([
      'plugin_storage_set',
      'app_quit_after_editor_flush',
    ]);
  });

  it.each([
    ['settings read', () => overlayApi.get()],
    ['plugin read', () => pluginApi.storage.get('test/key')],
    ['history request', () => historyApi.undo('undo-id')],
  ] as const)('%s는 저장 정산이 기다리지 않는다', async (_name, operation) => {
    const pending = deferred();
    mocks.invoke.mockReturnValue(pending.promise);
    const drain = beginEditorWriteBarrier();
    const response = operation();
    const result = await Promise.race([
      drain(),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 50)),
    ]);
    pending.resolve(undefined);
    await response;
    expect(result).toBe(true);
  });
});
