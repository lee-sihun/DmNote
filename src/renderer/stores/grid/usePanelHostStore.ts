import { create } from 'zustand';

import { panelWindowApi } from '@api/modules/panelWindowApi';
import { flushFocusedEditor } from '@src/renderer/editor/runtime/lifecycleEditorFlush';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import {
  getPanelChildWindow,
  openPanelChildWindow,
} from '@utils/panelWindow/panelChildWindow';

// 프로퍼티 패널이 어디에 붙어 있는가. 패널 React 서브트리는 하나뿐이고 호스트 엘리먼트만
// 메인 문서(docked) ↔ 자식 창 문서(detached) 사이를 오간다 - PropertiesPanelHost가 이 값을 본다
export type PanelHostPlacement = 'docked' | 'detached';
export type PanelHostTransition = 'idle' | 'detaching' | 'docking';

interface PanelHostState {
  placement: PanelHostPlacement;
  transition: PanelHostTransition;
  setPlacement: (placement: PanelHostPlacement) => void;
  setTransition: (transition: PanelHostTransition) => void;
}

export const usePanelHostStore = create<PanelHostState>((set) => ({
  placement: 'docked',
  transition: 'idle',
  setPlacement: (placement) => set({ placement }),
  setTransition: (transition) => set({ transition }),
}));

export const isPanelDetached = (): boolean =>
  usePanelHostStore.getState().placement === 'detached';

// 선택 대상의 속성 보기로 전환 - 패널이 어디에 붙어 있든 같은 스토어를 본다
export const openPropertiesPanelForSelection = (): void => {
  const panel = usePropertiesPanelStore.getState();
  panel.setCanvasPanelMode('property');
  panel.setCanvasPanelOpen(true);
};

// 전환 결과. 호출부가 사용자에게 알릴지 결정한다 - 여기서 조용히 끝나면 버튼이 먹통으로 보인다
// busy: 이미 진행 중, blocked: 미확정 편집을 정산하지 못해 중단, failed: 창 전환 자체가 실패
export type TransitionOutcome = 'done' | 'busy' | 'blocked' | 'failed';

// 알림이 필요한 결과. busy는 진행 중인 전환이 곧 결론을 내므로 조용히 넘긴다
export const isTransitionFailure = (outcome: TransitionOutcome): boolean =>
  outcome === 'blocked' || outcome === 'failed';

// 호스트 이동은 React 커밋(layout effect)이 수행한다 - 창을 드러내기 전에 한 턴 양보
const yieldToRender = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// 문서를 옮기면 포커스가 풀리는데 blur 이벤트가 따라온다는 보장이 없다 -
// blur 전용 편집값을 옮기기 전에 확정한다
const settleEditsBeforeMove = async (): Promise<boolean> => {
  try {
    return await flushFocusedEditor();
  } catch (error) {
    console.error('패널 이동 전 편집 정산 실패', error);
    return false;
  }
};

/**
 * 패널 분리: 자식 창 확보(없으면 window.open) → 호스트 이동 → 창 드러내기
 * 실패 시 docked로 되돌린다
 */
export const detachPropertiesPanel = async (): Promise<TransitionOutcome> => {
  const store = usePanelHostStore.getState();
  if (store.transition !== 'idle') return 'busy';
  if (store.placement === 'detached') return 'done';
  store.setTransition('detaching');
  try {
    if (!(await settleEditsBeforeMove())) {
      console.error('Aborting panel detach: pending edit failed to commit');
      return 'blocked';
    }
    await openPanelChildWindow();
    usePanelHostStore.getState().setPlacement('detached');
    await yieldToRender();
    try {
      await panelWindowApi.present();
      return 'done';
    } catch (error) {
      usePanelHostStore.getState().setPlacement('docked');
      console.error('Failed to present detached panel', error);
      return 'failed';
    }
  } catch (error) {
    console.error('Failed to detach panel', error);
    return 'failed';
  } finally {
    usePanelHostStore.getState().setTransition('idle');
  }
};

/**
 * 패널 도킹: 호스트를 메인으로 되돌리고 창을 감춘다.
 * 창 감추기가 실패하면 빈 창이 남지 않게 detached로 되돌린다 (편집 보존)
 */
export const dockPropertiesPanel = async (): Promise<TransitionOutcome> => {
  const store = usePanelHostStore.getState();
  if (store.transition !== 'idle') return 'busy';
  if (store.placement === 'docked') return 'done';
  store.setTransition('docking');
  try {
    if (!(await settleEditsBeforeMove())) {
      console.error('Aborting panel dock: pending edit failed to commit');
      return 'blocked';
    }
    usePanelHostStore.getState().setPlacement('docked');
    await yieldToRender();
    try {
      await panelWindowApi.dock();
      return 'done';
    } catch (error) {
      if (getPanelChildWindow()) {
        usePanelHostStore.getState().setPlacement('detached');
      }
      console.error('Failed to dock panel window', error);
      return 'failed';
    }
  } catch (error) {
    console.error('Failed to dock panel', error);
    return 'failed';
  } finally {
    usePanelHostStore.getState().setTransition('idle');
  }
};

// 백엔드가 창을 감췄거나(close-ack 타임아웃·종료) 파괴했다 - 호스트를 메인으로 되돌린다.
// 진행 중인 전환은 자기 결론을 내므로 건드리지 않는다
export const notePanelWindowHidden = (): void => {
  const store = usePanelHostStore.getState();
  if (store.transition !== 'idle') return;
  if (store.placement === 'detached') store.setPlacement('docked');
};
