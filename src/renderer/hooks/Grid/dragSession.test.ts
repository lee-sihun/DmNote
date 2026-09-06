import { afterEach, describe, expect, it } from 'vitest';
import { releaseDragSession, tryAcquireDragSession } from './drag/dragSession';
import {
  acquireHistoryEditorFlushLock,
  releaseHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from '@src/renderer/editor/runtime/lifecycle/historyEditorFlushLock';

afterEach(() => {
  releaseDragSession();
  resetHistoryEditorFlushLock();
});

describe('history 중 드래그 시작 경계', () => {
  it('잠금 중 새 press는 거부하고 잠금 해제 후 정상 시작한다', () => {
    acquireHistoryEditorFlushLock('new-drag');
    expect(tryAcquireDragSession()).toBe(false);
    releaseHistoryEditorFlushLock('new-drag');
    expect(tryAcquireDragSession()).toBe(true);
  });
  it('잠금 획득 자체는 기존 세션 소유권을 취소하지 않는다', () => {
    expect(tryAcquireDragSession()).toBe(true);
    acquireHistoryEditorFlushLock('active-drag');
    releaseHistoryEditorFlushLock('active-drag');
    expect(tryAcquireDragSession()).toBe(false);
    releaseDragSession();
    expect(tryAcquireDragSession()).toBe(true);
  });
});
