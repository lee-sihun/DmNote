import { create } from 'zustand';

import { panelWindowApi } from '@api/modules/selectionSessionApi';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { beginEditorWriteBarrier } from '@src/renderer/editor/runtime/editorWriteBarrier';
import { flushSelectionSync } from '@src/renderer/editor/runtime/selectionSync';
import { capturePanelViewState } from '@stores/grid/panelViewHandoff';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { drainPendingPluginElementWrites } from '@plugins/rpc/pluginElementActions';
import { drainPendingPluginSettingsWrites } from '@plugins/rpc/pluginSettingsMirror';

interface PanelWindowState {
  isDetached: boolean;
  setDetached: (value: boolean) => void;
}

// 분리 패널 창 존재 여부 projection - 메인 인라인 패널 gating(single render lease)
export const usePanelWindowStore = create<PanelWindowState>((set) => ({
  isDetached: false,
  setDetached: (value) => set({ isDetached: value }),
}));

// 렌더 반영을 기다리는 macrotask 양보 - 인라인 unmount가 패널 mount보다 선행하도록
const yieldToRender = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// 단축키·토글 OFF·네이티브 close는 click 포커스 이동이 없으므로
// blur 전용 편집값을 먼저 확정하고 React·IME 정산 turn을 기다림
const flushFocusedEditor = async (): Promise<void> => {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.matches('input, textarea, [contenteditable="true"]')
  ) {
    active.blur();
    await yieldToRender();
  }
};

const flushPanelTransition = async (): Promise<boolean> => {
  const drainBlurWrites = beginEditorWriteBarrier();
  await flushFocusedEditor();
  const [
    committed,
    blurWritesCommitted,
    pluginElementsCommitted,
    pluginSettingsCommitted,
  ] = await Promise.all([
    editGestureController.commitPendingAsync(),
    drainBlurWrites(),
    drainPendingPluginElementWrites(),
    drainPendingPluginSettingsWrites(),
  ]);
  const editorAndPluginsCommitted =
    committed &&
    blurWritesCommitted &&
    pluginElementsCommitted &&
    pluginSettingsCommitted;
  if (!editorAndPluginsCommitted) return false;

  return flushSelectionSync();
};

let transitionInFlight = false;

export const openPropertiesPanelForSelection = (): void => {
  const panel = usePropertiesPanelStore.getState();
  panel.setCanvasPanelMode('property');
  panel.setCanvasPanelOpen(true);
  if (usePanelWindowStore.getState().isDetached) {
    void panelWindowApi.requestPropertyMode().catch((error) => {
      console.error('분리 패널 속성 보기 요청 실패', error);
    });
  }
};

/**
 * 메인 창에서 패널 분리
 * 순서: 진행 게스처 커밋 성공 확인 → 인라인 unmount(lease 반납) → 창 생성. 실패 시 원복
 */
export const detachPropertiesPanel = async (): Promise<void> => {
  if (transitionInFlight) return;
  transitionInFlight = true;
  try {
    const committed = await flushPanelTransition();
    if (!committed) {
      console.error('Aborting panel detach: pending edit failed to commit');
      return;
    }
    const viewState = capturePanelViewState();
    usePanelWindowStore.getState().setDetached(true);
    await yieldToRender();
    try {
      await panelWindowApi.show(viewState);
    } catch (error) {
      usePanelWindowStore.getState().setDetached(false);
      console.error('Failed to open detached panel', error);
    }
  } finally {
    transitionInFlight = false;
  }
};

/**
 * 패널 창에서 재부착
 * 진행 게스처 커밋 성공 확인 후 창 반납 - 실패 시 창 유지 (편집 보존)
 */
export const reattachPropertiesPanel = async (): Promise<void> => {
  if (transitionInFlight) return;
  transitionInFlight = true;
  try {
    const committed = await flushPanelTransition();
    if (!committed) {
      console.error('Aborting panel reattach: pending edit failed to commit');
      return;
    }
    await panelWindowApi.close(capturePanelViewState());
  } catch (error) {
    console.error('Failed to close detached panel', error);
  } finally {
    transitionInFlight = false;
  }
};
