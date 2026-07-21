/**
 * 분리 패널의 플러그인 설정 세션 미러 (C3)
 * main이 push한 직렬화 descriptor를 기존 PluginSettingsPanelView 계약으로 렌더하고
 * 입력(onChange/confirm/cancel)은 RPC로 main 세션에 왕복 - settle 판단은 main 소유
 */

import {
  usePropertiesPanelStore,
  type PluginSettingsPanelPayload,
} from '@stores/grid/usePropertiesPanelStore';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import type { PluginSettingsDefinition } from '@src/types/plugin/api';

import {
  sendPluginRpc,
  setPluginAuthorityGeneration,
  type PluginRpcOutcome,
} from './pluginRpcClient';
import { currentAuthorityModelRevision } from './pluginElementActions';
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

interface MirrorRecord {
  sessionId: string;
  leaseEpoch: number;
  descriptorGeneration: number;
  seq: number;
  // 패널 로컬 최신 편집값 - 스키마 update 재구성 시 리셋 방지용
  lastLocalSettings: Record<string, unknown>;
  lastAckedSeq: number;
  mounted: boolean;
  mountInFlight: Promise<boolean> | null;
  pendingChange: Record<string, unknown> | null;
  changePump: Promise<boolean> | null;
  terminal: 'open' | 'confirming' | 'canceling';
  terminalPromise: Promise<boolean> | null;
  payload: PluginSettingsPanelPayload;
}

let current: MirrorRecord | null = null;
// 수용한 descriptor generation 단조 - close보다 늦게 도착한 open 거절
let lastAppliedGeneration = 0;

// main이 이미 settle한 세션의 view 정리 - onCancel 왕복 없이 닫는다
const closeLocal = () => {
  if (!current) return;
  current = null;
  usePropertiesPanelStore.setState({ pluginSettingsPanel: null });
};

const sendSessionOp = (operation: string, payload: Record<string, unknown>) =>
  sendPluginRpc(operation, payload, currentAuthorityModelRevision());

const isSessionGone = (errorCode: string) =>
  errorCode === 'SESSION_STALE' ||
  errorCode === 'SESSION_LEASE_STALE' ||
  errorCode === 'AUTHORITY_GENERATION_STALE';

const ensureMounted = (record: MirrorRecord): Promise<boolean> => {
  if (record.mounted) return Promise.resolve(true);
  if (record.mountInFlight) return record.mountInFlight;

  const mounted = sendSessionOp(SETTINGS_SESSION_OPERATIONS.mounted, {
    sessionId: record.sessionId,
    leaseEpoch: record.leaseEpoch,
  })
    .then((outcome) => {
      if (outcome.kind === 'ok') {
        record.mounted = true;
        return true;
      }
      if (outcome.kind === 'error' && isSessionGone(outcome.errorCode)) {
        if (current === record) closeLocal();
      }
      return false;
    })
    .catch(() => false);
  record.mountInFlight = mounted;
  void mounted.finally(() => {
    if (record.mountInFlight === mounted) record.mountInFlight = null;
  });
  return mounted;
};

const pumpLatestChange = (record: MirrorRecord): Promise<boolean> => {
  if (record.changePump) return record.changePump;

  let retryBlocked = false;
  const pump = (async () => {
    if (!(await ensureMounted(record))) {
      retryBlocked = true;
      return false;
    }

    let latestSucceeded = true;
    while (
      current === record &&
      record.terminal === 'open' &&
      record.pendingChange
    ) {
      const snapshot = record.pendingChange;
      record.pendingChange = null;
      record.seq += 1;
      const seq = record.seq;
      const outcome = await sendSessionOp(SETTINGS_SESSION_OPERATIONS.change, {
        sessionId: record.sessionId,
        leaseEpoch: record.leaseEpoch,
        seq,
        settings: snapshot,
      });
      if (outcome.kind === 'ok') {
        record.lastAckedSeq = Math.max(record.lastAckedSeq, seq);
        latestSucceeded = true;
        continue;
      }
      if (outcome.kind === 'error' && isSessionGone(outcome.errorCode)) {
        record.pendingChange = null;
        if (current === record) closeLocal();
        return false;
      }
      latestSucceeded = false;
      if (!record.pendingChange && record.terminal === 'open') {
        record.pendingChange = snapshot;
        retryBlocked = true;
        return false;
      }
    }
    return latestSucceeded;
  })().catch(() => {
    retryBlocked = true;
    return false;
  });

  record.changePump = pump;
  void pump.finally(() => {
    if (record.changePump !== pump) return;
    record.changePump = null;
    if (
      !retryBlocked &&
      current === record &&
      record.terminal === 'open' &&
      record.pendingChange
    ) {
      void pumpLatestChange(record);
    }
  });
  return pump;
};

