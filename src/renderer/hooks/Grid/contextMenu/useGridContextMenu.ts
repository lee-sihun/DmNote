/**
 * Grid 컨텍스트 메뉴 관련 로직 훅
 * - 키 컨텍스트 메뉴 항목 생성
 * - 그리드 컨텍스트 메뉴 항목 생성
 */

import { useRef } from 'react';

import type { ListItem, ListMenuItem } from '@components/main/Modal/listPopup/ListPopup';
import { usePanelHostStore } from '@stores/grid/usePanelHostStore';
import { usePluginMenuStore } from '@stores/plugin/usePluginMenuStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import type { KeyMappings, KeyPosition } from '@src/types/key/keys';
import { slotCanonical } from '@utils/keySlot';
import type {
  PluginMenuItemInternal,
  KeyMenuContext,
  GridMenuContext,
  PluginMessages,
} from '@src/types/plugin/api';

// 빈 바닥 메뉴의 플러그인 묶음 행. 자식이 있는 행은 선택 이벤트를 내지 않으므로
// 이 id가 onSelect로 흘러가지 않는다
export const PLUGIN_GROUP_ID = 'pluginGroup';

// 메뉴 표면이 소유하는 타입을 그대로 쓴다 - 여기서 다시 정의하면 두 벌이 따로 흐른다
type MenuItem = ListMenuItem;
type MenuEntry = ListItem;

// 빈 묶음은 건너뛴다 - 선이 겹치거나 목록 끝에 남지 않게
const joinMenuGroups = (groups: MenuItem[][]): MenuEntry[] =>
  groups
    .filter((group) => group.length > 0)
    .flatMap<MenuEntry>((group, index) =>
      index === 0
        ? group
        : [{ id: `separator-${index}`, separator: true }, ...group],
    );

// 자식이 전부 잠겨 있으면 묶음 행도 잠근다 - 열 수 있어 보이는 막다른 서브메뉴 방지
const groupRow = (
  id: string,
  label: string,
  children: MenuItem[],
): MenuItem => ({
  id,
  label,
  children,
  disabled: children.every((child) => child.disabled),
});

interface KeyContext {
  keyCode: string;
  // 요소 안정 ID - index는 스냅샷 한정 locator
  id: string;
  index: number;
  position: KeyPosition;
  mode: string;
}

interface GridContext {
  position: { dx: number; dy: number };
  mode: string;
}

interface UseGridContextMenuParams {
  selectedKeyType: string;
  keyMappings: KeyMappings;
  positions: Record<string, KeyPosition[]>;
  locale: string;
  t: (key: string) => string;
  noteEffect?: boolean;
}

interface UseGridContextMenuReturn {
  getKeyMenuItems: (
    contextIndex: number | null,
    contextElementId?: string | null,
  ) => MenuItem[];
  getStatMenuItems: (contextIndex: number | null) => MenuItem[];
  getGraphMenuItems: (contextIndex: number | null) => MenuItem[];
  getKnobMenuItems: (contextIndex: number | null) => MenuItem[];
  getGridMenuItems: (
    gridAddLocalPos: { dx: number; dy: number } | null,
  ) => MenuEntry[];
  pluginKeyMenuItems: PluginMenuItemInternal<KeyMenuContext>[];
  pluginGridMenuItems: PluginMenuItemInternal<GridMenuContext>[];
  resolvePluginLabel: (pluginId: string, rawLabel: string) => string;
}

/**
 * 컨텍스트 메뉴 훅
 */
