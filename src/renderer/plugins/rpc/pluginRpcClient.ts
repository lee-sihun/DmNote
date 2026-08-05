/**
 * 패널 → main 플러그인 mutation RPC 클라이언트
 * timeout은 실패가 아닌 outcome-unknown - 호출자는 canonical 재조회로 수렴
 * (계약: tasks/plan/panel-detach.md Phase E C1)
 */

import {
  pluginRpcApi,
  PLUGIN_RPC_PROTOCOL_VERSION,
  type PluginRpcResponse,
} from '@api/modules/pluginRpcApi';

const REQUEST_TIMEOUT_MS = 4000;
const MAX_PENDING = 128;

// plugin_rpc_send가 Err로 반환하는 게이트 코드 (invoke 예외 메시지에서 복원)
const SEND_ERROR_CODES = [
  'AUTHORITY_UNAVAILABLE',
  'AUTHORITY_GENERATION_CHANGED',
  'PLUGIN_MODEL_REVISION_CONFLICT',
  'PLUGIN_RPC_REQUEST_TOO_LARGE',
  'PLUGIN_RPC_SOURCE_NOT_ALLOWED',
  'PLUGIN_RPC_TARGET_NOT_ALLOWED',
  'PLUGIN_RPC_REQUEST_ID_REUSED',
  'HISTORY_IN_PROGRESS',
] as const;

export type PluginRpcOutcome =
  | { kind: 'ok'; response: PluginRpcResponse }
  | { kind: 'error'; errorCode: string; response?: PluginRpcResponse }
  | { kind: 'unknown' };

interface PendingEntry {
  resolve: (outcome: PluginRpcOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();
let responderStarted = false;
let currentAuthorityGeneration = 0;

const settle = (requestId: string, outcome: PluginRpcOutcome) => {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  clearTimeout(entry.timer);
  entry.resolve(outcome);
};

const ensureResponseListener = () => {
  if (responderStarted) return;
  responderStarted = true;
  pluginRpcApi.onResponse((response) => {
    settle(
      response.requestId,
      response.ok
        ? { kind: 'ok', response }
        : {
            kind: 'error',
            errorCode: response.error?.code ?? 'UNKNOWN',
            response,
          },
    );
  });
  pluginRpcApi.onAuthorityChanged(({ authorityGeneration }) => {
    setPluginAuthorityGeneration(authorityGeneration);
    // authority 교체 시 진행 중 요청은 전부 unknown 처리 (재조회 유도)
    for (const requestId of [...pending.keys()]) {
      settle(requestId, { kind: 'unknown' });
    }
  });
};

// generation은 reset마다 단조 증가 - 늦게 도착한 낡은 값 무시
export const setPluginAuthorityGeneration = (generation: number): void => {
  if (generation > currentAuthorityGeneration) {
    currentAuthorityGeneration = generation;
  }
};

/** 패널 창 mount 시 eager 구독 - authority-changed를 첫 요청 전에 수신 */
export const startPluginRpcClient = (): void => {
  ensureResponseListener();
};

export const getPluginAuthorityGeneration = (): number =>
  currentAuthorityGeneration;

/** main으로 plugin mutation 요청. 응답·타임아웃·authority 교체를 단일 outcome으로 수렴 */
export const sendPluginRpc = async (
  operation: string,
  payload: Record<string, unknown>,
  expectedModelRevision: number,
): Promise<PluginRpcOutcome> => {
  ensureResponseListener();
  if (pending.size >= MAX_PENDING) {
    return { kind: 'error', errorCode: 'RPC_PENDING_LIMIT' };
  }

  const requestId = crypto.randomUUID();
  const outcome = new Promise<PluginRpcOutcome>((resolve) => {
    const timer = setTimeout(() => {
      settle(requestId, { kind: 'unknown' });
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
  });

  try {
    await pluginRpcApi.send('main', {
      protocolVersion: PLUGIN_RPC_PROTOCOL_VERSION,
      requestId,
      authorityGeneration: currentAuthorityGeneration,
      expectedModelRevision,
      operation,
      payload,
    });
  } catch (error) {
    // Rust 게이트 거절은 invoke 예외로 도착 - 알려진 코드를 복원해 호출자 재시도 판단에 사용
    const message = String(error);
    const knownCode = SEND_ERROR_CODES.find((code) => message.includes(code));
    settle(requestId, {
      kind: 'error',
      errorCode: knownCode ?? 'SEND_FAILED',
    });
  }
  return outcome;
};
