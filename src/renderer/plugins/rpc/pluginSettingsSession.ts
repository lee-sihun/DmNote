/**
 * 플러그인 설정 세션 state machine (C3, main 소유)
 * 세션당 settle은 정확히 1회 - confirm/cancel/치환/plugin unload/창 파괴 어느 경로든
 * 렌더 lease 이동(reattach 포함)은 세션을 취소하지 않고 새 owner 창으로 이전하되
 * 예기치 못한 패널 파괴는 settleOnce(false)로 종료
 */

import {
  usePropertiesPanelStore,
  type PluginSettingsPanelPayload,
} from '@stores/grid/usePropertiesPanelStore';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { resolveSettingsSchemaForValues } from '@utils/plugin/panelModelSync';

import { getPluginAuthorityGeneration } from './pluginRpcClient';
import {
  SETTINGS_SESSION_OPEN_MESSAGE,
  SETTINGS_SESSION_UPDATE_MESSAGE,
  SETTINGS_SESSION_CLOSE_MESSAGE,
  SETTINGS_SESSION_REQUEST_MESSAGE,
  SETTINGS_SESSION_OPERATIONS,
  type PluginSettingsSessionDescriptor,
  type PluginSettingsSessionUpdate,
  type PluginSettingsSessionClose,
} from './settingsSessionWire';

type SessionState = 'active' | 'transferring' | 'confirming' | 'settled';

interface SessionRecord {
  sessionId: string;
  pluginId: string;
  payload: PluginSettingsPanelPayload;
  state: SessionState;
  owner: 'main' | 'panel';
  // lease 이동마다 전진 - 이전 owner의 늦은 op 거절 기준
  leaseEpoch: number;
  lastSeq: number;
  currentSettings: Record<string, unknown>;
  // owner가 main일 때 store에 올린 wrapped payload - 소유 view 식별용
  mainViewPayload: PluginSettingsPanelPayload | null;
  // 마지막으로 push한 descriptor generation - close 메시지에 동봉
  descriptorGeneration: number;
}

let session: SessionRecord | null = null;
// descriptor push 단조 카운터 - 늦은 open이 새 세션을 덮지 않게 하는 게이트
let descriptorGenerationCounter = 0;

const closeMainView = (record: SessionRecord) => {
  const store = usePropertiesPanelStore.getState();
  if (
    record.mainViewPayload &&
    store.pluginSettingsPanel === record.mainViewPayload
  ) {
    store.closePluginSettingsPanel();
  }
  record.mainViewPayload = null;
};

const sendPanelClose = (record: SessionRecord) => {
  const message: PluginSettingsSessionClose = {
    sessionId: record.sessionId,
    descriptorGeneration: record.descriptorGeneration,
  };
  sendBridgeMessageBestEffort('panel', SETTINGS_SESSION_CLOSE_MESSAGE, message);
};

// settle 1회 보장 - terminal 이후 모든 경로는 no-op
const settleOnce = async (
  record: SessionRecord,
  confirmed: boolean,
  finalSettings?: Record<string, unknown>,
): Promise<void> => {
  if (record.state === 'settled') return;
  record.state = 'settled';
  if (session === record) session = null;

  closeMainView(record);
  sendPanelClose(record);

  const { payload } = record;
  if (confirmed) {
    try {
      await payload.onConfirm(
        finalSettings ?? record.currentSettings,
        payload.originalSettings,
      );
      payload.resolve(true);
    } catch (error) {
      console.error('[Plugin Settings] Failed to apply settings:', error);
      payload.resolve(false);
    }
    return;
  }
  try {
    payload.onCancel(payload.originalSettings);
  } catch (error) {
    console.error('[Plugin Settings] Failed to cancel settings:', error);
  }
  payload.resolve(false);
};

