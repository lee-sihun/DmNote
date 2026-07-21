import { invoke } from '@tauri-apps/api/core';

import { subscribe } from './shared';

// 창 간 플러그인 RPC wire 계약 (Rust plugin_rpc_send/respond와 필드 단위 동일)
export interface PluginRpcRequest {
  protocolVersion: 1;
  requestId: string;
  authorityGeneration: number;
  expectedModelRevision: number;
  operation: string;
  payload: Record<string, unknown>;
}

export interface PluginRpcRequestEnvelope extends PluginRpcRequest {
  // Rust가 검증·주입한 발신 창 label
  sourceWindowLabel: string;
}

export interface PluginRpcError {
  code: string;
  message: string;
}

// Rust PluginRpcResponse는 deny_unknown_fields - 필드 추가·생략 불가
export interface PluginRpcResponse {
  protocolVersion: number;
  requestId: string;
  authorityGeneration: number;
  modelRevision: number;
  ok: boolean;
  payload?: Record<string, unknown> | null;
  error?: PluginRpcError | null;
}

export interface PluginAuthoritySnapshot {
  authorityGeneration: number;
  modelRevision: number;
}

export const PLUGIN_RPC_PROTOCOL_VERSION = 1 as const;

export const pluginRpcApi = {
  send: (targetWindowLabel: string, request: PluginRpcRequest) =>
    invoke<void>('plugin_rpc_send', { targetWindowLabel, request }),
  respond: (targetWindowLabel: string, response: PluginRpcResponse) =>
    invoke<void>('plugin_rpc_respond', { targetWindowLabel, response }),
  authorityReset: () =>
    invoke<PluginAuthoritySnapshot>('plugin_authority_reset'),
  onRequest: (listener: (envelope: PluginRpcRequestEnvelope) => void) =>
    subscribe<PluginRpcRequestEnvelope>('plugin-rpc:request', listener),
  onResponse: (listener: (response: PluginRpcResponse) => void) =>
    subscribe<PluginRpcResponse>('plugin-rpc:response', listener),
  onAuthorityChanged: (listener: (snapshot: PluginAuthoritySnapshot) => void) =>
    subscribe<PluginAuthoritySnapshot>(
      'plugin-rpc:authority-changed',
      listener,
    ),
};
