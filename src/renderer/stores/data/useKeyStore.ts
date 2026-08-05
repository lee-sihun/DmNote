import { create } from 'zustand';
import type { CustomTab, KeyMappings, KeyPositions } from '@src/types/key/keys';

interface KeyStoreState {
  selectedKeyType: string;
  customTabs: CustomTab[];
  keyMappings: KeyMappings;
  // 렌더 상태 = canonical + 활성 프리뷰 합성
  positions: KeyPositions;
  // 권위 상태, 프리뷰 불가침 (커밋·flush·히스토리 캡처 기준)
  canonicalPositions: KeyPositions;
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

// 프리뷰 오버레이 모듈이 등록하는 rendered 합성기, 없으면 canonical 그대로
type RenderedPositionsComposer = (canonical: KeyPositions) => KeyPositions;
let renderedComposer: RenderedPositionsComposer | null = null;

export const registerRenderedPositionsComposer = (
  composer: RenderedPositionsComposer | null,
) => {
  renderedComposer = composer;
};

export const composeRenderedPositions = (canonical: KeyPositions) =>
  renderedComposer ? renderedComposer(canonical) : canonical;

let modeRequestGeneration = 0;

export const useKeyStore = create<KeyStoreState>((set, get) => ({
  selectedKeyType: '4key',
  customTabs: [],
  keyMappings: {} as KeyMappings,
  positions: {} as KeyPositions,
  canonicalPositions: {} as KeyPositions,
  isBootstrapped: false,
  isLocalUpdateInProgress: false,
  setSelectedKeyType: (mode) => {
    set({ selectedKeyType: mode });
    if (
      !get().isBootstrapped ||
      typeof window === 'undefined' ||
      window.__dmn_runtime === 'obs'
    ) {
      return;
    }

    const generation = ++modeRequestGeneration;
    void window.api.keys
      .setMode(mode)
      .then((response) => {
        if (
          generation !== modeRequestGeneration ||
          get().selectedKeyType !== mode
        ) {
          return;
        }
        if (!response.success || response.mode !== mode) {
          set({ selectedKeyType: response.mode });
        }
      })
      .catch(async (error) => {
        console.error('Failed to set key mode', error);
        try {
          const authoritative = await window.api.app.bootstrap();
          if (
            generation === modeRequestGeneration &&
            get().selectedKeyType === mode
          ) {
            set({ selectedKeyType: authoritative.selectedKeyType });
          }
        } catch (bootstrapError) {
          console.error('Failed to reconcile key mode', bootstrapError);
        }
      });
  },
  setCustomTabs: (tabs) => set({ customTabs: tabs }),
  setKeyMappings: (mappings) => set({ keyMappings: mappings }),
  // canonical 편집 경로, 활성 프리뷰가 있으면 rendered에 재합성
  setPositions: (positions) =>
    set({
      canonicalPositions: positions,
      positions: composeRenderedPositions(positions),
    }),
  setBootstrapped: (value) => set({ isBootstrapped: value }),
  // 일괄 업데이트 (키 삭제 등에서 atomic 업데이트 필요)
  setKeyMappingsAndPositions: (mappings, positions) =>
    set({
      keyMappings: mappings,
      canonicalPositions: positions,
      positions: composeRenderedPositions(positions),
    }),
  setLocalUpdateInProgress: (value) => set({ isLocalUpdateInProgress: value }),
}));
