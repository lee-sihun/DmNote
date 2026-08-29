/**
 * 탭 순서 유틸
 * 내장 모드와 커스텀 탭을 하나의 순서 목록으로 다룬다.
 * 툴바 바는 앞 barCount개, 팝업은 그 나머지를 그린다.
 *
 * 자리를 바꾸는 길은 교체 하나뿐이라 barCount는 드래그로 변하지 않는다.
 * 바는 늘 같은 칸 수를 지키고, 팝업 탭을 바에 올리려면 바에 있는 탭과 바꾼다
 */

import { BUILTIN_KEY_MODES } from '@src/renderer/constants/keyModes';
import type { CustomTab } from '@src/types/key/keys';

// 창이 902px 고정이라 바에 들어갈 수 있는 칸의 상한이 정해져 있다.
// 하한이 1인 것은 바가 비면 탭을 바꿀 길이 사라지기 때문
export const MAX_BAR_SLOTS = 4;
export const MIN_BAR_SLOTS = 1;

export interface TabPlacement {
  order: string[];
  barCount: number;
}

export const clampBarCount = (barCount: number, orderLength: number) =>
  Math.max(
    MIN_BAR_SLOTS,
    Math.min(MAX_BAR_SLOTS, orderLength, Math.floor(barCount) || MIN_BAR_SLOTS),
  );

export interface OrderedTab {
  id: string;
  name: string;
  isBuiltin: boolean;
}

export const isBuiltinTabId = (id: string): boolean =>
  (BUILTIN_KEY_MODES as readonly string[]).includes(id);

/**
 * 표시 순서의 탭 id
 *
 * 실체가 없는 id는 버린다. tabOrder가 아직 비어 있으면(부트스트랩 전) 내장 순서로
 * 폴백한다. 이름이 필요 없는 곳 - 단축키 순환, 오버레이 컨텍스트 메뉴 - 이 쓴다
 */
export const orderedTabIds = (
  tabOrder: string[],
  customTabs: CustomTab[],
): string[] => {
  const customIds = new Set(customTabs.map((tab) => tab.id));
  const source: readonly string[] =
    tabOrder.length > 0 ? tabOrder : BUILTIN_KEY_MODES;
  return source.filter((id) => isBuiltinTabId(id) || customIds.has(id));
};

/**
 * 순서대로 배열한 탭 목록
 * 내장 이름은 번역에서 파생하고 CustomTab.name에는 커스텀 이름만 있다
 */
export const buildOrderedTabs = (
  tabOrder: string[],
  customTabs: CustomTab[],
  translateBuiltin: (id: string) => string,
): OrderedTab[] => {
  const byId = new Map(customTabs.map((tab) => [tab.id, tab]));
  return orderedTabIds(tabOrder, customTabs).map((id) =>
    isBuiltinTabId(id)
      ? { id, name: translateBuiltin(id), isBuiltin: true }
      : { id, name: byId.get(id)?.name ?? id, isBuiltin: false },
  );
};

/** 내장 모드 라벨 키 - '4key' -> 'mode.button4' */
export const builtinTabLabelKey = (id: string) =>
  `mode.button${id.replace('key', '')}`;

/**
 * 두 탭의 자리를 맞바꾼다
 * 바는 칸이 고정이라 끼워넣기보다 교체가 맞다. 바에 있던 탭과 팝업에 있던 탭을
 * 바꾸면 바에 있는 개수는 그대로다
 */
export const swapTabs = (
  placement: TabPlacement,
  a: string,
  b: string,
): TabPlacement => {
  if (a === b) return placement;
  const first = placement.order.indexOf(a);
  const second = placement.order.indexOf(b);
  if (first < 0 || second < 0) return placement;
  const order = [...placement.order];
  order[first] = b;
  order[second] = a;
  return { order, barCount: placement.barCount };
};
