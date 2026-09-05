import { create } from 'zustand';

import { panelWindowApi } from '@api/modules/panelWindowApi';
import { drainPendingOptimisticCommits } from '@hooks/pendingOptimisticCommits';
import { flushFocusedEditor } from '@src/renderer/editor/runtime/lifecycle/lifecycleEditorFlush';
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
  attachedPlacement: PanelHostPlacement | null;
  transition: PanelHostTransition;
  setPlacement: (placement: PanelHostPlacement) => void;
  setAttachedPlacement: (placement: PanelHostPlacement | null) => void;
  setTransition: (transition: PanelHostTransition) => void;
}

let captureBeforePlacementChange: (() => void) | null = null;

// React가 분리·도킹용 높이 클래스를 바꾸기 전에 현재 스크롤 위치를 읽는다
export const registerPanelHostMoveCapture = (capture: () => void) => {
  captureBeforePlacementChange = capture;
  return () => {
    if (captureBeforePlacementChange === capture) {
      captureBeforePlacementChange = null;
    }
  };
};

export const usePanelHostStore = create<PanelHostState>((set, get) => ({
  placement: 'docked',
  attachedPlacement: null,
  transition: 'idle',
  setPlacement: (placement) => {
    if (get().placement === placement) return;
    captureBeforePlacementChange?.();
    set({ placement });
  },
  setAttachedPlacement: (attachedPlacement) => set({ attachedPlacement }),
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

// 도킹은 호스트 이동을 짧게만 기다린다 - 설정 화면에선 호스트가 언마운트돼 영영 안 붙고,
// 창은 그동안 떠 있어 보이므로 오래 붙잡지 않는다
const DOCK_ATTACH_TIMEOUT_MS = 300;

// 실제 DOM 이동은 React layout effect가 확인한다. 타이머 한 번으로는 커밋 완료를 보장할 수 없다
const waitForPanelHostAttachment = (
  placement: PanelHostPlacement,
  {
    timeoutMs = 1500,
    // 호스트가 아예 없으면(언마운트) 옮길 것도 없으므로 성공으로 본다
    settleWhenAbsent = false,
  }: { timeoutMs?: number; settleWhenAbsent?: boolean } = {},
): Promise<boolean> => {
  const attachedPlacement = usePanelHostStore.getState().attachedPlacement;
  if (attachedPlacement === placement) {
    return Promise.resolve(true);
  }
  if (settleWhenAbsent && attachedPlacement === null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (attached: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(attached);
    };
    const unsubscribe = usePanelHostStore.subscribe((state) => {
      if (state.attachedPlacement === placement) finish(true);
      else if (settleWhenAbsent && state.attachedPlacement === null) {
        finish(true);
      }
    });
    const timeoutId = setTimeout(() => finish(false), timeoutMs);
  });
};

let reapplyScrollAfterPresent: (() => void) | null = null;

// 자식 창은 present() 뒤에야 레이아웃이 선다 - 숨긴 채 복원한 스크롤이 limit 0으로
// 잘렸을 수 있어 드러난 뒤 한 번 더 적용한다 (PropertiesPanelHost가 등록)
export const reapplyPanelHostScroll = (): void => {
  reapplyScrollAfterPresent?.();
};

export const registerPanelHostScrollReapply = (reapply: () => void) => {
  reapplyScrollAfterPresent = reapply;
  return () => {
    if (reapplyScrollAfterPresent === reapply) reapplyScrollAfterPresent = null;
  };
};

const restorePlacement = async (placement: PanelHostPlacement) => {
  usePanelHostStore.getState().setPlacement(placement);
  await waitForPanelHostAttachment(placement);
};

// 문서를 옮기면 포커스가 풀리는데 blur 이벤트가 따라온다는 보장이 없다 -
// blur 전용 편집값을 옮기기 전에 확정한다.
// 낙관 커밋의 rAF는 떠나는 창과 함께 멈추므로 대기분도 지금 확정한다
const settleEditsBeforeMove = async (): Promise<boolean> => {
  try {
    drainPendingOptimisticCommits();
    return await flushFocusedEditor();
  } catch (error) {
    console.error('패널 이동 전 편집 정산 실패', error);
    return false;
  }
};

export interface DetachOptions {
  // 창 좌상단을 놓을 화면 논리 좌표 - 없으면 메인 옆에 붙인다
  position?: { x: number; y: number };
  // 드래그 도중 tear-off - 포커스를 뺏으면 메인의 드래그 세션이 끊기므로 창만 보인다
  keepMainFocus?: boolean;
  // Windows 네이티브 드래그 - presentAt 자리에 주입되는 세션 인지 present.
  // 전환 조정(편집 정산·창 확보·호스트 부착·실패 롤백)은 그대로 이 함수가 소유한다
  present?: () => Promise<void>;
}

/**
 * 패널 분리: 자식 창 확보(없으면 window.open) → 호스트 이동 → 창 드러내기
 * 실패 시 docked로 되돌린다
 */
export const detachPropertiesPanel = async (
  options: DetachOptions = {},
): Promise<TransitionOutcome> => {
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
    if (!(await waitForPanelHostAttachment('detached'))) {
      await restorePlacement('docked');
      console.error('Failed to attach panel host to detached window');
      return 'failed';
    }
    try {
      if (options.present) {
        await options.present();
      } else if (options.position) {
        await panelWindowApi.presentAt(
          options.position.x,
          options.position.y,
          !options.keepMainFocus,
        );
      } else {
        await panelWindowApi.present();
      }
      reapplyPanelHostScroll();
      return 'done';
    } catch (error) {
      await restorePlacement('docked');
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
    // 분리 창엔 접힘이 없었다 - 도킹한 패널은 펼친 채로 돌려준다
    usePropertiesPanelStore.getState().setCanvasPanelOpen(true);
    // 도킹도 호스트 이동을 기다린다 - 다만 실패는 치명이 아니다 (창은 그대로 감춘다).
    // 설정 화면에선 호스트가 언마운트돼 attach가 영영 오지 않는다
    if (
      !(await waitForPanelHostAttachment('docked', {
        timeoutMs: DOCK_ATTACH_TIMEOUT_MS,
        settleWhenAbsent: true,
      }))
    ) {
      console.warn(
        'Panel host did not attach to the main document before dock',
      );
    }
    try {
      await panelWindowApi.dock();
      return 'done';
    } catch (error) {
      if (getPanelChildWindow()) {
        // 되돌림도 짧게만 기다린다 - 호스트가 없으면(설정 화면) 영영 안 붙는다
        usePanelHostStore.getState().setPlacement('detached');
        await waitForPanelHostAttachment('detached', {
          timeoutMs: DOCK_ATTACH_TIMEOUT_MS,
          settleWhenAbsent: true,
        });
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
