import { create } from "zustand";
import type { LayerGroups, LayerGroupDef } from "@src/types/layerGroups";

interface LayerGroupStoreState {
  /** Per-mode layer group definitions (persisted via backend) */
  layerGroups: LayerGroups;
  /** UI-only collapsed state: Set of group IDs that are collapsed */
  collapsedGroups: Set<string>;

  // Setters
  setLayerGroups: (groups: LayerGroups) => void;

  // Group CRUD operations
  addGroup: (mode: string, group: LayerGroupDef) => LayerGroups;
  removeGroup: (mode: string, groupId: string) => LayerGroups;
  renameGroup: (mode: string, groupId: string, newName: string) => LayerGroups;

  // Collapse/expand (UI only)
  toggleCollapsed: (groupId: string) => void;
  setCollapsed: (groupId: string, collapsed: boolean) => void;

  // Helpers
  getGroupsForMode: (mode: string) => LayerGroupDef[];
  getGroupById: (mode: string, groupId: string) => LayerGroupDef | undefined;
}

export const useLayerGroupStore = create<LayerGroupStoreState>((set, get) => ({
  layerGroups: {},
  collapsedGroups: new Set(),

  setLayerGroups: (groups) =>
    set((state) => {
      const validGroupIds = new Set<string>();
      Object.values(groups).forEach((modeGroups) => {
        modeGroups.forEach((group) => validGroupIds.add(group.id));
      });
      const collapsedGroups = new Set(
        Array.from(state.collapsedGroups).filter((id) => validGroupIds.has(id))
      );
      return { layerGroups: groups, collapsedGroups };
    }),

  addGroup: (mode, group) => {
    const current = get().layerGroups;
    const modeGroups = current[mode] || [];
    const updated: LayerGroups = {
      ...current,
      [mode]: [...modeGroups, group],
    };
    set({ layerGroups: updated });
    return updated;
  },

  removeGroup: (mode, groupId) => {
    const current = get().layerGroups;
    const modeGroups = current[mode] || [];
    const updated: LayerGroups = {
      ...current,
      [mode]: modeGroups.filter((g) => g.id !== groupId),
    };
    set({ layerGroups: updated });
    // Also remove from collapsed
    const collapsed = new Set(get().collapsedGroups);
    collapsed.delete(groupId);
    set({ collapsedGroups: collapsed });
    return updated;
  },

  renameGroup: (mode, groupId, newName) => {
    const current = get().layerGroups;
    const modeGroups = current[mode] || [];
    const updated: LayerGroups = {
      ...current,
      [mode]: modeGroups.map((g) =>
        g.id === groupId ? { ...g, name: newName } : g
      ),
    };
    set({ layerGroups: updated });
    return updated;
  },

  toggleCollapsed: (groupId) => {
    const collapsed = new Set(get().collapsedGroups);
    if (collapsed.has(groupId)) {
      collapsed.delete(groupId);
    } else {
      collapsed.add(groupId);
    }
    set({ collapsedGroups: collapsed });
  },

  setCollapsed: (groupId, collapsed) => {
    const current = new Set(get().collapsedGroups);
    if (collapsed) {
      current.add(groupId);
    } else {
      current.delete(groupId);
    }
    set({ collapsedGroups: current });
  },

  getGroupsForMode: (mode) => {
    return get().layerGroups[mode] || [];
  },

  getGroupById: (mode, groupId) => {
    const groups = get().layerGroups[mode] || [];
    return groups.find((g) => g.id === groupId);
  },
}));
