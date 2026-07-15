/**
 * 편집기 상태 스냅샷 캡처/복원
 */

import { useKeyStore } from '@stores/data/useKeyStore';
import { unstable_batchedUpdates } from 'react-dom';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import type { HistorySettingsSnapshot } from '@stores/data/useHistoryStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useFontStore, syncFontCSS } from '@stores/useFontStore';
import { applyCounterSnapshot } from '@stores/signals/keyCounterSignals';
import { applyCounterCacheSnapshot } from '@stores/signals/keyCounterCache';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { restoreEditorHistory } from '@api/modules/editorApi';
import { editorCoordinator } from './editorStateCoordinator';

// ----------------------------------------------------------------------------
// 히스토리에 현재 상태 저장
// ----------------------------------------------------------------------------

/** 현재 편집 상태를 히스토리 past 스택에 push */
export function pushCurrentStateToHistory(): void {
  const keyState = useKeyStore.getState();
  const statPositions = useStatItemStore.getState().positions;
  const graphPositions = useGraphItemStore.getState().positions;
  const knobPositions = useKnobItemStore.getState().positions;
  const pluginElements = usePluginDisplayElementStore.getState().elements;
  const layerGroups = useLayerGroupStore.getState().layerGroups;

  useHistoryStore.getState().pushState({
    keyMappings: keyState.keyMappings,
    positions: keyState.positions,
    statPositions,
    graphPositions,
    knobPositions,
    pluginElements,
    layerGroups,
    customTabs: keyState.customTabs,
    selectedKeyType: keyState.selectedKeyType,
  });
}

// ----------------------------------------------------------------------------
// 플러그인 요소 복원 (undo/redo 공통)
// ----------------------------------------------------------------------------

/**
 * 저장된 플러그인 요소 목록을 현재 핸들러 정보와 매칭하여 복원
 * @returns 복원된 요소 목록
 */
export function restorePluginElements(
  savedElements: PluginDisplayElementInternal[],
  currentElements: PluginDisplayElementInternal[],
): PluginDisplayElementInternal[] {
  const elementRestorers = window.__dmn_element_restorers;

  const restoredElements = savedElements.map((savedEl) => {
    // 같은 fullId를 가진 현재 요소 찾기
    const currentEl = currentElements.find(
      (el) => el.fullId === savedEl.fullId,
    );
    if (currentEl) {
      // 현재 요소의 핸들러 정보 유지, 저장된 위치/설정으로 복원
      return {
        ...currentEl,
        position: savedEl.position,
        settings: savedEl.settings,
        state: savedEl.state,
        measuredSize: savedEl.measuredSize,
        resizeAnchor: savedEl.resizeAnchor,
        zIndex: savedEl.zIndex,
        hidden: savedEl.hidden,
      };
    }

    // 현재 없는 요소 (삭제된 요소 복구)
    if (savedEl.definitionId && elementRestorers?.has(savedEl.definitionId)) {
      const restorer = elementRestorers.get(savedEl.definitionId)!;
      return restorer(savedEl);
    }

    // 복원 함수가 없으면 그대로 반환
    return savedEl;
  });

  return restoredElements as PluginDisplayElementInternal[];
}

// ----------------------------------------------------------------------------
// undo/redo에서 복원된 상태를 store + API에 반영
// ----------------------------------------------------------------------------

interface RestoredState {
  keyMappings: import('@src/types/key/keys').KeyMappings;
  positions: import('@src/types/key/keys').KeyPositions;
  statPositions: import('@src/types/key/statItems').StatItemPositions;
  graphPositions: import('@src/types/key/graphItems').GraphItemPositions;
  knobPositions: import('@src/types/key/knobs').KnobItemPositions;
  pluginElements?: PluginDisplayElementInternal[];
  layerGroups: import('@src/types/layerGroups').LayerGroups;
  keyCounters?: import('@src/types/key/keys').KeyCounters;
  customTabs: import('@src/types/key/keys').CustomTab[];
  selectedKeyType: string;
  settingsSnapshot?: HistorySettingsSnapshot;
}

