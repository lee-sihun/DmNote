/**
 * 호스트 uiApi 메뉴 등록의 컨텍스트 가드
 * - 플러그인 컨텍스트 id가 없으면 'unknown' 소유 고아 항목 대신 등록을 거부한다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePluginMenuStore } from '@stores/plugin/usePluginMenuStore';

import { uiApi } from './uiApi';

const globalWindow = window as unknown as {
  __dmn_window_type?: string;
  __dmn_current_plugin_id?: string;
};

describe('uiApi.contextMenu 컨텍스트 가드', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    globalWindow.__dmn_window_type = 'main';
    delete globalWindow.__dmn_current_plugin_id;
    usePluginMenuStore.getState().clearAll();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    usePluginMenuStore.getState().clearAll();
    delete globalWindow.__dmn_window_type;
    delete globalWindow.__dmn_current_plugin_id;
    vi.restoreAllMocks();
  });

  it('플러그인 컨텍스트 밖의 등록은 거부하고 빈 id를 돌려준다', () => {
    const fullId = uiApi.contextMenu.addGridMenuItem({
      id: 'orphan',
      label: 'Orphan',
      onClick: () => {},
    });

    expect(fullId).toBe('');
    expect(usePluginMenuStore.getState().gridMenuItems).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('컨텍스트 안의 등록은 소유 플러그인 id로 묶여 clearByPluginId로 지워진다', () => {
    globalWindow.__dmn_current_plugin_id = 'demo';

    const fullId = uiApi.contextMenu.addKeyMenuItem({
      id: 'item',
      label: 'Item',
      onClick: () => {},
    });

    expect(fullId).toBe('demo:item');
    expect(usePluginMenuStore.getState().keyMenuItems).toHaveLength(1);
    usePluginMenuStore.getState().clearByPluginId('demo');
    expect(usePluginMenuStore.getState().keyMenuItems).toEqual([]);
  });
});
