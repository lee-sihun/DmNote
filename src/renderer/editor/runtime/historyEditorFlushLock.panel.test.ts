import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireHistoryEditorFlushLock,
  releaseHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from './historyEditorFlushLock';
import {
  openPanelChildWindow,
  resetPanelChildWindow,
} from '@utils/panelWindow/panelChildWindow';

vi.mock('@api/modules/panelWindowApi', () => ({
  panelWindowApi: { armOpen: () => Promise.resolve() },
}));

describe('공유 힙 분리 패널의 history 입력 잠금', () => {
  let iframe: HTMLIFrameElement;
  let child: Window;
  beforeEach(() => {
    resetHistoryEditorFlushLock();
    iframe = document.createElement('iframe');
    document.body.append(iframe);
    child = iframe.contentWindow!;
    vi.spyOn(window, 'open').mockReturnValue(child);
  });
  afterEach(() => {
    resetPanelChildWindow();
    resetHistoryEditorFlushLock();
    iframe.remove();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    '분리 창을 잠금 뒤 생성=%s일 때도 입력과 body 포털을 함께 막고 복원한다',
    async (createdDuringLock) => {
      if (!createdDuringLock) await openPanelChildWindow();
      child.document.documentElement.setAttribute('aria-busy', 'previous');
      acquireHistoryEditorFlushLock('panel-history');
      if (createdDuringLock) await openPanelChildWindow();
      const body = child.document.body;
      const clicked = vi.fn();
      body.addEventListener('click', clicked);
      expect(document.documentElement.inert).toBe(true);
      expect(child.document.documentElement.inert).toBe(true);
      body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicked).not.toHaveBeenCalled();

      const host = child.document.createElement('div');
      host.addEventListener('click', clicked);
      body.append(host);
      document.body.append(document.adoptNode(host));
      host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicked).not.toHaveBeenCalled();

      releaseHistoryEditorFlushLock('stale');
      expect(child.document.documentElement.inert).toBe(true);
      releaseHistoryEditorFlushLock('panel-history');
      expect(child.document.documentElement.inert).toBe(false);
      expect(child.document.documentElement.getAttribute('aria-busy')).toBe(
        createdDuringLock ? null : 'previous',
      );
      body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicked).toHaveBeenCalledOnce();
      body.removeEventListener('click', clicked);
      host.remove();
    },
  );

  it('잠긴 자식 창을 정리한 뒤 재사용해도 중복 잠금이나 잔여 blocker가 없다', async () => {
    await openPanelChildWindow();
    acquireHistoryEditorFlushLock('panel-close');
    expect(child.document.documentElement.inert).toBe(true);
    resetPanelChildWindow();
    expect(child.document.documentElement.inert).toBe(false);
    await openPanelChildWindow();
    expect(child.document.documentElement.inert).toBe(true);
    releaseHistoryEditorFlushLock('panel-close');
    expect(child.document.documentElement.inert).toBe(false);
  });

  it('자식 문서 pagehide는 자신이 가진 잠금만 회수한다', async () => {
    await openPanelChildWindow();
    child.document.documentElement.inert = true;
    acquireHistoryEditorFlushLock('panel-pagehide');
    child.dispatchEvent(new Event('pagehide'));
    expect(child.document.documentElement.inert).toBe(true);
    expect(document.documentElement.inert).toBe(true);
    releaseHistoryEditorFlushLock('panel-pagehide');
    expect(document.documentElement.inert).toBe(false);
    expect(child.document.documentElement.inert).toBe(true);
  });
});
