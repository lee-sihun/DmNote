import { create } from 'zustand';
import {
  PluginDisplayElementInternal,
  PluginDefinitionInternal,
  PluginDefinitionView,
  PluginPanelElementView,
} from '@src/types/plugin/api';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { schedulePluginPanelModelSync } from '@utils/plugin/panelModelSync';
import {
  registerLoadedPluginIdsProvider,
  registerPluginGroupMemberProvider,
} from '@src/renderer/editor/runtime/pluginGroupMembers';
import { useKeyStore } from '../data/useKeyStore';

// syncToOverlay 쓰로틀링을 위한 변수
let syncScheduled = false;
let pendingElements: PluginDisplayElementInternal[] | null = null;
const SYNC_THROTTLE_MS = 16; // ~60fps

// rAF 기반 state 배치 업데이트를 위한 변수
let rafScheduled = false;
const pendingStateUpdates: Map<
  string,
  Partial<PluginDisplayElementInternal>
> = new Map();

type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * 두 바운딩 박스가 겹치는지 확인
 */
function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

interface PluginDisplayElementStore {
  elements: PluginDisplayElementInternal[];
  panelElements: PluginPanelElementView[];
  definitions: Map<string, PluginDefinitionInternal>;
  /** 패널 창 전용 - main이 push한 definition 투영 미러 (main·overlay에선 비어 있음) */
  definitionViews: Map<string, PluginDefinitionView>;
  /** 패널 창 전용 - fullId → key별 visibility 미러 (main이 요소별 settings로 평가) */
  elementVisibilityViews: Map<string, Record<string, boolean>>;
  addElement: (element: PluginDisplayElementInternal) => void;
  updateElement: (
    fullId: string,
    updates: Partial<PluginDisplayElementInternal>,
    options?: { skipSync?: boolean },
  ) => void;
  updateElementBatched: (
    fullId: string,
    updates: Partial<PluginDisplayElementInternal>,
  ) => void;
  removeElement: (fullId: string) => void;
  clearByPluginId: (pluginId: string) => void;
  setElements: (
    elements: PluginDisplayElementInternal[],
    options?: { skipSync?: boolean },
  ) => void;
  registerDefinition: (definition: PluginDefinitionInternal) => void;
  /** 패널 창 전용 - main push 스냅샷을 읽기 미러로 반영 (동기화 발신 없음) */
  applyPanelModel: (
    elements: PluginPanelElementView[],
    definitionViews: PluginDefinitionView[],
    elementVisibility: Record<string, Record<string, boolean>>,
  ) => void;
  // z-order 관련 함수들
  bringToFront: (fullId: string) => void;
  sendToBack: (fullId: string) => void;
  bringForward: (fullId: string) => void;
  sendBackward: (fullId: string) => void;
}