const buildDescriptor = (
  record: SessionRecord,
): PluginSettingsSessionDescriptor => ({
  sessionId: record.sessionId,
  pluginId: record.pluginId,
  leaseEpoch: record.leaseEpoch,
  descriptorGeneration: record.descriptorGeneration,
  lastSeq: record.lastSeq,
  authorityGeneration: getPluginAuthorityGeneration(),
  settings: { ...record.currentSettings },
  originalSettings: { ...record.payload.originalSettings },
  resolvedSchema: resolveSettingsSchemaForValues(
    record.payload.definition.settings,
    record.currentSettings,
  ),
  messages: record.payload.definition.messages,
});

const pushOpenDescriptor = (record: SessionRecord) => {
  descriptorGenerationCounter += 1;
  record.descriptorGeneration = descriptorGenerationCounter;
  sendBridgeMessageBestEffort(
    'panel',
    SETTINGS_SESSION_OPEN_MESSAGE,
    buildDescriptor(record),
  );
};

const pushSchemaUpdate = (record: SessionRecord) => {
  const message: PluginSettingsSessionUpdate = {
    sessionId: record.sessionId,
    leaseEpoch: record.leaseEpoch,
    resolvedSchema: resolveSettingsSchemaForValues(
      record.payload.definition.settings,
      record.currentSettings,
    ),
  };
  sendBridgeMessageBestEffort(
    'panel',
    SETTINGS_SESSION_UPDATE_MESSAGE,
    message,
  );
};

// main owner일 때 인라인 패널 view로 세션을 연결
// 모든 wrapped 콜백은 record가 여전히 현재 세션의 main lease인지 게이트
const openMainView = (record: SessionRecord) => {
  const isLive = () =>
    session === record && record.owner === 'main' && record.state !== 'settled';

  const wrapped: PluginSettingsPanelPayload = {
    ...record.payload,
    settings: { ...record.currentSettings },
    onChange: (next) => {
      if (!isLive()) return;
      record.currentSettings = { ...next };
      record.payload.onChange(next);
    },
    onConfirm: async (next) => {
      if (!isLive()) return;
      record.state = 'confirming';
      await settleOnce(record, true, { ...next });
    },
    onCancel: () => {
      if (record.state === 'settled') return;
      void settleOnce(record, false);
    },
    resolve: () => {},
  };
  record.mainViewPayload = wrapped;
  usePropertiesPanelStore.getState().openPluginSettingsPanel(wrapped);
};

// 세션 이전의 공통 경로 - lease 이동마다 epoch 전진
const transferToPanel = (record: SessionRecord) => {
  record.owner = 'panel';
  record.state = 'transferring';
  record.leaseEpoch += 1;
  closeMainView(record);
  // 창 생성 전 유실은 panel의 request 재요청으로 복구
  pushOpenDescriptor(record);
};

const transferToMain = (record: SessionRecord) => {
  record.owner = 'main';
  record.state = 'active';
  record.leaseEpoch += 1;
  sendPanelClose(record);
  openMainView(record);
};

/**
 * defineSettings의 openSettingsPanel 진입점
 * 현재 렌더 lease 보유 창을 owner로 결정해 view를 연다
 */
export const openPluginSettingsSession = (
  payload: PluginSettingsPanelPayload,
): void => {
  if (session) {
    void settleOnce(session, false);
  }

  const record: SessionRecord = {
    sessionId: crypto.randomUUID(),
    pluginId: payload.pluginId,
    payload,
    state: 'active',
    owner: 'main',
    leaseEpoch: 0,
    lastSeq: 0,
    currentSettings: { ...payload.settings },
    mainViewPayload: null,
    descriptorGeneration: 0,
  };
  session = record;

  // 패널 호스트는 메인 React 트리의 portal이라 어디에 붙어 있든 메인 뷰가 곧 패널 뷰다
  openMainView(record);
};

/** plugin unload·runtime reload 시 해당 플러그인 세션 강제 settle(false) */
export const cancelPluginSettingsSessionForPlugin = (
  pluginId: string,
): void => {
  if (session && session.pluginId === pluginId) {
    void settleOnce(session, false);
  }
};

/**
 * plugin RPC router에서 위임되는 settings 세션 op 처리
 * 세션 식별(sessionId+leaseEpoch)과 단조 seq로 게이트 - 모델 revision과 무관
 */