export function useGridContextMenu({
  selectedKeyType,
  keyMappings,
  positions,
  locale,
  t,
  noteEffect,
}: UseGridContextMenuParams): UseGridContextMenuReturn {
  // 전역 CSS 활성화 여부
  const useCustomCSS = useSettingsStore((state) => state.useCustomCSS);
  // OBS 모드는 데스크톱 오버레이 창을 파괴하고 위치를 OBS가 잡는다
  const obsModeEnabled = useSettingsStore((state) => state.obsModeEnabled);
  // 분리 패널 위치는 창이 떠 있을 때만 되돌릴 값이 있다
  const panelDetached = usePanelHostStore(
    (state) => state.placement === 'detached',
  );

  // 플러그인 메뉴 아이템
  const pluginKeyMenuItems = usePluginMenuStore((state) => state.keyMenuItems);
  const pluginGridMenuItems = usePluginMenuStore(
    (state) => state.gridMenuItems,
  );
  const pluginDefinitions = usePluginDisplayElementStore(
    (state) => state.definitions,
  );

  const pluginMessagesById = (() => {
    const map = new Map<string, PluginMessages>();
    pluginDefinitions.forEach((def) => {
      if (!map.has(def.pluginId)) {
        map.set(def.pluginId, def.messages);
      }
    });
    return map;
  })();

  const resolvePluginLabel = (pluginId: string, rawLabel: string) =>
    translatePluginMessage({
      messages: pluginMessagesById.get(pluginId),
      locale,
      key: rawLabel,
      fallback: rawLabel,
    });

  // 플러그인 predicate 예외는 fail-closed로 격리 - 하나가 던져도 메뉴 전체가 사라지지 않게
  // (요소 메뉴 evaluatePluginMenuItems와 같은 정책). 로그는 항목·종류별 1회
  const predicateErrorRef = useRef<Set<string>>(new Set());
  const reportPredicateError = (
    fullId: string,
    kind: 'visible' | 'disabled',
    error: unknown,
  ) => {
    const key = `${fullId}:${kind}`;
    if (predicateErrorRef.current.has(key)) return;
    predicateErrorRef.current.add(key);
    console.error(
      `[Plugin Menu] Failed to evaluate "${kind}" for '${fullId}':`,
      error,
    );
  };

  // 등록 순서를 그대로 유지한다 - 선택 핸들러가 fullId로 원본을 되찾는다
  const evaluatePluginItems = (
    items: PluginMenuItemInternal<unknown>[],
    context: unknown,
  ): MenuItem[] => {
    if (!context) return [];
    const evaluated: MenuItem[] = [];
    items.forEach((item) => {
      let visible = true;
      if (typeof item.visible === 'function') {
        try {
          visible = Boolean(item.visible(context));
        } catch (error) {
          reportPredicateError(item.fullId, 'visible', error);
          visible = false;
        }
      } else if (item.visible !== undefined) {
        visible = item.visible;
      }
      if (!visible) return;

      let disabled = false;
      if (typeof item.disabled === 'function') {
        try {
          disabled = Boolean(item.disabled(context));
        } catch (error) {
          reportPredicateError(item.fullId, 'disabled', error);
          disabled = true;
        }
      } else if (item.disabled !== undefined) {
        disabled = item.disabled;
      }

      evaluated.push({
        id: item.fullId,
        label: resolvePluginLabel(item.pluginId, item.label),
        disabled,
        isPlugin: true,
      });
    });
    return evaluated;
  };

  // 키 메뉴 아이템 생성 (기본 + 플러그인)
  const getKeyMenuItems = (
    contextIndex: number | null,
    contextElementId?: string | null,
  ): MenuItem[] => {
    const baseItems: MenuItem[] = [
      { id: 'delete', label: t('contextMenu.deleteKey') },
      { id: 'duplicate', label: t('contextMenu.duplicateKey') },
      { id: 'counterReset', label: t('contextMenu.counterReset') },
      { id: 'bringToFront', label: t('contextMenu.bringToFront') },
      // { id: "bringForward", label: t("contextMenu.bringForward") },
      // { id: "sendBackward", label: t("contextMenu.sendBackward") },
      { id: 'sendToBack', label: t('contextMenu.sendToBack') },
    ];

    // 플러그인 메뉴 필터링 (조건부 표시)
    // 예측자 context는 열림 시점 index가 아니라 요소 id로 재해석.
    // 메뉴가 열린 동안 재정렬돼도 원래 요소를 따라가고, 소실 시 fail-closed
    const modePositions = positions[selectedKeyType] ?? [];
    let resolvedIndex = contextIndex;
    if (contextElementId !== undefined) {
      const found =
        contextElementId === null
          ? -1
          : modePositions.findIndex(
              (position) => position.id === contextElementId,
            );
      resolvedIndex = found >= 0 ? found : null;
    }
    const keyPosition =
      resolvedIndex !== null ? modePositions[resolvedIndex] : undefined;
    const context: KeyContext | null =
      resolvedIndex !== null && keyPosition
        ? {
            // 플러그인 메뉴 표면은 canonical 문자열 유지
            keyCode: slotCanonical(
              keyMappings[selectedKeyType]?.[resolvedIndex] ?? '',
            ),
            id: keyPosition.id,
            index: resolvedIndex,
            position: keyPosition,
            mode: selectedKeyType,
          }
        : null;

    const topPluginItems = evaluatePluginItems(
      pluginKeyMenuItems.filter((i) => i.position === 'top'),
      context,
    );
    const bottomPluginItems = evaluatePluginItems(
      pluginKeyMenuItems.filter((i) => i.position !== 'top'),
      context,
    );

    return [...topPluginItems, ...baseItems, ...bottomPluginItems];
  };

  // 그리드 메뉴 아이템 생성 (기본 + 플러그인)
  const getStatMenuItems = (_contextIndex: number | null): MenuItem[] => [
    { id: 'delete', label: t('contextMenu.deleteStat') },
    { id: 'duplicate', label: t('contextMenu.duplicateStat') },
    { id: 'bringToFront', label: t('contextMenu.bringToFront') },
    { id: 'sendToBack', label: t('contextMenu.sendToBack') },
  ];

  const getGraphMenuItems = (_contextIndex: number | null): MenuItem[] => [
    { id: 'delete', label: t('contextMenu.deleteGraph') },
    { id: 'duplicate', label: t('contextMenu.duplicateGraph') },
    { id: 'bringToFront', label: t('contextMenu.bringToFront') },
    { id: 'sendToBack', label: t('contextMenu.sendToBack') },
  ];

  const getKnobMenuItems = (_contextIndex: number | null): MenuItem[] => [
    { id: 'delete', label: t('contextMenu.deleteKnob') },
    { id: 'duplicate', label: t('contextMenu.duplicateKnob') },
    { id: 'bringToFront', label: t('contextMenu.bringToFront') },
    { id: 'sendToBack', label: t('contextMenu.sendToBack') },
  ];

  const getGridMenuItems = (
    gridAddLocalPos: { dx: number; dy: number } | null,
  ): MenuEntry[] => {
    const topBaseItems: MenuItem[] = [
      { id: 'add', label: t('contextMenu.addKey') },
      { id: 'addStat', label: t('contextMenu.addStat') },
      { id: 'addGraph', label: t('contextMenu.addGraph') },
      { id: 'addKnob', label: t('contextMenu.addKnob') },
    ];
    // 묶음 안에서는 부모가 맥락을 주므로 라벨을 줄인다
    const tabItems: MenuItem[] = [
      {
        id: 'tabCss',
        label: t('contextMenu.cssSetting'),
        disabled: !useCustomCSS,
      },
      {
        id: 'tabNote',
        label: t('contextMenu.trackSetting'),
        disabled: !noteEffect,
      },
    ];
    const resetItems: MenuItem[] = [];
    // 오버레이가 화면 밖이거나 잠겨 있어도 닿을 수 있게 메인 창에도 노출
    if (!obsModeEnabled) {
      resetItems.push({
        id: 'resetOverlayPosition',
        label: t('contextMenu.overlayTarget'),
      });
    }
    // 분리 패널도 같은 이유 - 저장된 위치가 화면 밖이면 창으로는 손댈 수 없다.
    // 도킹 중에는 되돌릴 창이 없으므로 잠근다
    resetItems.push({
      id: 'resetPanelPosition',
      label: t('contextMenu.panelTarget'),
      disabled: !panelDetached,
    });

    // 플러그인 메뉴 필터링
    const context: GridContext | null = gridAddLocalPos
      ? {
          position: gridAddLocalPos,
          mode: selectedKeyType,
        }
      : null;

    // 설치 수와 무관하게 루트 길이를 고정한다 - 플러그인 항목은 묶음 하나로 접는다.
    // 여기서는 position이 자리를 정하지 못하므로 등록 순서를 그대로 쓴다.
    // 보이는 항목이 없으면 묶음 자체를 내지 않는다
    const pluginItems = evaluatePluginItems(pluginGridMenuItems, context);
    const pluginGroup: MenuItem[] = pluginItems.length
      ? [groupRow(PLUGIN_GROUP_ID, t('contextMenu.plugins'), pluginItems)]
      : [];

    // 추가 동작만 루트에 남기고 나머지는 묶음으로 접는다.
    // 루트 길이가 플러그인 설치 수와 무관하게 고정된다
    const groupRows: MenuItem[] = [
      ...pluginGroup,
      groupRow('tabGroup', t('contextMenu.currentTabGroup'), tabItems),
      groupRow('resetGroup', t('contextMenu.resetPositionGroup'), resetItems),
    ];

    return joinMenuGroups([topBaseItems, groupRows]);
  };

  return {
    getKeyMenuItems,
    getStatMenuItems,
    getGraphMenuItems,
    getKnobMenuItems,
    getGridMenuItems,
    pluginKeyMenuItems,
    pluginGridMenuItems,
    resolvePluginLabel,
  };
}
