import { create } from 'zustand';
import type { CustomTab, KeyMappings } from '@src/types/key/keys';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import { setKeyMode } from '@api/modules/keyModeApi';
import { clampBarCount, MAX_BAR_SLOTS } from '@utils/tabOrder';

type CanonicalKeyPositions = CanonicalEditorDocumentV1['keyPositions'];

interface KeyStoreState {
  selectedKeyType: string;
  customTabs: CustomTab[];
  // 내장 모드 + 커스텀 탭의 표시 순서. 툴바 바는 앞 barCount개, 팝업은 나머지를 그린다
  tabOrder: string[];
  // 바에 몇 개를 내놓을지. 1~4
  barCount: number;
  /** 아직 응답이 안 온 순서 변경 수. 그동안은 낙관 순서가 서버 스냅샷보다 새롭다 */
  pendingTabPlacements: number;
  /** 순서 변경이 도는 동안 흘려보낸 권위 순서. 응답이 이걸 덮지 못하고 끝나면 되살린다 */
  deferredTabPlacement: { tabOrder: string[]; barCount: number } | null;
  /**
   * 권위 탭 메타데이터를 받을 때마다 오르는 세대
   *
   * 커맨드 응답의 스냅샷은 "지금"이 아니라 그 트랜잭션이 커밋된 시점 값이다.
   * 요청을 띄운 뒤 세대가 올랐으면 그 응답은 과거이므로 통째로 버린다
   */
  tabMetadataGeneration: number;
  /**
   * 선택 모드를 권위 있게 바꾼 횟수
   *
   * 순서와 세대를 따로 두는 이유가 있다. `keys:mode-changed`는 선택만 바꾸고 순서는
   * 안 건드리므로, 이걸 순서 세대에 합치면 탭을 전환하는 것만으로 순서 변경 응답의
   * 보정까지 버려진다
   */
  selectionGeneration: number;
  keyMappings: KeyMappings;
  // 렌더 상태 = canonical + 활성 프리뷰 합성
  positions: CanonicalKeyPositions;
  // 권위 상태, 프리뷰 불가침 (커밋·flush·히스토리 캡처 기준)
  canonicalPositions: CanonicalKeyPositions;
  isBootstrapped: boolean;
  // 삭제 작업 중 백엔드 이벤트 무시용 플래그
  isLocalUpdateInProgress: boolean;
  setSelectedKeyType: (mode: string) => void;
  setCustomTabs: (tabs: CustomTab[]) => void;
  setTabOrder: (order: string[]) => void;
  setTabPlacement: (order: string[], barCount: number) => void;
  beginTabPlacementMutation: () => void;
  endTabPlacementMutation: () => void;
  /**
   * customTabs:changed가 실어 온 권위 스냅샷을 받는다.
   * 순서 필드만 진행 중인 낙관 변경에 양보하고, 양보한 값은 버리지 않고 붙들어 둔다
   */
  adoptTabMetadataEvent: (event: {
    customTabs: CustomTab[];
    tabOrder: string[];
    barCount: number;
    selectedKeyType: string;
  }) => void;
  /**
   * 선택 모드를 기록하는 유일한 창구
   *
   * 권위 이벤트든 사용자의 즉시 선택이든 전부 여기를 지난다. 한 군데라도 빠지면
   * 대기 중이던 삭제·초기화 응답이 같은 세대로 판단해 이 선택을 되돌린다
   */
  commitSelectedKeyType: (selectedKeyType: string) => void;
  /**
   * 커맨드 응답의 스냅샷을 적용한다.
   *
   * 요청을 띄우기 전에 읽어둔 세대를 함께 넘겨야 한다 - 그 사이 권위 이벤트를
   * 하나라도 들었으면 이 스냅샷은 과거다.
   *
   * 선택 모드는 일부러 안 받는다. reorder도 rename도 선택을 바꾸지 않고,
   * 선택은 keys:mode-changed가 소유한다. 여기서 같이 쓰면 과거 응답이
   * 최신 선택을 되돌리는 길만 하나 더 생긴다
   */
  setTabMetadata: (
    metadata: { customTabs: CustomTab[]; tabOrder: string[]; barCount: number },
    observedGeneration: number,
  ) => void;
  setKeyMappings: (mappings: KeyMappings) => void;
  setPositions: (positions: CanonicalKeyPositions) => void;
  setBootstrapped: (value: boolean) => void;
  setKeyMappingsAndPositions: (
    mappings: KeyMappings,
    positions: CanonicalKeyPositions,
  ) => void;
  setLocalUpdateInProgress: (value: boolean) => void;
}

// 프리뷰 오버레이 모듈이 등록하는 rendered 합성기, 없으면 canonical 그대로
type RenderedPositionsComposer = (
  canonical: CanonicalKeyPositions,
) => CanonicalKeyPositions;
let renderedComposer: RenderedPositionsComposer | null = null;

