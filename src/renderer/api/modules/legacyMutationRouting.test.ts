import { beforeEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({
  exclusive: vi.fn(async (mutation: () => Promise<unknown>) => mutation()),
  legacy: vi.fn(async (mutation: () => Promise<unknown>) => mutation()),
  invoke: vi.fn(async () => ({})),
}));

vi.mock('@src/renderer/editor/runtime/legacyEditorMutation', () => ({
  runExclusiveLegacyMutation: routing.exclusive,
  runLegacyEditorMutation: routing.legacy,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: routing.invoke }));

import { keysApi } from './keysApi';
import { presetsApi } from './presetsApi';
import { counterAnimationApi, imageApi, soundApi } from './resourceApi';

// 편집 문서를 직접 바꾸는 legacy 커맨드 9함수는 전부 배타 mutation을 타야
// 한다. 큐를 우회하면 대기 중이던 stale full-record가 결과를 되돌린다
describe('legacy mutation 라우팅', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['preset_load', () => presetsApi.load()],
    ['preset_load_tab', () => presetsApi.loadTab()],
    ['keys_reset_all', () => keysApi.resetAll()],
    ['keys_reset_mode', () => keysApi.resetMode('4key')],
    ['custom_tabs_create', () => keysApi.customTabs.create('tab')],
    ['custom_tabs_delete', () => keysApi.customTabs.delete('tab-id')],
    ['counter_animation_update', () => counterAnimationApi.update({} as never)],
    ['counter_animation_delete', () => counterAnimationApi.remove('id')],
    ['sound_delete', () => soundApi.remove('path.wav')],
  ] as const)('%s는 배타 mutation을 탄다', async (command, call) => {
    await call();

    expect(routing.exclusive).toHaveBeenCalledTimes(1);
    expect(routing.invoke).toHaveBeenCalledTimes(1);
    expect((routing.invoke.mock.calls[0] as unknown[])[0]).toBe(command);
  });

  it('문서를 바꾸지 않는 image.load는 배타 경로가 아니다', async () => {
    await imageApi.load();

    expect(routing.exclusive).not.toHaveBeenCalled();
    expect(routing.legacy).toHaveBeenCalledTimes(1);
  });
});
