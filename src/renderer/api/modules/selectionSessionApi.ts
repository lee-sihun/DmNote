import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

import { subscribe } from './shared';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

// 창 간 선택 동기화용 비영속 세션 wire 형식 (Rust SelectionSessionSnapshot과 동일)
export interface SelectionSessionElementWire {
  elementType: string;
  index?: number | null;
  fullId?: string | null;
}

export interface SelectionSessionSnapshot {
  selectedElements: SelectionSessionElementWire[];
  selectedGroupIds: string[];
  mode: string;
  selectionRevision: number;
}

export interface PanelViewState {
  mode: 'layer' | 'property';
  activeTab: 'layer' | 'grid';
  propertyActiveTab: 'style' | 'note' | 'counter';
}

// 스토어 SelectedElement({type,id,index}) ↔ wire 변환
export const toWireElements = (
  elements: SelectedElement[],
): SelectionSessionElementWire[] =>
  elements.map((element) => ({
    elementType: element.type,
    index: element.index ?? null,
    fullId: element.id,
  }));

export const fromWireElements = (
  elements: SelectionSessionElementWire[],
): SelectedElement[] =>
  elements
    .filter((element) => element.fullId != null)
    .map((element) => ({
      type: element.elementType as SelectedElement['type'],
      id: element.fullId!,
      ...(element.index != null ? { index: element.index } : {}),
    }));

export const selectionSessionApi = {
  get: () => invoke<SelectionSessionSnapshot>('selection_session_get'),
  publish: (snapshot: {
    selectedElements: SelectionSessionElementWire[];
    selectedGroupIds: string[];
    mode: string;
  }) =>
    invoke<SelectionSessionSnapshot>('selection_session_publish', {
      snapshot: { ...snapshot, selectionRevision: 0 },
    }),
  onChanged: (listener: (snapshot: SelectionSessionSnapshot) => void) =>
    subscribe<SelectionSessionSnapshot>('selection:changed', listener),
};

export const panelWindowApi = {
  show: (viewState: PanelViewState) =>
    invoke<void>('panel_window_show', { viewState }),
  close: (viewState: PanelViewState) =>
    invoke<void>('panel_window_close', { viewState }),
  takeViewState: () =>
    invoke<PanelViewState | null>('panel_window_take_view_state'),
  requestPropertyMode: () => emit('panel:property-mode-requested'),
  isOpen: () => invoke<boolean>('panel_window_is_open'),
  startDragging: (clientX: number, clientY: number) =>
    invoke<void>('panel_window_start_dragging', { clientX, clientY }),
  // X 버튼 ack - 제한 시간 내 미호출 시 백엔드가 fallback으로 창을 닫음
  ackClose: (requestId: string) =>
    invoke<boolean>('panel_window_close_ack', { requestId }),
  onVisibility: (
    listener: (payload: {
      visible: boolean;
      // visible=false 한정 - 정상 close(reattach)와 예기치 못한 파괴 구분
      reason?: 'closed' | 'destroyed';
    }) => void,
  ) =>
    subscribe<{ visible: boolean; reason?: 'closed' | 'destroyed' }>(
      'panel:visibility',
      listener,
    ),
  onCloseRequested: (listener: (payload: { requestId: string }) => void) =>
    subscribe<{ requestId: string }>('panel:close-requested', listener),
  onPropertyModeRequested: (listener: () => void) =>
    subscribe('panel:property-mode-requested', listener),
};
