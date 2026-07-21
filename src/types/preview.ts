// 편집 프리뷰 채널 wire 계약 (Rust preview_broker와 공유)

export const PREVIEW_SCHEMA_VERSION = 1;

export type PreviewDomain =
  | 'keyPosition'
  | 'statPosition'
  | 'graphPosition'
  | 'knobPosition';

export type PreviewEnvelopeKind = 'patch' | 'cancel';

export interface PreviewEnvelope {
  schemaVersion: typeof PREVIEW_SCHEMA_VERSION;
  sessionId: string;
  seq: number;
  kind: PreviewEnvelopeKind;
  // Rust가 호출 webview label로 주입, 수신측 echo 방지용
  sourceLabel: string;
  domain: PreviewDomain;
  mode: string;
  targets: number[];
  patch: Record<string, unknown>;
  // cancel 전용: 이 revision 반영 후에만 세션 제거 (순서 게이트)
  minRevision?: number | null;
}

export interface PreviewPublishRequest {
  schemaVersion: typeof PREVIEW_SCHEMA_VERSION;
  sessionId: string;
  seq: number;
  domain: PreviewDomain;
  mode: string;
  targets: number[];
  patch: Record<string, unknown>;
}