export const registerRenderedPositionsComposer = (
  composer: RenderedPositionsComposer | null,
) => {
  renderedComposer = composer;
};

export const composeRenderedPositions = (canonical: CanonicalKeyPositions) =>
  renderedComposer ? renderedComposer(canonical) : canonical;

let modeRequestGeneration = 0;

export const useKeyStore = create<KeyStoreState>((set, get) => ({
  selectedKeyType: '4key',
  customTabs: [],
  tabOrder: [],
  barCount: MAX_BAR_SLOTS,
  pendingTabPlacements: 0,
  deferredTabPlacement: null,
  tabMetadataGeneration: 0,
  selectionGeneration: 0,
  keyMappings: {} as KeyMappings,
  positions: {},
  canonicalPositions: {},
  isBootstrapped: false,
  isLocalUpdateInProgress: false,
  setSelectedKeyType: (mode) => {
    get().commitSelectedKeyType(mode);
    if (
      !get().isBootstrapped ||
      typeof window === 'undefined' ||
      window.__dmn_runtime === 'obs'
    ) {
      return;
    }

    const generation = ++modeRequestGeneration;
    void setKeyMode(mode)
      .then((response) => {
        if (
          generation !== modeRequestGeneration ||
          get().selectedKeyType !== mode
        ) {
          return;
        }
        if (!response.success || response.mode !== mode) {
          get().commitSelectedKeyType(response.mode);
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
            get().commitSelectedKeyType(authoritative.selectedKeyType);
          }
        } catch (bootstrapError) {
          console.error('Failed to reconcile key mode', bootstrapError);
        }
      });
  },
  setCustomTabs: (tabs) => set({ customTabs: tabs }),
  setTabOrder: (order) => set({ tabOrder: order }),
  setTabPlacement: (order, barCount) =>
    set({ tabOrder: order, barCount: clampBarCount(barCount, order.length) }),
  beginTabPlacementMutation: () =>
    set((state) => ({ pendingTabPlacements: state.pendingTabPlacements + 1 })),
  endTabPlacementMutation: () =>
    set((state) => {
      const pendingTabPlacements = Math.max(0, state.pendingTabPlacements - 1);
      // 응답이 권위 스냅샷을 실어 왔으면 deferred는 이미 지워졌다. 남아 있다는 건
      // 마지막 요청이 스냅샷 없이 끝났다는 뜻이고, 그러면 흘려보낸 쪽이 진실이다
      if (pendingTabPlacements > 0 || !state.deferredTabPlacement) {
        return { pendingTabPlacements };
      }
      const { tabOrder, barCount } = state.deferredTabPlacement;
      return {
        pendingTabPlacements,
        deferredTabPlacement: null,
        tabOrder,
        barCount: clampBarCount(barCount, tabOrder.length),
      };
    }),
  adoptTabMetadataEvent: ({
    customTabs,
    tabOrder,
    barCount,
    selectedKeyType,
  }) =>
    set((state) => {
      const tabMetadataGeneration = state.tabMetadataGeneration + 1;
      // 이 이벤트는 선택도 싣고 온다
      const selectionGeneration = state.selectionGeneration + 1;
      // 이 창이 방금 놓은 순서가 아직 응답을 기다리는 중이면 그쪽이 더 새롭다.
      // 앞선 변경의 스냅샷을 그대로 받으면 칩이 한 번 튀었다 돌아오고,
      // 그 사이에 또 놓으면 낡은 순서 위에서 계산돼 방금 한 교체가 사라진다.
      // 버리지는 않는다 - 프리셋이나 다른 창의 undo가 실려 있을 수 있다
      return state.pendingTabPlacements > 0
        ? {
            tabMetadataGeneration,
            selectionGeneration,
            customTabs,
            selectedKeyType,
            deferredTabPlacement: { tabOrder, barCount },
          }
        : {
            tabMetadataGeneration,
            selectionGeneration,
            customTabs,
            selectedKeyType,
            tabOrder,
            barCount: clampBarCount(barCount, tabOrder.length),
            deferredTabPlacement: null,
          };
    }),
  commitSelectedKeyType: (selectedKeyType) =>
    set((state) => ({
      selectedKeyType,
      selectionGeneration: state.selectionGeneration + 1,
    })),
  setTabMetadata: ({ customTabs, tabOrder, barCount }, observedGeneration) =>
    set((state) => {
      // 필드별로 갈라 받으면 안 된다. 순서만 최신이고 탭 목록은 과거가 되어
      // tabOrder에는 있는데 customTabs에 없는 탭이 화면에서 사라진다.
      // 스냅샷은 통째로 채택하거나 통째로 버린다
      if (observedGeneration !== state.tabMetadataGeneration) return state;
      return {
        customTabs,
        tabOrder,
        barCount: clampBarCount(barCount, tabOrder.length),
      };
    }),
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
