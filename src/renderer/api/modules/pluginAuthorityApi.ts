import { invoke } from '@tauri-apps/api/core';

export interface PluginAuthoritySnapshot {
  authorityGeneration: number;
  modelRevision: number;
}

// 플러그인 런타임 authority - 메인이 런타임을 (재)시작할 때 generation을 올린다
export const pluginAuthorityApi = {
  reset: () => invoke<PluginAuthoritySnapshot>('plugin_authority_reset'),
};
