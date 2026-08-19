import { create } from 'zustand';

import { panelWindowApi } from '@api/modules/selectionSessionApi';
import { flushFocusedEditor } from '@src/renderer/editor/runtime/lifecycleEditorFlush';
import { flushSelectionSync } from '@src/renderer/editor/runtime/selectionSync';
import { capturePanelViewState } from '@stores/grid/panelViewHandoff';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { drainPendingPluginElementWrites } from '@plugins/rpc/pluginElementActions';
import { drainPendingPluginSettingsWrites } from '@plugins/rpc/pluginSettingsMirror';

export type PanelWindowStatus = 'unknown' | 'attached' | 'detached';

export const hasInlinePropertiesPanelLease = (
  status: PanelWindowStatus,
): boolean => status === 'attached';

interface PanelWindowState {
  status: PanelWindowStatus;
  statusRevision: number;
  setStatus: (status: PanelWindowStatus) => void;
  resolveInitialStatus: (
    status: Exclude<PanelWindowStatus, 'unknown'>,
    expectedRevision: number,
  ) => void;
}

// 분리 패널 창 존재 여부 projection - 메인 인라인 패널 gating(single render lease)
export const usePanelWindowStore = create<PanelWindowState>((set) => ({
  status: 'unknown',
  statusRevision: 0,
  setStatus: (status) =>
    set((state) => ({ status, statusRevision: state.statusRevision + 1 })),
  resolveInitialStatus: (status, expectedRevision) =>
    set((state) =>
      state.status === 'unknown' && state.statusRevision === expectedRevision
        ? { status, statusRevision: state.statusRevision + 1 }
        : state,
    ),
}));

// 렌더 반영을 기다리는 macrotask 양보 - 인라인 unmount가 패널 mount보다 선행하도록
const yieldToRender = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// 단축키·토글 OFF·네이티브 close는 click 포커스 이동이 없으므로 blur 전용 편집값을 먼저 확정한다.
// 정산 순서는 공용 함수가 소유한다 - 여기서 따로 양보하면 그 사이 도착한 선택 변경이
// 아직 시작도 안 한 gesture를 취소한다
const flushPanelTransition = async (): Promise<boolean> => {
  const [editorCommitted, pluginElementsCommitted, pluginSettingsCommitted] =
    await Promise.all([
      flushFocusedEditor(),
      drainPendingPluginElementWrites(),
      drainPendingPluginSettingsWrites(),
    ]);
  if (
    !editorCommitted ||
    !pluginElementsCommitted ||
    !pluginSettingsCommitted
  ) {
    return false;
  }

  return flushSelectionSync();
};

let transitionInFlight = false;

// 전환 결과. 호출부가 사용자에게 알릴지 결정한다 - 여기서 조용히 끝나면 버튼이 먹통으로 보인다
// busy: 이미 진행 중, blocked: 미확정 편집을 정산하지 못해 중단, failed: 창 전환 자체가 실패
export type TransitionOutcome = 'done' | 'busy' | 'blocked' | 'failed';

// 알림이 필요한 결과. busy는 진행 중인 전환이 곧 결론을 내므로 조용히 넘긴다
export const isTransitionFailure = (outcome: TransitionOutcome): boolean =>
  outcome === 'blocked' || outcome === 'failed';

export const openPropertiesPanelForSelection = (): void => {
  const panel = usePropertiesPanelStore.getState();
  panel.setCanvasPanelMode('property');
  panel.setCanvasPanelOpen(true);
  if (usePanelWindowStore.getState().status === 'detached') {
    void panelWindowApi.requestPropertyMode().catch((error) => {
      console.error('분리 패널 속성 보기 요청 실패', error);
    });
  }
};

/**
 * 메인 창에서 패널 분리
 * 순서: 진행 게스처 커밋 성공 확인 → 인라인 unmount(lease 반납) → 창 생성. 실패 시 원복
 */
export const detachPropertiesPanel = async (): Promise<TransitionOutcome> => {
  if (transitionInFlight) return 'busy';
  transitionInFlight = true;
  try {
    const committed = await flushPanelTransition();
    if (!committed) {
      console.error('Aborting panel detach: pending edit failed to commit');
      return 'blocked';
    }
    const viewState = capturePanelViewState();
    usePanelWindowStore.getState().setStatus('detached');
    await yieldToRender();
    try {
      await panelWindowApi.show(viewState);
      return 'done';
    } catch (error) {
      usePanelWindowStore.getState().setStatus('attached');
      console.error('Failed to open detached panel', error);
      return 'failed';
    }
  } catch (error) {
    // 정산 자체가 던져도 호출부가 알릴 수 있게 결과로 바꾼다
    console.error('Failed to detach panel', error);
    return 'failed';
  } finally {
    transitionInFlight = false;
  }
};

/**
 * 패널 창에서 재부착
 * 진행 게스처 커밋 성공 확인 후 창 반납 - 실패 시 창 유지 (편집 보존)
 */
export const reattachPropertiesPanel = async (): Promise<TransitionOutcome> => {
  if (transitionInFlight) return 'busy';
  transitionInFlight = true;
  try {
    const committed = await flushPanelTransition();
    if (!committed) {
      console.error('Aborting panel reattach: pending edit failed to commit');
      return 'blocked';
    }
    await panelWindowApi.close(capturePanelViewState());
    return 'done';
  } catch (error) {
    console.error('Failed to close detached panel', error);
    return 'failed';
  } finally {
    transitionInFlight = false;
  }
};
