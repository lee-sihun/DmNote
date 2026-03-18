/**
 * 편집기 상태 스냅샷 캡처/복원
 */

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useHistoryStore } from '@stores/data/useHistoryStore';
import type { HistorySettingsSnapshot } from '@stores/data/useHistoryStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { useFontStore, syncFontCSS } from '@stores/useFontStore';
import { applyCounterSnapshot } from '@stores/signals/keyCounterSignals';
import { applyCounterCacheSnapshot } from '@stores/signals/keyCounterCache';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

// ----------------------------------------------------------------------------
// 히스토리에 현재 상태 저장
// ----------------------------------------------------------------------------

/** 현재 편집 상태를 히스토리 past 스택에 push */
export function pushCurrentStateToHistory(): void {
  const keyState = useKeyStore.getState();
  const statPositions = useStatItemStore.getState().positions;
  const graphPositions = useGraphItemStore.getState().positions;
  const pluginElements = usePluginDisplayElementStore.getState().elements;
  const layerGroups = useLayerGroupStore.getState().layerGroups;

  useHistoryStore.getState().pushState({
    keyMappings: keyState.keyMappings,
    positions: keyState.positions,
    statPositions,
    graphPositions,
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
  pluginElements?: PluginDisplayElementInternal[];
  layerGroups?: import('@src/types/layerGroups').LayerGroups;
  keyCounters?: import('@src/types/key/keys').KeyCounters;
  customTabs: import('@src/types/key/keys').CustomTab[];
  selectedKeyType: string;
  settingsSnapshot?: HistorySettingsSnapshot;
}

/** 복원된 상태를 로컬 store에 반영 */
export function applyRestoredStateToStores(state: RestoredState): void {
  useKeyStore
    .getState()
    .setKeyMappingsAndPositions(state.keyMappings, state.positions);
  useStatItemStore.getState().setPositions(state.statPositions);
  useGraphItemStore.getState().setPositions(state.graphPositions);

  if (state.layerGroups !== undefined) {
    useLayerGroupStore.getState().setLayerGroups(state.layerGroups);
  }
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
  if (window.api?.bridge) {
    window.api.bridge.sendTo('overlay', 'plugin:displayElements:sync', {
      elements: finalElements,
    });
  }
}

/** 복원된 상태를 Tauri 백엔드에 동기화 */
export async function persistRestoredState(
  state: RestoredState,
): Promise<void> {
  // keys.update()가 counters를 sync하므로 먼저 실행
  await window.api.keys.update(state.keyMappings);

  // 나머지는 병렬 실행 (실패해도 핵심 복구를 막지 않음)
  const promises: Promise<unknown>[] = [
    window.api.keys.updatePositions(state.positions).catch((error) => {
      console.error('Failed to persist positions', error);
    }),
    window.api.statItems.updatePositions(state.statPositions).catch((error) => {
      console.error('Failed to persist stat positions', error);
    }),
    window.api.graphItems
      .updatePositions(state.graphPositions)
      .catch((error) => {
        console.error('Failed to persist graph positions', error);
      }),
  ];

  if (state.layerGroups !== undefined) {
    promises.push(
      window.api.layerGroups.update(state.layerGroups).catch((error) => {
        console.error('Failed to persist layer groups', error);
      }),
    );
  }
  if (state.keyCounters) {
    promises.push(window.api.keys.setCounters(state.keyCounters));
  }
  promises.push(
    window.api.keys.customTabs
      .restore(state.customTabs, state.selectedKeyType)
      .catch((error) => {
        console.error('Failed to restore custom tabs', error);
      }),
  );

  await Promise.all(promises);

  // 오버레이 동기화
  try {
    window.api.bridge.sendTo('overlay', 'statPositions:sync', {
      positions: state.statPositions,
    });
  } catch {
    /* 무시 */
  }
  try {
    window.api.bridge.sendTo('overlay', 'graphPositions:sync', {
      positions: state.graphPositions,
    });
  } catch {
    /* 무시 */
  }

  // 설정 스냅샷 백엔드 동기화 (프리셋 로드 undo 전용)
  if (state.settingsSnapshot) {
    const snap = state.settingsSnapshot;

    // 설정 전체 persist (CSS path/content, JS plugins 포함) 먼저 완료
    await window.api.settings
      .update({
        backgroundColor: snap.backgroundColor,
        noteSettings: snap.noteSettings,
        noteEffect: snap.noteEffect,
        fontSettings: snap.fontSettings,
        customCSS: { content: snap.customCSSContent, path: snap.customCSSPath },
        customJS: { plugins: snap.jsPlugins },
      })
      .catch((e) => {
        console.error('Failed to restore settings', e);
      });

    // CSS 이벤트 발생 (css:content + css:use)
    const cssEvents = Promise.all([
      window.api.css.setContent(snap.customCSSContent).catch((e) => {
        console.error('Failed to emit CSS content', e);
      }),
      window.api.css.toggle(snap.useCustomCSS).catch((e) => {
        console.error('Failed to toggle CSS', e);
      }),
    ]);

    // JS 토글 → JS 리로드
    const jsEvents = window.api.js
      .toggle(snap.useCustomJS)
      .then(() => (snap.useCustomJS ? window.api.js.reload() : undefined))
      .catch((e) => {
        console.error('Failed to restore JS', e);
      });

    // tabNoteOverrides 복원 (getAll 실패 시 store 값을 fallback으로 사용)
    const currentTabOverrides = await window.api.noteTab.getAll().catch(() =>
      useSettingsStore.getState().tabNoteOverrides,
    );
    const tabIds = new Set<string>([
      ...Object.keys(snap.tabNoteOverrides),
      ...Object.keys(currentTabOverrides),
    ]);
    const tabRestore = Promise.all(
      Array.from(tabIds).map((tabId) => {
        const snapSettings = snap.tabNoteOverrides[tabId];
        return snapSettings !== undefined
          ? window.api.noteTab.set(tabId, snapSettings).catch((e) => {
              console.error('Failed to restore tab note', e);
            })
          : window.api.noteTab.clear(tabId).catch((e) => {
              console.error('Failed to clear tab note', e);
            });
      }),
    );

    await Promise.all([cssEvents, jsEvents, tabRestore]);
  }
}
