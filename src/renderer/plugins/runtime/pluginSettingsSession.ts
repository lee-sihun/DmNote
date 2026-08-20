/**
 * 플러그인 설정 세션 state machine (main 소유)
 * 세션당 settle은 정확히 1회 - confirm/cancel/치환/plugin unload 어느 경로든.
 * 패널은 메인 React 트리의 portal이라 어디에 붙어 있든 인라인 뷰가 곧 패널 뷰다
 */

import {
  usePropertiesPanelStore,
  type PluginSettingsPanelPayload,
} from '@stores/grid/usePropertiesPanelStore';

type SessionState = 'active' | 'confirming' | 'settled';

interface SessionRecord {
  pluginId: string;
  payload: PluginSettingsPanelPayload;
  state: SessionState;
  currentSettings: Record<string, unknown>;
  // store에 올린 wrapped payload - 소유 view 식별용
  viewPayload: PluginSettingsPanelPayload | null;
}

let session: SessionRecord | null = null;

const closeView = (record: SessionRecord) => {
  const store = usePropertiesPanelStore.getState();
  if (record.viewPayload && store.pluginSettingsPanel === record.viewPayload) {
    store.closePluginSettingsPanel();
  }
  record.viewPayload = null;
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

  closeView(record);

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

// 인라인 패널 view로 세션을 연결 - 모든 wrapped 콜백은 record가 여전히 현재 세션인지 게이트
const openView = (record: SessionRecord) => {
  const isLive = () => session === record && record.state !== 'settled';

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
  record.viewPayload = wrapped;
  usePropertiesPanelStore.getState().openPluginSettingsPanel(wrapped);
};

/** defineSettings의 openSettingsPanel 진입점 - 이전 세션은 취소로 정리하고 교체 */
export const openPluginSettingsSession = (
  payload: PluginSettingsPanelPayload,
): void => {
  if (session) {
    void settleOnce(session, false);
  }

  const record: SessionRecord = {
    pluginId: payload.pluginId,
    payload,
    state: 'active',
    currentSettings: { ...payload.settings },
    viewPayload: null,
  };
  session = record;
  openView(record);
};

/** plugin unload·runtime reload 시 해당 플러그인 세션 강제 settle(false) */
export const cancelPluginSettingsSessionForPlugin = (
  pluginId: string,
): void => {
  if (session && session.pluginId === pluginId) {
    void settleOnce(session, false);
  }
};
