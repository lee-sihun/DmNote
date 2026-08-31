import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSpriteEditPreviewStore } from './useSpriteEditPreviewStore';
import type { SpritePose } from '@src/types/key/sprites';

const pose = (poseId: string): SpritePose => ({
  contactPoint: { x: 0.5, y: 1 },
  poseId,
  triggers: ['k1'],
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  imageOverride: null,
});

describe('useSpriteEditPreviewStore', () => {
  afterEach(() => {
    useSpriteEditPreviewStore.setState({ preview: null });
  });

  it('같은 내용 재발행과 빈 상태 clear는 리스너를 깨우지 않는다', () => {
    const listener = vi.fn();
    const unsubscribe = useSpriteEditPreviewStore.subscribe(listener);
    const fallbackPose = pose('a');
    const payload = {
      kind: 'pose' as const,
      positionId: 'sprite-1',
      poseId: 'a',
      fallbackPose,
      preferFallback: false,
    };

    useSpriteEditPreviewStore.getState().publish(payload);
    expect(listener).toHaveBeenCalledTimes(1);
    // 패널 리렌더마다 같은 내용이 다시 발행되는 경로 - set 자체가 없어야 한다
    useSpriteEditPreviewStore.getState().publish({ ...payload });
    expect(listener).toHaveBeenCalledTimes(1);

    useSpriteEditPreviewStore
      .getState()
      .publish({ kind: 'pivot', positionId: 'sprite-1' });
    expect(listener).toHaveBeenCalledTimes(2);
    useSpriteEditPreviewStore
      .getState()
      .publish({ kind: 'pivot', positionId: 'sprite-1' });
    expect(listener).toHaveBeenCalledTimes(2);

    useSpriteEditPreviewStore.getState().clear();
    expect(listener).toHaveBeenCalledTimes(3);
    useSpriteEditPreviewStore.getState().clear();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('자세 전환·preferFallback·종류 변경은 발행을 갱신한다', () => {
    const store = useSpriteEditPreviewStore.getState();
    store.publish({
      kind: 'pose',
      positionId: 'sprite-1',
      poseId: 'a',
      fallbackPose: pose('a'),
      preferFallback: false,
    });
    store.publish({
      kind: 'pose',
      positionId: 'sprite-1',
      poseId: 'b',
      fallbackPose: pose('b'),
      preferFallback: false,
    });
    let preview = useSpriteEditPreviewStore.getState().preview;
    expect(preview?.kind === 'pose' && preview.poseId).toBe('b');

    store.publish({
      kind: 'pose',
      positionId: 'sprite-1',
      poseId: 'b',
      fallbackPose: pose('b'),
      preferFallback: true,
    });
    preview = useSpriteEditPreviewStore.getState().preview;
    expect(preview?.kind === 'pose' && preview.preferFallback).toBe(true);

    store.publish({ kind: 'pivot', positionId: 'sprite-1' });
    expect(useSpriteEditPreviewStore.getState().preview?.kind).toBe('pivot');
  });
});
