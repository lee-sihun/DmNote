import { create } from 'zustand';
import type { PluginSettingsDefinition } from '@src/types/plugin/api';
import {
  LAYER_PANEL_TABS,
  type LayerPanelTabType,
} from '@components/main/Grid/PropertiesPanel/types';

export type PluginSettingsPanelPayload = {
  pluginId: string;
  definition: PluginSettingsDefinition;
  settings: Record<string, unknown>;
  originalSettings: Record<string, unknown>;
  onChange: (nextSettings: Record<string, unknown>) => void;
  onConfirm: (
    nextSettings: Record<string, unknown>,
    originalSettings: Record<string, unknown>,
  ) => void | Promise<void>;
  onCancel: (originalSettings: Record<string, unknown>) => void;
  resolve: (confirmed: boolean) => void;
};

export type CanvasPanelMode = 'layer' | 'property';

interface PropertiesPanelState {
  pluginSettingsPanel: PluginSettingsPanelPayload | null;
  openPluginSettingsPanel: (payload: PluginSettingsPanelPayload) => void;
  closePluginSettingsPanel: () => void;

  // 캔버스 패널 (레이어 패널) 탭 상태
  canvasPanelActiveTab: LayerPanelTabType;
  setCanvasPanelActiveTab: (tab: LayerPanelTabType) => void;

  // 캔버스 사이드 패널(속성 패널) 열림 상태
  isCanvasPanelOpen: boolean;
  setCanvasPanelOpen: (value: boolean) => void;

  // 패널 모드 — 설정 화면 왕복으로 패널이 리마운트돼도 열림 상태와 함께 보존
  canvasPanelMode: CanvasPanelMode;
  setCanvasPanelMode: (mode: CanvasPanelMode) => void;

  // 외부(단축키 등)에서 토글 요청을 보내기 위한 시그널
  canvasPanelToggleSignal: number;
  requestCanvasPanelToggle: () => void;

  // 레이어 이름 변경 요청 시그널 (캔버스 컨텍스트 메뉴에서 트리거)
  renameRequestSignal: number;
  requestRename: () => void;
}

export const usePropertiesPanelStore = create<PropertiesPanelState>(
  (set, get) => ({
    pluginSettingsPanel: null,
    openPluginSettingsPanel: (payload) => {
      const existing = get().pluginSettingsPanel;
      if (existing) {
        try {
          existing.onCancel(existing.originalSettings);
        } catch (error) {
          console.error('[Plugin Settings] Failed to cancel settings:', error);
        } finally {
          existing.resolve(false);
        }
      }
      set({ pluginSettingsPanel: payload });
    },
    closePluginSettingsPanel: () => set({ pluginSettingsPanel: null }),

    // 캔버스 패널 탭 상태
    canvasPanelActiveTab: LAYER_PANEL_TABS.LAYER,
    setCanvasPanelActiveTab: (tab) => set({ canvasPanelActiveTab: tab }),

    isCanvasPanelOpen: false,
    setCanvasPanelOpen: (value) => set({ isCanvasPanelOpen: value }),

    canvasPanelMode: 'property',
    setCanvasPanelMode: (mode) => set({ canvasPanelMode: mode }),

    canvasPanelToggleSignal: 0,
    requestCanvasPanelToggle: () =>
      set((state) => ({
        canvasPanelToggleSignal: state.canvasPanelToggleSignal + 1,
      })),

    renameRequestSignal: 0,
    requestRename: () =>
      set((state) => ({ renameRequestSignal: state.renameRequestSignal + 1 })),
  }),
);
