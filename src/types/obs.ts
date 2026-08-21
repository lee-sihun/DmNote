// OBS WebSocket 프로토콜 타입

// v3: canonical input timeline replay/rebase 계약 추가
export const OBS_PROTOCOL_VERSION = 3;
export const DEFAULT_OBS_PORT = 34891;

export interface ObsEnvelope<T = unknown> {
  v: number;
  type: string;
  seq: number;
  ts: number;
  payload: T;
}

// ── 클라이언트 → 서버 ──

export interface HelloPayload {
  client: string;
  protocol: number;
  appVersion: string;
  resumeFromSeq: number;
  token?: string;
}

// ── 서버 → 클라이언트 ──

export interface HelloAckPayload {
  serverVersion: string;
  obsMode: boolean;
  allowedList?: string[];
}

export interface ObsStatus {
  running: boolean;
  port: number;
  clientCount: number;
  token?: string;
  localIp?: string;
}
