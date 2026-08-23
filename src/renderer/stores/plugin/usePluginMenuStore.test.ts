/**
 * 플러그인 메뉴 등록 계약 테스트
 * 빈 바닥 메뉴에서 무시되는 position을 어떻게 알리는지 검증
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePluginMenuStore } from './usePluginMenuStore';

const setCurrentPlugin = (pluginId: string) => {
  (
    window as unknown as { __dmn_current_plugin_id?: string }
  ).__dmn_current_plugin_id = pluginId;
};

describe('usePluginMenuStore', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    usePluginMenuStore.getState().clearAll();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setCurrentPlugin('demo');
  });

  afterEach(() => {
    usePluginMenuStore.getState().clearAll();
    vi.restoreAllMocks();
  });

  const gridItem = (id: string, position?: 'top' | 'bottom') => ({
    id,
    label: id,
    ...(position ? { position } : {}),
    onClick: () => {},
  });

  it('그리드 항목의 position은 플러그인당 한 번만 알린다', () => {
    usePluginMenuStore.getState().addGridMenuItem(gridItem('a', 'top'));
    usePluginMenuStore.getState().addGridMenuItem(gridItem('b', 'bottom'));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('demo');
  });

  it('position이 없으면 알리지 않는다', () => {
    usePluginMenuStore.getState().addGridMenuItem(gridItem('a'));

    expect(warn).not.toHaveBeenCalled();
  });

  it('키 메뉴에서는 position이 유효하므로 알리지 않는다', () => {
    usePluginMenuStore.getState().addKeyMenuItem(gridItem('a', 'top'));

    expect(warn).not.toHaveBeenCalled();
    expect(usePluginMenuStore.getState().keyMenuItems[0].position).toBe('top');
  });

  it('그리드 항목을 position으로 갱신해도 알린다', () => {
    const fullId = usePluginMenuStore.getState().addGridMenuItem(gridItem('a'));
    expect(warn).not.toHaveBeenCalled();

    usePluginMenuStore.getState().updateMenuItem(fullId, { position: 'top' });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('플러그인을 다시 불러오면 같은 실수를 다시 알린다', () => {
    usePluginMenuStore.getState().addGridMenuItem(gridItem('a', 'top'));
    usePluginMenuStore.getState().clearByPluginId('demo');
    usePluginMenuStore.getState().addGridMenuItem(gridItem('a', 'top'));

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('플러그인이 다르면 각각 한 번씩 알린다', () => {
    usePluginMenuStore.getState().addGridMenuItem(gridItem('a', 'top'));
    setCurrentPlugin('other');
    usePluginMenuStore.getState().addGridMenuItem(gridItem('a', 'top'));

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
