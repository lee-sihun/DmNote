export interface PresentationClockSnapshot {
  playheadMs: number;
  safeTargetMs: number;
  nominalTargetMs: number;
  delayDebtMs: number;
  stalled: boolean;
}

const MAX_CONTINUOUS_TICK_GAP_MS = 100;

export class PresentationClock {
  private thresholdMs: number;
  private presentationBufferMs: number;
  private playheadMs: number | null = null;
  private safeThroughMs = 0;
  private sourceAnchorMs = 0;
  private localAnchorMs = 0;
  private lastTickMs = 0;

  constructor(thresholdMs: number, presentationBufferMs = 0) {
    this.thresholdMs = Math.max(0, thresholdMs);
    this.presentationBufferMs = Math.max(0, presentationBufferMs);
  }

  resetEpoch(thresholdMs: number, presentationBufferMs = 0): void {
    this.thresholdMs = Math.max(0, thresholdMs);
    this.presentationBufferMs = Math.max(0, presentationBufferMs);
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
    const rawElapsed = Math.max(0, localNowMs - this.lastTickMs);
    // rAF가 중단된 구간은 재생 시간이 아니다. 복귀 프레임에서 누적 시간을
    // 한 번에 적용하면 확정성은 유지돼도 화면이 점프하므로 anchor만 다시 잡는다.
    const elapsed = rawElapsed > MAX_CONTINUOUS_TICK_GAP_MS ? 0 : rawElapsed;
    const nominalTargetMs = this.nominalTarget(localNowMs);
    const safeTargetMs = this.safeTarget();
    const target = Math.min(nominalTargetMs, safeTargetMs);
    // 복구 직후에도 한 프레임에 미래로 점프하지 않고 최대 1배속 진행
    this.playheadMs = Math.max(
      this.playheadMs,
      Math.min(this.playheadMs + elapsed, target),
    );
    this.lastTickMs = localNowMs;
    return this.snapshot(nominalTargetMs, safeTargetMs);
  }

  recoverDelayDebt(localNowMs: number): PresentationClockSnapshot | null {
    if (this.playheadMs == null) return null;
    const nominalTargetMs = this.nominalTarget(localNowMs);
    const safeTargetMs = this.safeTarget();
    this.playheadMs = Math.max(
      this.playheadMs,
      Math.min(nominalTargetMs, safeTargetMs),
    );
    this.lastTickMs = localNowMs;
    return this.snapshot(nominalTargetMs, safeTargetMs);
  }

  private nominalTarget(localNowMs: number): number {
    const estimatedSourceNow =
      this.sourceAnchorMs + Math.max(0, localNowMs - this.localAnchorMs);
    return estimatedSourceNow - this.thresholdMs - this.presentationBufferMs;
  }

  private safeTarget(): number {
    return this.safeThroughMs - this.thresholdMs;
  }

  private snapshot(
    nominalTargetMs: number,
    safeTargetMs: number,
  ): PresentationClockSnapshot {
    return {
      playheadMs: this.playheadMs!,
      safeTargetMs,
      nominalTargetMs,
      delayDebtMs: Math.max(0, nominalTargetMs - this.playheadMs!),
      stalled:
        this.playheadMs! >= safeTargetMs && nominalTargetMs > safeTargetMs,
    };
  }
}
