export interface PresentationClockSnapshot {
  playheadMs: number;
  safeTargetMs: number;
  nominalTargetMs: number;
  delayDebtMs: number;
  stalled: boolean;
}

export class PresentationClock {
  private thresholdMs: number;
  private transportReserveMs: number;
  private playheadMs: number | null = null;
  private safeThroughMs = 0;
  private sourceAnchorMs = 0;
  private localAnchorMs = 0;
  private lastTickMs = 0;

  constructor(thresholdMs: number, transportReserveMs = 0) {
    this.thresholdMs = Math.max(0, thresholdMs);
    this.transportReserveMs = Math.max(0, transportReserveMs);
  }

  resetEpoch(thresholdMs: number, transportReserveMs = 0): void {
    this.thresholdMs = Math.max(0, thresholdMs);
    this.transportReserveMs = Math.max(0, transportReserveMs);
    this.playheadMs = null;
    this.safeThroughMs = 0;
    this.sourceAnchorMs = 0;
    this.localAnchorMs = 0;
    this.lastTickMs = 0;
  }

  updateWatermark(safeThroughUs: bigint, receivedAtMs: number): void {
    const safeThroughMs = Number(safeThroughUs) / 1000;
    if (!Number.isFinite(safeThroughMs) || safeThroughMs < this.safeThroughMs) {
      throw new Error('Presentation watermark moved backwards');
    }
    this.safeThroughMs = safeThroughMs;
    this.sourceAnchorMs = safeThroughMs;
    this.localAnchorMs = receivedAtMs;
    if (this.playheadMs == null) {
      const initialTarget = Math.min(
        this.nominalTarget(receivedAtMs),
        this.safeTarget(),
      );
      this.playheadMs = initialTarget;
      this.lastTickMs = receivedAtMs;
    }
  }

  tick(localNowMs: number): PresentationClockSnapshot | null {
    if (this.playheadMs == null) return null;
    const elapsed = Math.max(0, localNowMs - this.lastTickMs);
    const nominalTargetMs = this.nominalTarget(localNowMs);
    const safeTargetMs = this.safeTarget();
    const target = Math.min(nominalTargetMs, safeTargetMs);
    // 복구 직후에도 한 프레임에 미래로 점프하지 않고 최대 1배속 진행
    this.playheadMs = Math.max(
      this.playheadMs,
      Math.min(this.playheadMs + elapsed, target),
    );
    this.lastTickMs = localNowMs;
    return {
      playheadMs: this.playheadMs,
      safeTargetMs,
      nominalTargetMs,
      delayDebtMs: Math.max(0, nominalTargetMs - this.playheadMs),
      stalled:
        this.playheadMs >= safeTargetMs && nominalTargetMs > safeTargetMs,
    };
  }

  private nominalTarget(localNowMs: number): number {
    const estimatedSourceNow =
      this.sourceAnchorMs + Math.max(0, localNowMs - this.localAnchorMs);
    return estimatedSourceNow - this.thresholdMs - this.transportReserveMs;
  }

  private safeTarget(): number {
    return this.safeThroughMs - this.thresholdMs;
  }
}