/** 복원된 상태를 로컬 store에 반영 */
export function applyRestoredStateToStores(state: RestoredState): void {
  unstable_batchedUpdates(() => {
    useKeyStore
      .getState()
      .setKeyMappingsAndPositions(state.keyMappings, state.positions);
    useStatItemStore.getState().setPositions(state.statPositions);
    useGraphItemStore.getState().setPositions(state.graphPositions);
    if (state.knobPositions !== undefined) {
      useKnobItemStore.getState().setPositions(state.knobPositions);
    }

    useLayerGroupStore.getState().setLayerGroups(state.layerGroups);
    if (state.keyCounters) {
      applyCounterCacheSnapshot(state.keyCounters);
      if (window.__dmn_window_type === 'overlay') {
        applyCounterSnapshot(state.keyCounters);
      }
    }
    useKeyStore.getState().setCustomTabs(state.customTabs);
    useKeyStore.setState({ selectedKeyType: state.selectedKeyType });

    // 설정 스냅샷 복원 (프리셋 로드 undo 전용)
    if (state.settingsSnapshot) {
      const snap = state.settingsSnapshot;
      useSettingsStore.getState().merge({
        useCustomCSS: snap.useCustomCSS,
        customCSSContent: snap.customCSSContent,
        customCSSPath: snap.customCSSPath,
        useCustomJS: snap.useCustomJS,
        jsPlugins: snap.jsPlugins,
        backgroundColor: snap.backgroundColor,
        noteSettings: snap.noteSettings,
        noteEffect: snap.noteEffect,
        tabNoteOverrides: snap.tabNoteOverrides,
      });
      useFontStore.getState().setAll(snap.fontSettings.customFonts);
      syncFontCSS();
    }
  });
}

/** 복원된 플러그인 요소를 store에 반영하고 오버레이에 동기화 */
export function applyRestoredPluginElements(
  savedPluginElements: PluginDisplayElementInternal[] | undefined,
  currentPluginElements: PluginDisplayElementInternal[],
  savedFullIds?: Set<string>,
): void {
  if (savedPluginElements === undefined) return;

  const restored = restorePluginElements(
    savedPluginElements,
    currentPluginElements,
  );

  // 저장된 상태에 있는 요소만 유지
  const ids =
    savedFullIds ?? new Set(savedPluginElements.map((el) => el.fullId));
  const finalElements = restored.filter(
    (el) =>
      ids.has(el.fullId) ||
      currentPluginElements.some((cur) => cur.fullId === el.fullId),
  );

  usePluginDisplayElementStore
    .getState()
    .setElements(finalElements as PluginDisplayElementInternal[]);

  // 오버레이로 동기화
  sendBridgeMessageBestEffort('overlay', 'plugin:displayElements:sync', {
    elements: finalElements,
  });
}

/** 복원된 상태를 Tauri 백엔드에 동기화 */
export async function persistRestoredState(
  state: RestoredState,
  baseRevision: number,
): Promise<void> {
  const document = {
    schemaVersion: 1,
    keys: state.keyMappings,
    keyPositions: state.positions,
    statPositions: state.statPositions,
    graphPositions: state.graphPositions,
    knobPositions: state.knobPositions,
    layerGroups: state.layerGroups,
  } as const;
  const settingsPatch = state.settingsSnapshot
    ? {
        useCustomCSS: state.settingsSnapshot.useCustomCSS,
        useCustomJS: state.settingsSnapshot.useCustomJS,
        backgroundColor: state.settingsSnapshot.backgroundColor,
        noteSettings: state.settingsSnapshot.noteSettings,
        noteEffect: state.settingsSnapshot.noteEffect,
        fontSettings: state.settingsSnapshot.fontSettings,
        customCSS: {
          content: state.settingsSnapshot.customCSSContent,
          path: state.settingsSnapshot.customCSSPath,
        },
        customJS: { plugins: state.settingsSnapshot.jsPlugins },
      }
    : undefined;

  await restoreEditorHistory({
    baseRevision,
    document,
    customTabs: state.customTabs,
    selectedKeyType: state.selectedKeyType,
    keyCounters: state.keyCounters,
    settingsPatch,
    tabNoteOverrides: state.settingsSnapshot?.tabNoteOverrides,
  });

  // 이벤트 유실·순서 역전을 막는 최종 canonical 대조
  await editorCoordinator.sync({ reapply: true }).catch((error) => {
    console.error('Failed to resync restored editor history', error);
  });
}
