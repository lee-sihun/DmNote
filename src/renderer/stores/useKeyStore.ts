import { create } from 'zustand';
import type { CustomTab, KeyMappings, KeyPositions } from '@src/types/keys';

interface KeyStoreState {
  selectedKeyType: string;
  customTabs: CustomTab[];
  keyMappings: KeyMappings;
  positions: KeyPositions;
  isBootstrapped: boolean;
  // 삭제 작업 중 백엔드 이벤트 무시용 플래그
  isLocalUpdateInProgress: boolean;
  setSelectedKeyType: (mode: string) => void;
  setCustomTabs: (tabs: CustomTab[]) => void;
  setKeyMappings: (mappings: KeyMappings) => void;
  setPositions: (positions: KeyPositions) => void;
  setBootstrapped: (value: boolean) => void;
  setKeyMappingsAndPositions: (
    mappings: KeyMappings,
    positions: KeyPositions,
  ) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

export const useKeyStore = create<KeyStoreState>((set, get) => ({
  selectedKeyType: '4key',
  customTabs: [],
  keyMappings: {} as KeyMappings,
  positions: {} as KeyPositions,
  isBootstrapped: false,
  isLocalUpdateInProgress: false,
  setSelectedKeyType: (mode) => {
    set({ selectedKeyType: mode });
    if (get().isBootstrapped && typeof window !== 'undefined') {
      window.api.keys.setMode(mode).catch((error) => {
        console.error('Failed to set key mode', error);
      });
    }
  },
  setCustomTabs: (tabs) => set({ customTabs: tabs }),
  setKeyMappings: (mappings) => set({ keyMappings: mappings }),
  setPositions: (positions) => set({ positions }),
  setBootstrapped: (value) => set({ isBootstrapped: value }),
  // 일괄 업데이트 (키 삭제 등에서 atomic 업데이트 필요)
  setKeyMappingsAndPositions: (mappings, positions) =>
    set({ keyMappings: mappings, positions }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
