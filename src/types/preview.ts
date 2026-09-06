// 편집 프리뷰 채널 wire 계약 (Rust preview_broker와 공유)

export const PREVIEW_SCHEMA_VERSION = 1;

export type PreviewDomain =
  | 'keyPosition'
  | 'statPosition'
  | 'graphPosition'
  | 'knobPosition'
  | 'spritePosition';

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
