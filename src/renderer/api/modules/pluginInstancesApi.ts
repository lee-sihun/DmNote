import { invoke } from '@tauri-apps/api/core';

import { subscribe } from './shared';

// 플러그인 인스턴스 canonical API wire 계약 (C4, Rust plugin_instances_*와 동일)
export interface SavedPluginInstanceWire {
  position: { x: number; y: number };
  settings?: Record<string, unknown>;
  measuredSize?: { width: number; height: number };
  tabId?: string;
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
  onChanged: (listener: (payload: PluginInstancesChangedPayload) => void) =>
    subscribe<PluginInstancesChangedPayload>(
      'pluginInstances:changed',
      listener,
    ),
};
