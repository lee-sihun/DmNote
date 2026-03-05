import { create } from 'zustand';
import type {
  PluginMenuItem,
  PluginMenuItemInternal,
  KeyMenuContext,
  GridMenuContext,
} from '@src/types/api';

interface PluginMenuState {
  keyMenuItems: PluginMenuItemInternal<KeyMenuContext>[];
  gridMenuItems: PluginMenuItemInternal<GridMenuContext>[];

  addKeyMenuItem: (item: PluginMenuItem<KeyMenuContext>) => string;
  addGridMenuItem: (item: PluginMenuItem<GridMenuContext>) => string;
  removeMenuItem: (fullId: string) => void;
  updateMenuItem: (
    fullId: string,
    updates: Partial<PluginMenuItem<any>>,
  ) => void;
  clearByPluginId: (pluginId: string) => void;
  clearAll: () => void;
}

export const usePluginMenuStore = create<PluginMenuState>((set, _get) => ({
  keyMenuItems: [],
  gridMenuItems: [],

  addKeyMenuItem: (item) => {
    const pluginId = (window as any).__dmn_current_plugin_id || 'unknown';
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
    const pluginId = (window as any).__dmn_current_plugin_id || 'unknown';
    const fullId = `${pluginId}:${item.id}`;

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

  updateMenuItem: (fullId, updates) =>
    set((state) => ({
      keyMenuItems: state.keyMenuItems.map((item) =>
        item.fullId === fullId ? { ...item, ...updates } : item,
      ),
      gridMenuItems: state.gridMenuItems.map((item) =>
        item.fullId === fullId ? { ...item, ...updates } : item,
      ),
    })),

  clearByPluginId: (pluginId) =>
    set((state) => ({
      keyMenuItems: state.keyMenuItems.filter(
        (item) => item.pluginId !== pluginId,
      ),
      gridMenuItems: state.gridMenuItems.filter(
        (item) => item.pluginId !== pluginId,
      ),
    })),

  clearAll: () =>
    set({
      keyMenuItems: [],
      gridMenuItems: [],
    }),
}));
