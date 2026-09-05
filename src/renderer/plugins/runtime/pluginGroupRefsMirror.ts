/**
 * store 저장 인스턴스의 그룹 참조 미러 (main 창 전용)
 * 미로드·데이터만 남은 플러그인의 저장 인스턴스도 백엔드 그룹 생존 판정에
 * 포함되므로, 부트스트랩 1회 pull + pluginInstances:changed마다 재pull로
 * normalize replay의 모집단을 백엔드와 일치시킨다
 */

import {
  pluginInstancesApi,
  type PluginGroupRefsByPlugin,
} from '@api/modules/plugin/pluginInstancesApi';
import { registerStoredPluginGroupRefsProvider } from '@src/renderer/editor/runtime/intent/pluginGroupMembers';

let refs: PluginGroupRefsByPlugin = {};
let appliedRevision = -1;

const pull = async (): Promise<void> => {
  const snapshot = await pluginInstancesApi.groupRefsGet();
  // 늦게 도착한 낡은 pull의 역행 방지 (동일 revision 재적용은 무해)
  if (snapshot.modelRevision < appliedRevision) return;
  appliedRevision = snapshot.modelRevision;
  refs = snapshot.refs;
};

const pullBestEffort = (): void => {
  void pull().catch((error) => {
    console.error('[PluginGroupRefs] Failed to pull group refs mirror:', error);
  });
};

/** main 창 bootstrap에서 1회 호출 */
export const initPluginGroupRefsMirror = (): (() => void) => {
  registerStoredPluginGroupRefsProvider(() => refs);
  const unsubscribe = pluginInstancesApi.onChanged(() => {
    // commit·undo/redo 복원·플러그인 데이터 삭제 전부 이 이벤트로 수렴 -
    // payload가 작아 플러그인 구분 없이 전체 재pull
    pullBestEffort();
  });
  pullBestEffort();
  return () => {
    unsubscribe?.();
    registerStoredPluginGroupRefsProvider(() => ({}));
    refs = {};
    appliedRevision = -1;
  };
};
