import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireHistoryEditorFlushLock,
  isHistoryEditorFlushLocked,
  registerHistoryEditorFlushDocument,
  releaseHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
  subscribeHistoryEditorFlushStart,
} from './historyEditorFlushLock';

beforeEach(() => {
  resetHistoryEditorFlushLock();
  document.documentElement.inert = false;
  document.documentElement.removeAttribute('aria-busy');
});

afterEach(() => {
  resetHistoryEditorFlushLock();
  document.documentElement.inert = false;
  document.documentElement.removeAttribute('aria-busy');
});

describe('history editor flush lock', () => {
  it.each([
    ['오류 객체', new Error('first cancellation failed')],
    ['undefined', undefined],
  ])('%s 예외 뒤에도 나머지 취소와 문서 잠금을 마친다', (_label, failure) => {
    const child = document.implementation.createHTMLDocument();
    const unregisterDocument = registerHistoryEditorFlushDocument(child);
    const seen: number[] = [];
    const unsubscribers = [
      subscribeHistoryEditorFlushStart(() => {
        seen.push(1);
        throw failure;
      }),
      subscribeHistoryEditorFlushStart(() => {
        seen.push(2);
        throw new Error('second cancellation failed');
      }),
      subscribeHistoryEditorFlushStart(() => seen.push(3)),
    ];
    try {
      let caught: { error: unknown } | null = null;
      try {
        acquireHistoryEditorFlushLock('failed-cancellation');
      } catch (error) {
        caught = { error };
      }
      expect(caught).toEqual({ error: failure });
      expect(seen).toEqual([1, 2, 3]);
      expect(document.documentElement.inert).toBe(true);
      expect(child.documentElement.inert).toBe(true);
      releaseHistoryEditorFlushLock('failed-cancellation');
      expect(isHistoryEditorFlushLocked()).toBe(false);
      expect(document.documentElement.inert).toBe(false);
      expect(child.documentElement.inert).toBe(false);
    } finally {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unregisterDocument();
    }
  });

  it('새 lock은 inert 적용 전에 한 번만 취소를 알리고 해제한 구독은 호출하지 않는다', () => {
    const seen: Array<{ locked: boolean; inert: boolean }> = [];
    const unsubscribe = subscribeHistoryEditorFlushStart(() => {
      seen.push({
        locked: isHistoryEditorFlushLocked(),
        inert: document.documentElement.inert,
      });
    });
    acquireHistoryEditorFlushLock('history-start');
    acquireHistoryEditorFlushLock('history-start');
    expect(seen).toEqual([{ locked: true, inert: false }]);
    releaseHistoryEditorFlushLock('history-start');
    unsubscribe();
    acquireHistoryEditorFlushLock('history-next');
    expect(seen).toHaveLength(1);
  });

  it('일치하는 완료 ID에서만 기존 inert 상태로 복원한다', () => {
    expect(acquireHistoryEditorFlushLock('history-1')).toBe(true);
    expect(document.documentElement.inert).toBe(true);
    expect(document.documentElement.getAttribute('aria-busy')).toBe('true');
    expect(isHistoryEditorFlushLocked()).toBe(true);

    releaseHistoryEditorFlushLock('history-stale');
    expect(document.documentElement.inert).toBe(true);

    releaseHistoryEditorFlushLock('history-1');
    expect(document.documentElement.inert).toBe(false);
    expect(document.documentElement.hasAttribute('aria-busy')).toBe(false);
    expect(isHistoryEditorFlushLocked()).toBe(false);
  });

  it('완료 이벤트가 먼저 도착한 handshake는 다시 잠그지 않는다', () => {
    releaseHistoryEditorFlushLock('history-finished');

    expect(acquireHistoryEditorFlushLock('history-finished')).toBe(false);
    expect(document.documentElement.inert).toBe(false);
  });

  it('원래 inert였던 문서를 해제하지 않는다', () => {
    document.documentElement.inert = true;
    document.documentElement.setAttribute('aria-busy', 'mixed');
    acquireHistoryEditorFlushLock('history-2');

    releaseHistoryEditorFlushLock('history-2');

    expect(document.documentElement.inert).toBe(true);
    expect(document.documentElement.getAttribute('aria-busy')).toBe('mixed');
    document.documentElement.removeAttribute('aria-busy');
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