export const usePluginDisplayElementStore = create<PluginDisplayElementStore>(
  (set) => ({
    elements: [],
    panelElements: [],
    definitions: new Map(),
    definitionViews: new Map(),
    elementVisibilityViews: new Map(),

    addElement: (element) =>
      set((state) => {
        const newElements = [...state.elements, element];
        // 메인 윈도우에서만 오버레이로 동기화
        if (window.__dmn_window_type === 'main') {
          syncToOverlayThrottled(newElements);
        }
        return { elements: newElements };
      }),

    updateElement: (fullId, updates, options?: { skipSync?: boolean }) =>
      set((state) => {
        const newElements = state.elements.map((el) =>
          el.fullId === fullId ? { ...el, ...updates } : el,
        );
        // 메인 윈도우에서만 오버레이로 동기화
        // state만 변경된 경우 동기화 스킵 (오버레이에서 자체 관리)
        // skipSync 옵션이 true인 경우 동기화 스킵 (리사이즈 중 등)
        if (window.__dmn_window_type === 'main' && !options?.skipSync) {
          const updateKeys = Object.keys(updates);
          const isStateOnlyUpdate =
            updateKeys.length === 1 && updateKeys[0] === 'state';
          if (!isStateOnlyUpdate) {
            syncToOverlayThrottled(newElements);
          }
        }
        return { elements: newElements };
      }),

    // rAF 기반 배치 업데이트 (state 업데이트 최적화용)
    updateElementBatched: (fullId, updates) => {
      // 기존 pending 업데이트와 병합
      const existing = pendingStateUpdates.get(fullId) || {};
      pendingStateUpdates.set(fullId, { ...existing, ...updates });

      if (rafScheduled) return;

      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;

        if (pendingStateUpdates.size === 0) return;

        const updates = new Map(pendingStateUpdates);
        pendingStateUpdates.clear();

        usePluginDisplayElementStore.setState((state) => {
          const newElements = state.elements.map((el) => {
            const pending = updates.get(el.fullId);
            if (pending) {
              return { ...el, ...pending };
            }
            return el;
          });
          return { elements: newElements };
        });
      });
    },

    removeElement: (fullId) =>
      set((state) => {
        const newElements = state.elements.filter((el) => el.fullId !== fullId);
        // 메인 윈도우에서만 오버레이로 동기화
        if (window.__dmn_window_type === 'main') {
          syncToOverlayThrottled(newElements);
        }
        return { elements: newElements };
      }),

    clearByPluginId: (pluginId) =>
      set((state) => {
        const newElements = state.elements.filter(
          (el) => el.pluginId !== pluginId,
        );
        const newDefinitions = new Map(state.definitions);
        for (const [id, def] of newDefinitions.entries()) {
          if (def.pluginId === pluginId) {
            newDefinitions.delete(id);
          }
        }
        // 메인 윈도우에서만 오버레이로 동기화
        if (window.__dmn_window_type === 'main') {
          syncToOverlayThrottled(newElements);
        }
        return { elements: newElements, definitions: newDefinitions };
      }),

    setElements: (elements, options?: { skipSync?: boolean }) =>
      set(() => {
        // 메인 윈도우에서만 오버레이로 동기화
        // skipSync 옵션이 true인 경우 동기화 스킵 (드래그 중 등)
        if (window.__dmn_window_type === 'main' && !options?.skipSync) {
          syncToOverlayThrottled(elements);
        }
        return { elements };
      }),

    registerDefinition: (definition) =>
      set((state) => {
        const newDefinitions = new Map(state.definitions);
        newDefinitions.set(definition.id, definition);
        // definitions 변경도 elements 스냅샷과 함께 패널 미러로 push
        if (window.__dmn_window_type === 'main') {
          schedulePluginPanelModelSync(state.elements, newDefinitions);
        }
        return { definitions: newDefinitions };
      }),

    applyPanelModel: (elements, definitionViews, elementVisibility) =>
      set(() => ({
        panelElements: elements,
        definitionViews: new Map(
          definitionViews.map((view) => [view.definitionId, view]),
        ),
        elementVisibilityViews: new Map(Object.entries(elementVisibility)),
      })),

    // z-order: 맨 앞으로 (가장 높은 zIndex로 설정)
    bringToFront: (fullId) =>
      set((state) => {
        const element = state.elements.find((el) => el.fullId === fullId);
        if (!element) return state;

        // 현재 탭의 키들과 플러그인 요소들의 zIndex 수집
        const { selectedKeyType, canonicalPositions } = useKeyStore.getState();
        const keyPositions = canonicalPositions[selectedKeyType] || [];
        const keyZIndexes = keyPositions.map((p, i) => p.zIndex ?? i);
        const pluginZIndexes = state.elements.map((el) => el.zIndex ?? 0);
        const maxZIndex = Math.max(0, ...keyZIndexes, ...pluginZIndexes);

        const newElements = state.elements.map((el) =>
          el.fullId === fullId ? { ...el, zIndex: maxZIndex + 1 } : el,
        );

        if (window.__dmn_window_type === 'main') {
          syncToOverlayThrottled(newElements);
        }
        return { elements: newElements };
      }),

    // z-order: 맨 뒤로 (가장 낮은 zIndex로 설정)
    sendToBack: (fullId) =>
      set((state) => {
        const element = state.elements.find((el) => el.fullId === fullId);
        if (!element) return state;

        // 현재 탭의 키들과 플러그인 요소들의 zIndex 수집
        const { selectedKeyType, canonicalPositions } = useKeyStore.getState();
        const keyPositions = canonicalPositions[selectedKeyType] || [];
        const keyZIndexes = keyPositions.map((p, i) => p.zIndex ?? i);
        const pluginZIndexes = state.elements.map((el) => el.zIndex ?? 0);
        const minZIndex = Math.min(0, ...keyZIndexes, ...pluginZIndexes);

        const newElements = state.elements.map((el) =>
          el.fullId === fullId ? { ...el, zIndex: minZIndex - 1 } : el,
        );

        if (window.__dmn_window_type === 'main') {
          syncToOverlayThrottled(newElements);
        }
        return { elements: newElements };
      }),

    // z-order: 앞으로 (겹치는 요소들 중 바로 위 요소와 순서 교환)
    bringForward: (fullId) =>
      set((state) => {
        const element = state.elements.find((el) => el.fullId === fullId);
        if (!element) return state;

        const currentZIndex = element.zIndex ?? 0;
        const { selectedKeyType, canonicalPositions } = useKeyStore.getState();
        const keyPositions = canonicalPositions[selectedKeyType] || [];

        // 대상 요소의 바운딩 박스
        const targetBox = {
          x: element.position.x,
          y: element.position.y,
          width:
            element.measuredSize?.width ?? element.estimatedSize?.width ?? 100,
          height:
            element.measuredSize?.height ??
            element.estimatedSize?.height ??
            100,
        };

        // 겹치는 요소들의 zIndex 수집 (현재 요소보다 위에 있는 것만)
        const overlappingZIndexes: number[] = [];

        // 키들 중 겹치는 것
        keyPositions.forEach((p, i) => {
          const keyZ = p.zIndex ?? i;
          if (keyZ <= currentZIndex) return;

          const keyBox = { x: p.dx, y: p.dy, width: p.width, height: p.height };
          if (boxesOverlap(targetBox, keyBox)) {
            overlappingZIndexes.push(keyZ);
          }
        });

        // 다른 플러그인 요소들 중 겹치는 것
        state.elements.forEach((el) => {
          if (el.fullId === fullId) return;
          const elZ = el.zIndex ?? 0;
          if (elZ <= currentZIndex) return;

          const elBox = {
            x: el.position.x,
            y: el.position.y,
            width: el.measuredSize?.width ?? el.estimatedSize?.width ?? 100,
            height: el.measuredSize?.height ?? el.estimatedSize?.height ?? 100,
          };
          if (boxesOverlap(targetBox, elBox)) {
            overlappingZIndexes.push(elZ);
          }
        });

        // 겹치는 요소가 없으면 단순히 +1, 있으면 바로 위 요소보다 1 크게
        let newZIndex: number;
        if (overlappingZIndexes.length === 0) {
          newZIndex = currentZIndex + 1;
        } else {
          const minOverlappingZ = Math.min(...overlappingZIndexes);
          newZIndex = minOverlappingZ + 1;
        }

        const newElements = state.elements.map((el) =>
          el.fullId === fullId ? { ...el, zIndex: newZIndex } : el,
        );

        if (window.__dmn_window_type === 'main') {
          syncToOverlayThrottled(newElements);
        }
        return { elements: newElements };
      }),

    // z-order: 뒤로 (겹치는 요소들 중 바로 아래 요소와 순서 교환)
    sendBackward: (fullId) =>
      set((state) => {
        const element = state.elements.find((el) => el.fullId === fullId);
        if (!element) return state;

        const currentZIndex = element.zIndex ?? 0;
        const { selectedKeyType, canonicalPositions } = useKeyStore.getState();
        const keyPositions = canonicalPositions[selectedKeyType] || [];

        // 대상 요소의 바운딩 박스
        const targetBox = {
          x: element.position.x,
          y: element.position.y,
          width:
            element.measuredSize?.width ?? element.estimatedSize?.width ?? 100,
          height:
            element.measuredSize?.height ??
            element.estimatedSize?.height ??
            100,
        };

        // 겹치는 요소들의 zIndex 수집 (현재 요소보다 아래에 있는 것만)
        const overlappingZIndexes: number[] = [];

        // 키들 중 겹치는 것
        keyPositions.forEach((p, i) => {
          const keyZ = p.zIndex ?? i;
          if (keyZ >= currentZIndex) return;

          const keyBox = { x: p.dx, y: p.dy, width: p.width, height: p.height };
          if (boxesOverlap(targetBox, keyBox)) {
            overlappingZIndexes.push(keyZ);
          }
        });

        // 다른 플러그인 요소들 중 겹치는 것
        state.elements.forEach((el) => {
          if (el.fullId === fullId) return;
          const elZ = el.zIndex ?? 0;
          if (elZ >= currentZIndex) return;

          const elBox = {
            x: el.position.x,
            y: el.position.y,
            width: el.measuredSize?.width ?? el.estimatedSize?.width ?? 100,
            height: el.measuredSize?.height ?? el.estimatedSize?.height ?? 100,
          };
          if (boxesOverlap(targetBox, elBox)) {
            overlappingZIndexes.push(elZ);
          }
        });

        // 겹치는 요소가 없으면 단순히 -1, 있으면 바로 아래 요소보다 1 작게
        let newZIndex: number;
        if (overlappingZIndexes.length === 0) {
          newZIndex = currentZIndex - 1;
        } else {
          const maxOverlappingZ = Math.max(...overlappingZIndexes);
          newZIndex = maxOverlappingZ - 1;
        }

        const newElements = state.elements.map((el) =>
          el.fullId === fullId ? { ...el, zIndex: newZIndex } : el,
        );

        if (window.__dmn_window_type === 'main') {
          syncToOverlayThrottled(newElements);
        }
        return { elements: newElements };
      }),
  }),
);