const queueLatestChange = (
  record: MirrorRecord,
  settings: Record<string, unknown>,
): void => {
  if (current !== record || record.terminal !== 'open') return;
  record.lastLocalSettings = { ...settings };
  record.pendingChange = { ...settings };
  void pumpLatestChange(record);
};

export const drainPendingPluginSettingsWrites = async (): Promise<boolean> => {
  const record = current;
  if (!record) return true;
  if (record.terminalPromise) return record.terminalPromise;

  let retried = false;
  while (current === record && record.terminal === 'open') {
    const pump =
      record.changePump ??
      (record.pendingChange ? pumpLatestChange(record) : null);
    if (!pump) break;
    const succeeded = await pump;
    if (!succeeded) {
      if (retried || current !== record || !record.pendingChange) return false;
      retried = true;
    }
  }

  if (record.terminalPromise) return record.terminalPromise;
  return (
    current === record &&
    record.pendingChange === null &&
    record.changePump === null &&
    record.lastAckedSeq === record.seq
  );
};

const terminalOutcomeSucceeded = (outcome: PluginRpcOutcome): boolean =>
  outcome.kind !== 'error' || isSessionGone(outcome.errorCode);

const startTerminal = (
  record: MirrorRecord,
  terminal: 'confirming' | 'canceling',
  settings?: Record<string, unknown>,
): Promise<PluginRpcOutcome> => {
  record.terminal = terminal;
  record.pendingChange = null;
  if (settings) record.lastLocalSettings = { ...settings };

  const outcome = (async (): Promise<PluginRpcOutcome> => {
    let mounted = await ensureMounted(record);
    if (!mounted && current === record) mounted = await ensureMounted(record);
    if (!mounted) {
      return current === record
        ? { kind: 'error', errorCode: 'MOUNT_NOT_ACKED' }
        : { kind: 'error', errorCode: 'SESSION_STALE' };
    }

    const inFlight = record.changePump;
    if (inFlight) await inFlight;
    if (current !== record) {
      return { kind: 'error', errorCode: 'SESSION_STALE' };
    }

    if (terminal === 'confirming') {
      return sendSessionOp(SETTINGS_SESSION_OPERATIONS.confirm, {
        sessionId: record.sessionId,
        leaseEpoch: record.leaseEpoch,
        lastSeq: record.seq,
        settings: { ...(settings ?? record.lastLocalSettings) },
      });
    }
    return sendSessionOp(SETTINGS_SESSION_OPERATIONS.cancel, {
      sessionId: record.sessionId,
      leaseEpoch: record.leaseEpoch,
    });
  })().catch(
    (): PluginRpcOutcome => ({
      kind: 'error',
      errorCode: 'LOCAL_SEND_FAILED',
    }),
  );

  record.terminalPromise = outcome.then(terminalOutcomeSucceeded);
  return outcome;
};

