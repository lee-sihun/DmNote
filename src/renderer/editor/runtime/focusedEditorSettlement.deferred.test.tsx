// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAfterPaintValueCommit } from '@hooks/useAfterPaintValueCommit';
import { useOptimisticBooleanCommit } from '@hooks/useOptimisticBooleanCommit';
import { useOptimisticValueCommit } from '@hooks/useOptimisticValueCommit';
import { registerPendingOptimisticCommit } from '@hooks/pendingOptimisticCommits';
import { trackEditorWrite } from './editorWriteBarrier';
import { settleFocusedEditor } from './focusedEditorSettlement';

type CommitKind = 'after-paint' | 'boolean' | 'value';

interface DeferredCommitHarnessProps {
  kind: CommitKind;
  onCommit: () => void;
}

const DeferredCommitHarness = ({
  kind,
  onCommit,
}: DeferredCommitHarnessProps) => {
  const ref = useRef<HTMLButtonElement>(null);
  const afterPaint = useAfterPaintValueCommit({
    onCommit,
    frameHostRef: ref,
  });
  const boolean = useOptimisticBooleanCommit({
    canonicalValue: false,
    onCommit,
    frameHostRef: ref,
  });
  const value = useOptimisticValueCommit({
    canonicalValue: 'before',
    onCommit,
    frameHostRef: ref,
  });
  return (
    <button
      ref={ref}
      onClick={() => {
        if (kind === 'after-paint') afterPaint.scheduleCommit('after');
        else if (kind === 'boolean') boolean.toggle();
        else value.select('after');
      }}
    />
  );
};

describe('focused editor deferred settlement', () => {
  let iframe: HTMLIFrameElement;
  let child: Window & typeof globalThis;
  let root: Root;
  let host: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let timers: Map<number, () => void>;
  let nextId: number;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    iframe = document.createElement('iframe');
    document.body.append(iframe);
    child = iframe.contentWindow as Window & typeof globalThis;
    host = child.document.createElement('div');
    child.document.body.append(host);
    root = createRoot(host);
    frames = new Map();
    timers = new Map();
    nextId = 0;
    child.requestAnimationFrame = (callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    };
    child.cancelAnimationFrame = (id) => frames.delete(id);
    child.setTimeout = ((callback: () => void) => {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    }) as typeof child.setTimeout;
    child.clearTimeout = (id) => timers.delete(id);
  });

  afterEach(() => {
    act(() => root.unmount());
    iframe.remove();
    vi.restoreAllMocks();
  });

  const schedule = (kind: CommitKind, onCommit: () => void) => {
    act(() =>
      root.render(<DeferredCommitHarness kind={kind} onCommit={onCommit} />),
    );
    act(() => host.querySelector('button')!.click());
    expect(frames.size).toBe(1);
  };

  it.each<CommitKind>(['after-paint', 'boolean', 'value'])(
    '%s 예약은 호스트 프레임이 멈춰도 lifecycle에서 한 번 확정한다',
    async (kind) => {
      for (const stage of ['frame', 'timer'] as const) {
        const commit = vi.fn();
        schedule(kind, commit);
        if (stage === 'timer') {
          const pending = [...frames.values()];
          frames.clear();
          act(() => pending.forEach((callback) => callback(0)));
          expect(timers.size).toBe(1);
        }
        expect(commit).not.toHaveBeenCalled();

        await act(async () => {
          expect(await settleFocusedEditor(async () => true)).toBe(true);
        });

        expect(commit).toHaveBeenCalledOnce();
        expect(frames.size).toBe(0);
        expect(timers.size).toBe(0);
      }
    },
  );

  it('예약 커밋이 시작한 비동기 쓰기까지 기다리고 실패를 반환한다', async () => {
    let rejectWrite!: (error: Error) => void;
    const write = new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    });
    const commit = vi.fn(() => {
      void trackEditorWrite(write).catch(() => undefined);
    });
    schedule('after-paint', commit);
    let finished = false;
    let result: Promise<boolean>;
    await act(async () => {
      result = settleFocusedEditor(async () => true).then((value) => {
        finished = true;
        return value;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(commit).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    rejectWrite(new Error('deferred save failed'));
    await expect(result!).resolves.toBe(false);
  });

  it('예약 커밋이 동기로 실패해도 나머지는 정산하고 lifecycle을 중단한다', async () => {
    const error = new Error('deferred callback failed');
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    schedule('after-paint', () => {
      throw error;
    });
    const following = vi.fn();
    registerPendingOptimisticCommit(following);

    await act(async () => {
      expect(await settleFocusedEditor(async () => true)).toBe(false);
    });

    expect(following).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(
      'Failed to flush a pending editor commit',
      error,
    );
  });
});