export const handlePluginSettingsOperation = (
  operation: string,
  payload: Record<string, unknown>,
): string | null => {
  const record = session;
  const sessionId = payload.sessionId;
  if (
    typeof sessionId !== 'string' ||
    !record ||
    record.sessionId !== sessionId ||
    record.state === 'settled'
  ) {
    return 'SESSION_STALE';
  }
  // 이전 lease의 늦은 op는 세션이 살아 있어도 거절
  if (payload.leaseEpoch !== record.leaseEpoch) {
    return 'SESSION_LEASE_STALE';
  }

  if (operation === SETTINGS_SESSION_OPERATIONS.mounted) {
    if (record.state === 'transferring') record.state = 'active';
    return null;
  }

  if (operation === SETTINGS_SESSION_OPERATIONS.change) {
    // lease 이전 중 입력 중지 - mount ACK 이후에만 수용
    if (record.owner !== 'panel' || record.state !== 'active') {
      return 'SESSION_NOT_ACTIVE';
    }
    const seq = payload.seq;
    const settings = payload.settings;
    if (typeof seq !== 'number' || !settings || typeof settings !== 'object') {
      return 'INVALID_PAYLOAD';
    }
    if (seq <= record.lastSeq) return 'SEQ_STALE';
    record.lastSeq = seq;
    record.currentSettings = { ...(settings as Record<string, unknown>) };
    try {
      record.payload.onChange(record.currentSettings);
    } catch (error) {
      console.error('[Plugin Settings] onChange preview failed:', error);
    }
    // visibility 재평가는 main이 수행해 panel로 되돌려줌
    pushSchemaUpdate(record);
    return null;
  }

  if (operation === SETTINGS_SESSION_OPERATIONS.confirm) {
    if (record.owner !== 'panel') return 'SESSION_NOT_ACTIVE';
    const settings = payload.settings;
    if (!settings || typeof settings !== 'object') return 'INVALID_PAYLOAD';
    const seq = payload.lastSeq;
    if (typeof seq === 'number' && seq > record.lastSeq) {
      record.lastSeq = seq;
    }
    record.state = 'confirming';
    void settleOnce(record, true, {
      ...(settings as Record<string, unknown>),
    });
    return null;
  }

  if (operation === SETTINGS_SESSION_OPERATIONS.cancel) {
    if (record.owner !== 'panel') return 'SESSION_NOT_ACTIVE';
    void settleOnce(record, false);
    return null;
  }

  return 'UNSUPPORTED_OPERATION';
};

/**
 * bootstrap의 panel:visibility 핸들러에서 호출 (main 전용, 이벤트는 전이 시에만 발생)
 * reattach·정상 close는 세션을 main으로 이전, 예기치 못한 파괴는 settleOnce(false)
 */
export const notePanelVisibilityForSettingsSession = (
  visible: boolean,
  reason?: string,
): void => {
  const record = session;
  if (!record || record.state === 'settled') return;

  if (visible) {
    if (record.owner !== 'main') return;
    transferToPanel(record);
    return;
  }
  if (record.owner !== 'panel') return;
  if (reason === 'destroyed') {
    // 파괴는 이전이 아니라 종료 (C3) - 편집 중 값은 폐기, 플러그인 promise는 false
    void settleOnce(record, false);
    return;
  }
  transferToMain(record);
};

let hostStarted = false;

/**
 * main 창 bootstrap에서 1회 호출 - panel의 descriptor 재요청 수신 배선
 * lease 이동은 notePanelVisibilityForSettingsSession가 담당
 */
export const initPluginSettingsSessionHost = (): (() => void) => {
  if (hostStarted) return () => {};
  hostStarted = true;

  const unsubscribeRequest = window.api.bridge.on(
    SETTINGS_SESSION_REQUEST_MESSAGE,
    () => {
      const record = session;
      if (!record || record.state === 'settled' || record.owner !== 'panel') {
        return;
      }
      pushOpenDescriptor(record);
    },
  );

  return () => {
    hostStarted = false;
    unsubscribeRequest?.();
  };
};
