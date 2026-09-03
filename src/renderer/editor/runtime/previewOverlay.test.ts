import { beforeEach, describe, expect, it } from 'vitest';
import { previewOverlay, composePreviewPositions } from './previewOverlay';

const canonical = {
  '4key': [{ id: 'sprite-a', value: 0, remote: 0 }],
};

describe('previewOverlay 로컬 세션 수명', () => {
  beforeEach(() => previewOverlay.clearAll());

  it('새 로컬 세션은 끝나지 않고 남은 이전 로컬 세션을 교체한다', () => {
    previewOverlay.applyLocalPatchByIds(
      '11111111-1111-4111-8111-111111111111',
      '4key',
      ['sprite-a'],
      { value: 10 },
      'spritePosition',
    );
    previewOverlay.applyRemoteEnvelope({
      schemaVersion: 1,
      sessionId: '22222222-2222-4222-8222-222222222222',
      seq: 1,
      kind: 'patch',
      sourceLabel: 'panel',
      domain: 'spritePosition',
      mode: '4key',
      targets: [0],
      patch: { remote: 7 },
    });
    previewOverlay.applyLocalPatchByIds(
      '33333333-3333-4333-8333-333333333333',
      '4key',
      ['sprite-a'],
      { value: 20 },
      'spritePosition',
    );

    expect(
      composePreviewPositions('spritePosition', canonical)['4key'][0],
    ).toEqual({ id: 'sprite-a', value: 20, remote: 7 });

    previewOverlay.endSession('33333333-3333-4333-8333-333333333333');
    expect(
      composePreviewPositions('spritePosition', canonical)['4key'][0],
    ).toEqual({ id: 'sprite-a', value: 0, remote: 7 });
  });

  it('소유권 없는 로컬 세션만 회수하고 원격 세션은 유지한다', () => {
    const localSessionId = '11111111-1111-4111-8111-111111111111';
    previewOverlay.applyLocalPatchByIds(
      localSessionId,
      '4key',
      ['sprite-a'],
      { value: 10 },
      'spritePosition',
    );
    previewOverlay.applyRemoteEnvelope({
      schemaVersion: 1,
      sessionId: '22222222-2222-4222-8222-222222222222',
      seq: 1,
      kind: 'patch',
      sourceLabel: 'panel',
      domain: 'spritePosition',
      mode: '4key',
      targets: [0],
      patch: { remote: 7 },
    });

    expect(previewOverlay.discardLocalSessionsExcept(null)).toEqual([
      localSessionId,
    ]);
    expect(
      composePreviewPositions('spritePosition', canonical)['4key'][0],
    ).toEqual({ id: 'sprite-a', value: 0, remote: 7 });
  });
});
