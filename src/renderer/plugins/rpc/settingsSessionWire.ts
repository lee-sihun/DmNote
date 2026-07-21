import type {
  PluginMessages,
  PluginResolvedSettingSchema,
} from '@src/types/plugin/api';

// 플러그인 설정 세션 wire 계약 (C3)
// main이 세션 소유 - panel은 직렬화 descriptor를 렌더하고 RPC로 입력을 왕복

// main → panel (bridge push)
export const SETTINGS_SESSION_OPEN_MESSAGE = 'plugin:settingsSession:open';
export const SETTINGS_SESSION_UPDATE_MESSAGE = 'plugin:settingsSession:update';
export const SETTINGS_SESSION_CLOSE_MESSAGE = 'plugin:settingsSession:close';
// panel → main (bridge, 창 생성 전 push 유실 복구)
export const SETTINGS_SESSION_REQUEST_MESSAGE =
  'plugin:settingsSession:request';

// panel → main (plugin RPC router 경유)
export const SETTINGS_SESSION_OPERATIONS = {
  mounted: 'settings:mounted',
  change: 'settings:change',
  confirm: 'settings:confirm',
  cancel: 'settings:cancel',
} as const;

export interface PluginSettingsSessionDescriptor {
  sessionId: string;
  pluginId: string;
  // lease 이동마다 전진 - 이전 owner의 늦은 op 식별
  leaseEpoch: number;
  // descriptor push마다 전진 - 늦게 도착한 open이 새 세션을 덮지 않게 하는 단조 게이트
  descriptorGeneration: number;
  // seq는 세션 단조 - 소유권 이전 시 이어서 증가
  lastSeq: number;
  authorityGeneration: number;
  settings: Record<string, unknown>;
  originalSettings: Record<string, unknown>;
  // visible 함수는 main이 평가한 boolean으로 치환된 스키마
  resolvedSchema: Record<string, PluginResolvedSettingSchema>;
  messages?: PluginMessages;
}

export interface PluginSettingsSessionUpdate {
  sessionId: string;
  leaseEpoch: number;
  resolvedSchema: Record<string, PluginResolvedSettingSchema>;
}

export interface PluginSettingsSessionClose {
  sessionId: string;
  descriptorGeneration: number;
}
