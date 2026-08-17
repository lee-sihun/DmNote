import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

import { subscribe } from './shared';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';

// 창 간 선택 동기화용 비영속 세션 wire 형식 (Rust SelectionSessionSnapshot과 동일)
export interface SelectionSessionElementWire {
  elementType: 'key' | 'stat' | 'graph' | 'knob' | 'plugin';
  fullId: string;
}

export interface SelectionSessionSnapshot {
  selectedElements: SelectionSessionElementWire[];
  selectedGroupIds: string[];
  mode: string;
  selectionRevision: number;
}

const SELECTION_ELEMENT_TYPES = [
  'key',
  'stat',
  'graph',
  'knob',
  'plugin',
] as const;

type SelectionSessionElementType = (typeof SELECTION_ELEMENT_TYPES)[number];

const isSelectionSessionElementType = (
  value: unknown,
): value is SelectionSessionElementType =>
  typeof value === 'string' &&
  SELECTION_ELEMENT_TYPES.some((type) => type === value);

export interface PanelViewState {
  mode: 'layer' | 'property';
  activeTab: 'layer' | 'grid';
  propertyActiveTab: 'style' | 'note' | 'counter';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

const parseSelectionSessionSnapshot = (
  value: unknown,
): SelectionSessionSnapshot => {
  if (!isRecord(value)) throw new Error('invalid selection session snapshot');
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'selectedElements',
          'selectedGroupIds',
          'mode',
          'selectionRevision',
        ].includes(key),
    )
  ) {
    throw new Error('invalid selection session snapshot');
  }
  const { selectedElements, selectedGroupIds, mode, selectionRevision } = value;
  if (
    !Array.isArray(selectedElements) ||
    selectedElements.length > 4096 ||
    !Array.isArray(selectedGroupIds) ||
    selectedGroupIds.length > 4096 ||
    typeof mode !== 'string' ||
    utf8Length(mode) > 128 ||
    !Number.isSafeInteger(selectionRevision) ||
    (selectionRevision as number) < 0
  ) {
    throw new Error('invalid selection session snapshot');
  }
  const seenElements = new Set<string>();
  const parsedElements = selectedElements.map((element, index) => {
    if (!isRecord(element)) {
      throw new Error(`invalid selection session element ${index}`);
    }
    if (
      Object.keys(element).some(
        (key) => !['elementType', 'fullId'].includes(key),
      )
    ) {
      throw new Error(`invalid selection session element ${index}`);
    }
    const elementType = element.elementType;
    const fullId = element.fullId;
    if (
      !isSelectionSessionElementType(elementType) ||
      utf8Length(elementType) > 64 ||
      typeof fullId !== 'string' ||
      fullId.length === 0 ||
      utf8Length(fullId) > 512 ||
      (elementType !== 'plugin' && !isNativeElementId(fullId))
    ) {
      throw new Error(`invalid selection session element ${index}`);
    }
    if (seenElements.has(fullId)) {
      throw new Error(`duplicate selection session element ${index}`);
    }
    seenElements.add(fullId);
    return { elementType, fullId };
  });
  const seenGroupIds = new Set<string>();
  const parsedGroupIds = selectedGroupIds.map((groupId, index) => {
    if (
      typeof groupId !== 'string' ||
      groupId.length === 0 ||
      utf8Length(groupId) > 512
    ) {
      throw new Error(`invalid selection group ${index}`);
    }
    if (seenGroupIds.has(groupId)) {
      throw new Error(`duplicate selection group ${index}`);
    }
    seenGroupIds.add(groupId);
    return groupId;
  });
  return {
    selectedElements: parsedElements,
    selectedGroupIds: parsedGroupIds,
    mode,
    selectionRevision: selectionRevision as number,
  };
};

// 스토어 SelectedElement({type,id,index}) ↔ wire 변환
export const toWireElements = (
  elements: SelectedElement[],
): SelectionSessionElementWire[] =>
  elements.map((element) => ({
    elementType: element.type,
    fullId: element.id,
  }));

export const fromWireElements = (
  elements: SelectionSessionElementWire[],
): SelectedElement[] => {
  const parsed: SelectedElement[] = [];
  for (const element of elements) {
    const id = element.fullId;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (element.elementType === 'plugin') {
      parsed.push({ type: 'plugin', id });
      continue;
    }
    if (
      !['key', 'stat', 'graph', 'knob'].includes(element.elementType) ||
      !isNativeElementId(id)
    ) {
      continue;
    }
    parsed.push({
      type: element.elementType as 'key' | 'stat' | 'graph' | 'knob',
      id,
    });
  }
  return parsed;
};

export const selectionSessionApi = {
  get: async () =>
    parseSelectionSessionSnapshot(await invoke('selection_session_get')),
  publish: (snapshot: {
    selectedElements: SelectionSessionElementWire[];
    selectedGroupIds: string[];
    mode: string;
  }) =>
    invoke('selection_session_publish', {
      snapshot: { ...snapshot, selectionRevision: 0 },
    }).then(parseSelectionSessionSnapshot),
  onChanged: (listener: (snapshot: SelectionSessionSnapshot) => void) =>
    subscribe<unknown>('selection:changed', (payload) =>
      listener(parseSelectionSessionSnapshot(payload)),
    ),
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
