/**
 * backend canonical plugin_model_revision의 main 렌더러 추적 (H1)
 * Rust plugin_rpc_send가 expectedModelRevision을 이 값과 정확 일치로 게이트하므로
 * RPC와 스냅샷의 revision 도메인은 반드시 backend 값이어야 한다
 * 출처: authorityReset·plugin_instances_commit 결과·plugin_instances_get·changed 이벤트
 */

let backendPluginRevision = 0;

export const noteBackendPluginRevision = (revision: number): void => {
  if (typeof revision === 'number' && revision > backendPluginRevision) {
    backendPluginRevision = revision;
  }
};

export const getBackendPluginRevision = (): number => backendPluginRevision;