const openLocal = (descriptor: PluginSettingsSessionDescriptor) => {
  const { sessionId, leaseEpoch } = descriptor;
  // 늦게 도착한 낡은 descriptor가 현재 view를 덮지 않게 단조 게이트
  if (descriptor.descriptorGeneration <= lastAppliedGeneration) return;
  lastAppliedGeneration = descriptor.descriptorGeneration;
  if (typeof descriptor.authorityGeneration === 'number') {
    setPluginAuthorityGeneration(descriptor.authorityGeneration);
  }

  const record = {
    sessionId,
    leaseEpoch,
    descriptorGeneration: descriptor.descriptorGeneration,
    seq: descriptor.lastSeq,
    lastLocalSettings: { ...descriptor.settings },
    lastAckedSeq: descriptor.lastSeq,
    mounted: false,
    mountInFlight: null,
    pendingChange: null,
    changePump: null,
    terminal: 'open',
    terminalPromise: null,
  } as MirrorRecord;

  const payload: PluginSettingsPanelPayload = {
    pluginId: descriptor.pluginId,
    // visible이 boolean으로 치환된 스키마라 기존 렌더 경로를 그대로 사용
    definition: {
      settings:
        descriptor.resolvedSchema as unknown as PluginSettingsDefinition['settings'],
      messages: descriptor.messages,
      settingsUI: 'panel',
    },
    settings: { ...descriptor.settings },
    originalSettings: { ...descriptor.originalSettings },
    onChange: (next) => {
      queueLatestChange(record, next);
    },
    onConfirm: async (next) => {
      if (record.terminal !== 'open') {
        if (record.terminalPromise && !(await record.terminalPromise)) {
          throw new Error('Settings confirm failed: TERMINAL_IN_PROGRESS');
        }
        return;
      }
      const outcome = await startTerminal(record, 'confirming', next);
      // unknown은 main의 exactly-once가 보장 - 여기선 view만 닫는다
      if (outcome.kind === 'error' && !isSessionGone(outcome.errorCode)) {
        throw new Error(`Settings confirm failed: ${outcome.errorCode}`);
      }
    },
    onCancel: () => {
      if (record.terminal !== 'open') return;
      void startTerminal(record, 'canceling');
    },
    // 플러그인 promise는 main 세션이 resolve
    resolve: () => {},
  };
  record.payload = payload;
  current = record;
  usePropertiesPanelStore.setState({ pluginSettingsPanel: payload });

  // mount ACK - main이 transferring → active로 전이해 입력 수용 시작
  void ensureMounted(record);
};

const applyUpdate = (update: PluginSettingsSessionUpdate) => {
  const record = current;
  if (
    !record ||
    record.sessionId !== update.sessionId ||
    record.leaseEpoch !== update.leaseEpoch
  ) {
    return;
  }
  // 로컬에서 이미 닫힌 view를 늦은 update가 되살리지 않도록 게이트
  if (
    usePropertiesPanelStore.getState().pluginSettingsPanel !== record.payload
  ) {
    return;
  }

  // settings를 로컬 최신값으로 유지 - PropertiesPanel이 payload 교체 시
  // 편집 상태를 payload.settings로 재초기화하는 계약과 정합
  const nextPayload: PluginSettingsPanelPayload = {
    ...record.payload,
    definition: {
      ...record.payload.definition,
      settings:
        update.resolvedSchema as unknown as PluginSettingsDefinition['settings'],
    },
    settings: { ...record.lastLocalSettings },
  };
  record.payload = nextPayload;
  usePropertiesPanelStore.setState({ pluginSettingsPanel: nextPayload });
};

const applyClose = (message: PluginSettingsSessionClose) => {
  if (typeof message.descriptorGeneration !== 'number') return;
  // view 존재 여부와 무관하게 tombstone 먼저 기록 - close가 open보다
  // 먼저 도착해도 그 generation 이하의 늦은 open을 거절
  lastAppliedGeneration = Math.max(
    lastAppliedGeneration,
    message.descriptorGeneration,
  );
  if (!current || message.sessionId !== current.sessionId) return;
  // 재이전으로 이미 새 descriptor를 받았으면 이전 lease의 close는 무시
  if (message.descriptorGeneration < current.descriptorGeneration) return;
  closeLocal();
};

/** 패널 창 mount에서 1회 호출 */
export const initPluginSettingsMirror = (): (() => void) => {
  const offOpen = window.api.bridge.on<PluginSettingsSessionDescriptor>(
    SETTINGS_SESSION_OPEN_MESSAGE,
    (descriptor) => {
      if (
        !descriptor ||
        typeof descriptor.sessionId !== 'string' ||
        typeof descriptor.descriptorGeneration !== 'number' ||
        typeof descriptor.leaseEpoch !== 'number'
      ) {
        return;
      }
      openLocal(descriptor);
    },
  );
  const offUpdate = window.api.bridge.on<PluginSettingsSessionUpdate>(
    SETTINGS_SESSION_UPDATE_MESSAGE,
    (update) => {
      if (!update || typeof update.sessionId !== 'string') return;
      applyUpdate(update);
    },
  );
  const offClose = window.api.bridge.on<PluginSettingsSessionClose>(
    SETTINGS_SESSION_CLOSE_MESSAGE,
    (message) => {
      if (!message || typeof message.sessionId !== 'string') return;
      applyClose(message);
    },
  );

  // 창 생성 전 push 유실 복구 - 열려 있던 세션 descriptor 재요청
  sendBridgeMessageBestEffort('main', SETTINGS_SESSION_REQUEST_MESSAGE, {});

  return () => {
    offOpen?.();
    offUpdate?.();
    offClose?.();
    closeLocal();
  };
};
