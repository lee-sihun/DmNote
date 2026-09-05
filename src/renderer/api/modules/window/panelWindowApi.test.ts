import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { panelWindowApi } from './panelWindowApi';

describe('panelWindowApi drag cursor', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
  });

  it('네이티브 커서 고정과 해제를 Rust 커맨드로 위임한다', async () => {
    await panelWindowApi.setDragCursor(true);
    await panelWindowApi.setDragCursor(false);

    expect(invoke.mock.calls).toEqual([
      ['panel_window_set_drag_cursor', { active: true }],
      ['panel_window_set_drag_cursor', { active: false }],
    ]);
  });
});
