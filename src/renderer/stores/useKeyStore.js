import { create } from "zustand";

export const useKeyStore = create((set, get) => ({
  selectedKeyType: "4key",
  customTabs: [], // [{ id, name }]

  loadInitialSelection: async () => {
    try {
      const selected = await window.electron.ipcRenderer.invoke(
        "get-selected-key-type"
      );
      if (selected) set({ selectedKeyType: selected });
      const tabs = await window.electron.ipcRenderer.invoke("custom-tabs:list");
      if (Array.isArray(tabs)) set({ customTabs: tabs });
    } catch {}
  },

  setSelectedKeyType: async (keyType) => {
    set({ selectedKeyType: keyType });
    try {
      await window.electron.ipcRenderer.invoke("custom-tabs:select", keyType);
      // Grid.jsx 가 별도로 setKeyMode IPC를 보냄. 여기서는 저장만.
    } catch {}
  },

  refreshCustomTabs: async () => {
    try {
      const tabs = await window.electron.ipcRenderer.invoke("custom-tabs:list");
      if (Array.isArray(tabs)) set({ customTabs: tabs });
    } catch {}
  },

  addCustomTab: async (name) => {
    const res = await window.electron.ipcRenderer.invoke(
      "custom-tabs:create",
      name
    );
    if (res && !res.error) {
      const tabs = await window.electron.ipcRenderer.invoke("custom-tabs:list");
      set({ customTabs: tabs, selectedKeyType: res.id });
      return res;
    }
    return res;
  },

  deleteSelectedCustomTab: async () => {
    const { selectedKeyType } = get();
    const res = await window.electron.ipcRenderer.invoke(
      "custom-tabs:delete",
      selectedKeyType
    );
    if (res && !res.error) {
      const tabs = await window.electron.ipcRenderer.invoke("custom-tabs:list");
      const nextSelected = await window.electron.ipcRenderer.invoke(
        "get-selected-key-type"
      );
      set({ customTabs: tabs, selectedKeyType: nextSelected });
    }
    return res;
  },
}));
