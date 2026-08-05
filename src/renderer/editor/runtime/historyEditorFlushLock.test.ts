import { afterEach, describe, expect, it } from 'vitest';

import {
  acquireHistoryEditorFlushLock,
  isHistoryEditorFlushLocked,
  releaseHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from './historyEditorFlushLock';

afterEach(() => {
  resetHistoryEditorFlushLock();
  document.documentElement.inert = false;
});

describe('history editor flush lock', () => {
  it('일치하는 완료 ID에서만 기존 inert 상태로 복원한다', () => {
    expect(acquireHistoryEditorFlushLock('history-1')).toBe(true);
    expect(document.documentElement.inert).toBe(true);
    expect(isHistoryEditorFlushLocked()).toBe(true);

    releaseHistoryEditorFlushLock('history-stale');
    expect(document.documentElement.inert).toBe(true);

    releaseHistoryEditorFlushLock('history-1');
    expect(document.documentElement.inert).toBe(false);
    expect(isHistoryEditorFlushLocked()).toBe(false);
  });

  it('완료 이벤트가 먼저 도착한 handshake는 다시 잠그지 않는다', () => {
    releaseHistoryEditorFlushLock('history-finished');

    expect(acquireHistoryEditorFlushLock('history-finished')).toBe(false);
    expect(document.documentElement.inert).toBe(false);
  });

  it('원래 inert였던 문서를 해제하지 않는다', () => {
    document.documentElement.inert = true;
    acquireHistoryEditorFlushLock('history-2');

    releaseHistoryEditorFlushLock('history-2');

    expect(document.documentElement.inert).toBe(true);
  });

  it('잠긴 동안 키보드와 클릭 이벤트를 전파하지 않는다', () => {
    const received: string[] = [];
    const listener = (event: Event) => received.push(event.type);
    document.body.addEventListener('keydown', listener);
    document.body.addEventListener('click', listener);

    acquireHistoryEditorFlushLock('history-events');
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true }),
    );
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(received).toEqual([]);

    releaseHistoryEditorFlushLock('history-events');
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true }),
    );
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(received).toEqual(['keydown', 'click']);

    document.body.removeEventListener('keydown', listener);
    document.body.removeEventListener('click', listener);
  });
});
