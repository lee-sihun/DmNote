import { describe, expect, it } from 'vitest';
import { PresentationClock } from './presentationClock';

describe('PresentationClock', () => {
  it('never advances beyond watermark minus threshold', () => {
    const clock = new PresentationClock(100);
    clock.updateWatermark(500_000n, 1000);
    expect(clock.tick(1100)?.playheadMs).toBe(400);
    expect(clock.tick(1300)).toMatchObject({
      playheadMs: 400,
      safeTargetMs: 400,
      stalled: true,
    });
  });

  it('resumes at one-times speed without jumping after a stall', () => {
    const clock = new PresentationClock(100);
    clock.updateWatermark(500_000n, 1000);
    clock.tick(1300);
    clock.updateWatermark(1_000_000n, 1300);
    expect(clock.tick(1316)?.playheadMs).toBe(416);
  });

  it('includes transport reserve in the nominal target', () => {
    const clock = new PresentationClock(100, 25);
    clock.updateWatermark(500_000n, 1000);
    expect(clock.tick(1000)).toMatchObject({
      playheadMs: 375,
      nominalTargetMs: 375,
      safeTargetMs: 400,
    });
  });

  it('does not turn a suspended render interval into a playhead jump', () => {
    const clock = new PresentationClock(100, 100);
    clock.updateWatermark(500_000n, 1000);
    expect(clock.tick(1000)?.playheadMs).toBe(300);

    clock.updateWatermark(1_000_000n, 2000);
    expect(clock.tick(2000)?.playheadMs).toBe(300);
    expect(clock.tick(2016)?.playheadMs).toBe(316);
  });

  it('can re-anchor accumulated delay debt at a caller-approved idle point', () => {
    const clock = new PresentationClock(100, 100);
    clock.updateWatermark(500_000n, 1000);
    clock.updateWatermark(1_000_000n, 2000);

    expect(clock.tick(2000)?.playheadMs).toBe(300);
    expect(clock.recoverDelayDebt(2000)).toMatchObject({
      playheadMs: 800,
      delayDebtMs: 0,
    });
  });
});
