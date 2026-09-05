import { invoke } from '@tauri-apps/api/core';

import { subscribe } from '../shared';

// 플러그인 인스턴스 canonical API wire 계약 (C4, Rust plugin_instances_*와 동일)
export interface SavedPluginInstanceWire {
  // 영구 인스턴스 ID (UUID) - backfill 전 구데이터는 없을 수 있음
  instanceId?: string;
  position: { x: number; y: number };
  settings?: Record<string, unknown>;
  measuredSize?: { width: number; height: number };
  tabId?: string;
  hidden?: boolean;
  zIndex?: number;
  // 레이어 그룹 소속 - normalize된 tabId 모드의 그룹만 유효
  groupId?: string;
}

export interface PluginInstancesCommitRequest {
  pluginId: string;
  instances: SavedPluginInstanceWire[];
  mutationId: string;
  gestureId?: string;
  observedHistoryEpoch?: number;
  expectedModelRevision?: number;
  authorityGeneration: number;
}

export interface PluginInstancesReconcileRequest {
  pluginId: string;
  validTabIds: string[];
  mutationId: string;
  observedHistoryEpoch?: number;
  authorityGeneration: number;
}

export interface PluginInstancesCommitResult {
  pluginId: string;
  modelRevision: number;
  authorityGeneration: number;
  changed: boolean;
}

export interface PluginInstancesSnapshot {
  pluginId: string;
  instances: SavedPluginInstanceWire[];
  modelRevision: number;
  authorityGeneration: number;
}

export interface PluginInstancesChangedPayload {
  pluginId: string;
  revision: number;
  // commit 발신 mutation id - undo/redo 복원 이벤트에는 없음 (self-echo 구분)
  originMutationId?: string;
}

// 전 플러그인 저장 인스턴스의 그룹 참조 - pluginId → normalize 모드 → 그룹 id 목록
export type PluginGroupRefsByPlugin = Record<string, Record<string, string[]>>;

export interface PluginGroupRefsSnapshot {
  refs: PluginGroupRefsByPlugin;
  modelRevision: number;
}

export const pluginInstancesApi = {
  commit: (request: PluginInstancesCommitRequest, rpcRequestId?: string) =>
    invoke<PluginInstancesCommitResult>('plugin_instances_commit', {
      request,
      rpcRequestId: rpcRequestId ?? null,
    }),
  // 탭 정리 - 읽기·필터·커밋을 백엔드 단일 write-lock에서 원자 수행
  reconcile: (request: PluginInstancesReconcileRequest) =>
    invoke<PluginInstancesCommitResult>('plugin_instances_reconcile', {
      request,
    }),
  get: (pluginId: string) =>
    invoke<PluginInstancesSnapshot>('plugin_instances_get', { pluginId }),
  // 미로드 플러그인 포함 전 저장 인스턴스의 그룹 참조 (normalize 모집단 미러용)
  groupRefsGet: () => invoke<PluginGroupRefsSnapshot>('plugin_group_refs_get'),
  onChanged: (listener: (payload: PluginInstancesChangedPayload) => void) =>
    subscribe<PluginInstancesChangedPayload>(
      'pluginInstances:changed',
      listener,
    ),
};
