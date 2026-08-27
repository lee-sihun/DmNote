import { create } from 'zustand';
import type {
  PluginMenuItem,
  PluginMenuItemInternal,
  KeyMenuContext,
  GridMenuContext,
} from '@src/types/plugin/api';

interface PluginMenuState {
  keyMenuItems: PluginMenuItemInternal<KeyMenuContext>[];
  gridMenuItems: PluginMenuItemInternal<GridMenuContext>[];

  addKeyMenuItem: (item: PluginMenuItem<KeyMenuContext>) => string;
  addGridMenuItem: (item: PluginMenuItem<GridMenuContext>) => string;
  removeMenuItem: (fullId: string) => void;
  updateMenuItem: (
    fullId: string,
    updates: Partial<PluginMenuItem<unknown>>,
  ) => void;
  clearByPluginId: (pluginId: string) => void;
  clearAll: () => void;
}

// 빈 바닥 메뉴의 플러그인 항목은 묶음 서브메뉴로 들어가므로 position이 자리를 정하지 못한다.
// 조용히 무시하면 작성자가 원인을 못 찾으니 플러그인마다 한 번 알린다
const gridPositionWarned = new Set<string>();
const warnIgnoredGridPosition = (pluginId: string) => {
  if (gridPositionWarned.has(pluginId)) return;
  gridPositionWarned.add(pluginId);
  console.warn(
    `[Plugin ${pluginId}] "position" is ignored for grid menu items - they are grouped into a submenu`,
  );
};

export const usePluginMenuStore = create<PluginMenuState>((set, get) => ({
  keyMenuItems: [],
  gridMenuItems: [],

  addKeyMenuItem: (item) => {
    // 'unknown' 폴백은 방어망 - 컨텍스트 없는 등록은 uiApi가 거부한다
    const pluginId = window.__dmn_current_plugin_id || 'unknown';
    const fullId = `${pluginId}:${item.id}`;

    // 중복 제거 (같은 fullId가 있으면 교체)
    set((state) => ({
      keyMenuItems: [
        ...state.keyMenuItems.filter((i) => i.fullId !== fullId),
        {
          ...item,
          pluginId,
          fullId,
        },
      ],
    }));

    return fullId;
  },

  addGridMenuItem: (item) => {
    const pluginId = window.__dmn_current_plugin_id || 'unknown';
    const fullId = `${pluginId}:${item.id}`;
    if (item.position !== undefined) warnIgnoredGridPosition(pluginId);

    // 중복 제거 (같은 fullId가 있으면 교체)
    set((state) => ({
      gridMenuItems: [
        ...state.gridMenuItems.filter((i) => i.fullId !== fullId),
        {
          ...item,
          pluginId,
          fullId,
        },
      ],
    }));

    return fullId;
  },

  removeMenuItem: (fullId) =>
    set((state) => ({
      keyMenuItems: state.keyMenuItems.filter((item) => item.fullId !== fullId),
      gridMenuItems: state.gridMenuItems.filter(
        (item) => item.fullId !== fullId,
      ),
    })),

  updateMenuItem: (fullId, updates) => {
    if (updates.position !== undefined) {
      const target = get().gridMenuItems.find((item) => item.fullId === fullId);
      if (target) warnIgnoredGridPosition(target.pluginId);
    }
    set((state) => ({
      keyMenuItems: state.keyMenuItems.map((item) =>
        item.fullId === fullId ? { ...item, ...updates } : item,
      ),
      gridMenuItems: state.gridMenuItems.map((item) =>
        item.fullId === fullId ? { ...item, ...updates } : item,
      ),
    }));
  },

  clearByPluginId: (pluginId) => {
    // 리로드한 플러그인이 같은 실수를 반복하면 다시 알려야 한다
    gridPositionWarned.delete(pluginId);
    set((state) => ({
      keyMenuItems: state.keyMenuItems.filter(
        (item) => item.pluginId !== pluginId,
      ),
      gridMenuItems: state.gridMenuItems.filter(
        (item) => item.pluginId !== pluginId,
      ),
    }));
  },

  clearAll: () => {
    gridPositionWarned.clear();
    set({
      keyMenuItems: [],
      gridMenuItems: [],
    });
  },
}));
