/**
 * Grid 컨텍스트 메뉴 관련 로직 훅
 * - 키 컨텍스트 메뉴 항목 생성
 * - 그리드 컨텍스트 메뉴 항목 생성
 */

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

interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  isPlugin?: boolean;
}

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
  ) => MenuItem[];
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

    const filterPluginItems = (
      items: PluginMenuItemInternal<unknown>[],
    ): MenuItem[] => {
      if (!context) return [];
      return items
        .filter((item) => {
          // visible 체크
          if (item.visible === false) return false;
          if (typeof item.visible === 'function' && !item.visible(context))
            return false;
          return true;
        })
        .map((item) => ({
          id: item.fullId,
          label: resolvePluginLabel(item.pluginId, item.label),
          disabled:
            typeof item.disabled === 'function'
              ? item.disabled(context)
              : item.disabled || false,
          isPlugin: true,
        }));
    };

    const topPluginItems = filterPluginItems(
      pluginKeyMenuItems.filter((i) => i.position === 'top'),
    );
    const bottomPluginItems = filterPluginItems(
      pluginKeyMenuItems.filter((i) => i.position !== 'top'),
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
  ): MenuItem[] => {
    const topBaseItems: MenuItem[] = [
      { id: 'add', label: t('contextMenu.addKey') },
      { id: 'addStat', label: t('contextMenu.addStat') },
      { id: 'addGraph', label: t('contextMenu.addGraph') },
      { id: 'addKnob', label: t('contextMenu.addKnob') },
    ];
    const bottomBaseItems: MenuItem[] = [
      {
        id: 'tabCss',
        label: t('contextMenu.tabCssSetting'),
        disabled: !useCustomCSS,
      },
      {
        id: 'tabNote',
        label: t('contextMenu.tabNoteSetting'),
        disabled: !noteEffect,
      },
    ];
    // 오버레이가 화면 밖이거나 잠겨 있어도 닿을 수 있게 메인 창에도 노출
    if (!obsModeEnabled) {
      bottomBaseItems.push({
        id: 'resetOverlayPosition',
        label: t('contextMenu.resetOverlayPosition'),
      });
    }

    // 플러그인 메뉴 필터링
    const context: GridContext | null = gridAddLocalPos
      ? {
          position: gridAddLocalPos,
          mode: selectedKeyType,
        }
      : null;

    const filterPluginItems = (
      items: PluginMenuItemInternal<unknown>[],
    ): MenuItem[] => {
      if (!context) return [];
      return items
        .filter((item) => {
          if (item.visible === false) return false;
          if (typeof item.visible === 'function' && !item.visible(context))
            return false;
          return true;
        })
        .map((item) => ({
          id: item.fullId,
          label: resolvePluginLabel(item.pluginId, item.label),
          disabled:
            typeof item.disabled === 'function'
              ? item.disabled(context)
              : item.disabled || false,
          isPlugin: true,
        }));
    };

    const topPluginItems = filterPluginItems(
      pluginGridMenuItems.filter((i) => i.position === 'top'),
    );
    const bottomPluginItems = filterPluginItems(
      pluginGridMenuItems.filter((i) => i.position !== 'top'),
    );

    return [
      ...topPluginItems,
      ...topBaseItems,
      ...bottomPluginItems,
      ...bottomBaseItems,
    ];
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
