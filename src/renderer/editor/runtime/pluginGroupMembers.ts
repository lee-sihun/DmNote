// 그룹 normalize 재생용 플러그인 멤버 제공자
// coordinator가 plugin store를 직접 import하면 순환 참조가 생기므로
// store 모듈이 로드 시점에 자신을 등록한다 (등록 전에는 빈 목록)
//
// 백엔드 생존 판정은 store의 전 plugin_data 인스턴스를 보므로, 로드된
// 플러그인의 런타임 요소만 반환하면 미로드·데이터만 남은 플러그인의 그룹
// 참조가 빠져 replay 예측이 어긋난다. 로드된 플러그인은 런타임 요소가
// 원본 (eager 로컬 변경이 커밋 동봉분과 일치해야 함), 미로드 플러그인은
// store 미러의 그룹 참조로 보충해 모집단을 백엔드와 일치시킨다

import type { PluginGroupMemberLike } from '@utils/layerGroupUtils';
import type { PluginGroupRefsByPlugin } from '@api/modules/pluginInstancesApi';

const EMPTY_MEMBERS: readonly PluginGroupMemberLike[] = [];
const EMPTY_PLUGIN_IDS: ReadonlySet<string> = new Set();
const EMPTY_REFS: PluginGroupRefsByPlugin = {};

let provider: () => readonly PluginGroupMemberLike[] = () => EMPTY_MEMBERS;
let loadedPluginIdsProvider: () => ReadonlySet<string> = () => EMPTY_PLUGIN_IDS;
let storedRefsProvider: () => PluginGroupRefsByPlugin = () => EMPTY_REFS;

export const registerPluginGroupMemberProvider = (
  next: () => readonly PluginGroupMemberLike[],
): void => {
  provider = next;
};

/** 로드 판별 - 여기 포함된 플러그인은 런타임 요소가 그룹 멤버 원본 */
export const registerLoadedPluginIdsProvider = (
  next: () => ReadonlySet<string>,
): void => {
  loadedPluginIdsProvider = next;
};

/** store 미러의 그룹 참조 - 미러 미초기화 창은 빈 목록 폴백 유지 */
export const registerStoredPluginGroupRefsProvider = (
  next: () => PluginGroupRefsByPlugin,
): void => {
  storedRefsProvider = next;
};

export const currentPluginGroupMembers =
  (): readonly PluginGroupMemberLike[] => {
    const members: PluginGroupMemberLike[] = [...provider()];
    const loaded = loadedPluginIdsProvider();
    for (const [pluginId, byMode] of Object.entries(storedRefsProvider())) {
      if (loaded.has(pluginId)) continue;
      for (const [mode, groupIds] of Object.entries(byMode)) {
        for (const groupId of groupIds) {
          // 미러의 mode는 이미 normalize된 값이라 tabId로 그대로 사용 가능
          members.push({ tabId: mode, groupId });
        }
      }
    }
    return members;
  };
