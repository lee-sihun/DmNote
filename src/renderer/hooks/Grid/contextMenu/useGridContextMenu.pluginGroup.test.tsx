/**
 * 빈 바닥 컨텍스트 메뉴의 플러그인 묶음 테스트
 * 루트 길이 고정, 등록 순서 보존, predicate 예외 격리, 키 메뉴 비적용을 검증
 */
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PLUGIN_GROUP_ID,
  useGridContextMenu,
} from '@hooks/Grid/contextMenu/useGridContextMenu';
import en from '@src/renderer/locales/en.json';
import ko from '@src/renderer/locales/ko.json';
import ru from '@src/renderer/locales/ru.json';
import zhHant from '@src/renderer/locales/zh-Hant.json';
import zhCn from '@src/renderer/locales/zh-cn.json';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface StoreItem {
  id: string;
  label: string;
  pluginId: string;
  fullId: string;
  position?: 'top' | 'bottom';
  visible?: boolean | ((context: unknown) => boolean);
  disabled?: boolean | ((context: unknown) => boolean);
  onClick: () => void;
}

const store = vi.hoisted(() => ({
  keyMenuItems: [] as unknown[],
  gridMenuItems: [] as unknown[],
}));

vi.mock('@stores/plugin/usePluginMenuStore', () => ({
  usePluginMenuStore: <T,>(selector: (state: typeof store) => T) =>
    selector(store),
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: <T,>(
    selector: (state: { definitions: never[] }) => T,
  ) => selector({ definitions: [] }),
}));

const settings = vi.hoisted(() => ({
  useCustomCSS: true,
  obsModeEnabled: false,
}));

vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: <T,>(selector: (state: typeof settings) => T) =>
    selector(settings),
}));

const item = (id: string, extra: Partial<StoreItem> = {}): StoreItem => ({
  id,
  label: `label-${id}`,
  pluginId: 'demo',
  fullId: `demo:${id}`,
  onClick: () => {},
  ...extra,
});

interface CapturedItem {
  id: string;
  label?: string;
  disabled?: boolean;
  separator?: true;
  children?: CapturedItem[];
}

const captured: { grid: CapturedItem[]; key: CapturedItem[] } = {
  grid: [],
  key: [],
};

describe('빈 바닥 메뉴 플러그인 묶음', () => {
  let container: HTMLDivElement;
  let root: Root;

  const Probe = () => {
    const { getGridMenuItems, getKeyMenuItems } = useGridContextMenu({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['a'] },
      positions: { '4key': [{ id: 'key-1', dx: 0, dy: 0 } as never] },
      locale: 'ko',
      t: (key: string) => key,
      noteEffect: true,
    });
    const grid = getGridMenuItems({ dx: 0, dy: 0 });
    const key = getKeyMenuItems(0, 'key-1');
    useEffect(() => {
      captured.grid = grid;
      captured.key = key;
    }, [grid, key]);
    return null;
  };

  const mount = () => {
    root = createRoot(container);
    act(() => {
      root.render(<Probe />);
    });
  };

  beforeEach(() => {
    captured.grid = [];
    captured.key = [];
    store.keyMenuItems = [];
    store.gridMenuItems = [];
    settings.obsModeEnabled = false;
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('플러그인이 몇 개든 루트에는 묶음 하나만 더한다', () => {
    store.gridMenuItems = [item('a'), item('b'), item('c'), item('d')];
    mount();

    expect(captured.grid.map((entry) => entry.id)).toEqual([
      'add',
      'addStat',
      'addGraph',
      'addKnob',
      'addSprite',
      'separator-1',
      PLUGIN_GROUP_ID,
      'tabGroup',
      'resetGroup',
    ]);
    expect(captured.grid[6].label).toBe('contextMenu.plugins');
    expect(captured.grid[6].children).toHaveLength(4);
  });

  it('position을 무시하고 등록 순서와 fullId를 그대로 넘긴다', () => {
    store.gridMenuItems = [
      item('first'),
      item('second', { position: 'top' }),
      item('third'),
    ];
    mount();

    const group = captured.grid.find((entry) => entry.id === PLUGIN_GROUP_ID);
    expect(group?.children?.map((child) => child.id)).toEqual([
      'demo:first',
      'demo:second',
      'demo:third',
    ]);
  });

  it('보이는 항목이 없으면 묶음 자체를 내지 않는다', () => {
    store.gridMenuItems = [item('hidden', { visible: false })];
    mount();

    expect(captured.grid.some((entry) => entry.id === PLUGIN_GROUP_ID)).toBe(
      false,
    );
  });

  it('항목이 하나여도 묶음을 유지한다', () => {
    store.gridMenuItems = [item('only')];
    mount();

    const group = captured.grid.find((entry) => entry.id === PLUGIN_GROUP_ID);
    expect(group?.children?.map((child) => child.id)).toEqual(['demo:only']);
  });

  it('visible이 던지면 그 항목만 숨기고 메뉴는 살아남는다', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.gridMenuItems = [
      item('broken', {
        visible: () => {
          throw new Error('boom');
        },
      }),
      item('sane'),
    ];
    mount();

    const group = captured.grid.find((entry) => entry.id === PLUGIN_GROUP_ID);
    expect(group?.children?.map((child) => child.id)).toEqual(['demo:sane']);
    // 추가 5개 + 구분선 1개 + 묶음 3개
    expect(captured.grid).toHaveLength(9);
    expect(error).toHaveBeenCalled();
  });

  it('disabled가 던지면 그 항목만 비활성으로 둔다', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.gridMenuItems = [
      item('risky', {
        disabled: () => {
          throw new Error('boom');
        },
      }),
    ];
    mount();

    const group = captured.grid.find((entry) => entry.id === PLUGIN_GROUP_ID);
    expect(group?.children?.[0].disabled).toBe(true);
    expect(error).toHaveBeenCalled();
  });

  it('플러그인 항목이 전부 잠기면 묶음 행도 잠근다', () => {
    store.gridMenuItems = [
      item('one', { disabled: true }),
      item('two', { disabled: true }),
    ];
    mount();

    const group = captured.grid.find((entry) => entry.id === PLUGIN_GROUP_ID);
    expect(group?.disabled).toBe(true);
  });

  it('플러그인 항목 하나라도 살아 있으면 묶음 행은 열린다', () => {
    store.gridMenuItems = [
      item('one', { disabled: true }),
      item('two', { disabled: false }),
    ];
    mount();

    const group = captured.grid.find((entry) => entry.id === PLUGIN_GROUP_ID);
    expect(group?.disabled).toBe(false);
  });

  it('키 메뉴는 접지 않고 position도 그대로 지킨다', () => {
    store.keyMenuItems = [item('below'), item('above', { position: 'top' })];
    mount();

    expect(captured.key.map((entry) => entry.id)).toEqual([
      'demo:above',
      'delete',
      'duplicate',
      'counterReset',
      'bringToFront',
      'sendToBack',
      'demo:below',
    ]);
    expect(captured.key.some((entry) => entry.id === PLUGIN_GROUP_ID)).toBe(
      false,
    );
  });

  it('5개 로케일 모두 묶음 라벨을 갖는다', () => {
    mount();
    const locales = {
      en,
      ko,
      ru,
      'zh-Hant': zhHant,
      'zh-cn': zhCn,
    } as unknown as Record<
      string,
      { contextMenu: Record<string, string | undefined> }
    >;
    Object.entries(locales).forEach(([name, messages]) => {
      expect(messages.contextMenu.plugins, name).toBeTruthy();
    });
  });
});