export const selectPropertyPanelPluginElements = (
  state: PluginDisplayElementStore,
): PluginPanelElementView[] =>
  window.__dmn_window_type === 'panel' ? state.panelElements : state.elements;

// 메인 윈도우에서 오버레이로 동기화 (즉시 실행)
// 분리 패널 read-model 미러에도 동일 스냅샷 push (패널 창이 없으면 no-op)
function syncToOverlay(elements: PluginDisplayElementInternal[]) {
  sendBridgeMessageBestEffort('overlay', 'plugin:displayElements:sync', {
    elements,
  });
  schedulePluginPanelModelSync(
    elements,
    usePluginDisplayElementStore.getState().definitions,
  );
}

// 쓰로틀링된 동기화 (빈번한 호출 방지)
function syncToOverlayThrottled(elements: PluginDisplayElementInternal[]) {
  pendingElements = elements;

  if (syncScheduled) return;

  syncScheduled = true;
  setTimeout(() => {
    syncScheduled = false;
    if (pendingElements) {
      syncToOverlay(pendingElements);
      pendingElements = null;
    }
  }, SYNC_THROTTLE_MS);
}

// 그룹 normalize 재생의 플러그인 멤버 소스 등록 - coordinator가 store를
// 직접 import하면 순환 참조가 생기므로 여기서 주입한다
registerPluginGroupMemberProvider(
  () => usePluginDisplayElementStore.getState().elements,
);
// 로드 판별 - definitions에 등록된 플러그인은 런타임 요소가 그룹 멤버 원본이고
// (defineElement가 저장 인스턴스를 요소로 복원), 미등록 플러그인은 store 미러가 보충
registerLoadedPluginIdsProvider(
  () => new Set(usePluginDisplayElementStore.getState().definitions.keys()),
);
