import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { useScrubDrag } from './useScrubDrag';
import {
  acquireHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from '@src/renderer/editor/runtime/historyEditorFlushLock';

describe('스크럽 history 종료 경계', () => {
  let root: Root;
  let host: HTMLDivElement;
  const move = vi.fn();
  const commit = vi.fn();
  const cancel = vi.fn();
  let handlers: ReturnType<typeof useScrubDrag>['handlers'];
  const Harness = () => {
    const scrub = useScrubDrag({
      enabled: true,
      resolveBase: () => 10,
      step: 1,
      quantize: (value) => value,
      onMove: move,
      onCommit: commit,
      onCancel: cancel,
    });
    useEffect(() => {
      handlers = scrub.handlers;
    });
    return <div {...scrub.handlers} data-active={scrub.active} />;
  };
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    move.mockClear();
    commit.mockClear();
    cancel.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetHistoryEditorFlushLock();
  });
  const pointer = (type: string, x: number) => {
    host.firstElementChild!.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: x,
      }),
    );
  };
  it.each(['historyUndo', 'historyRedo'])(
    '%s 반영과 같은 이벤트 구간의 pointerup도 이전 값을 저장하지 않는다',
    (origin) => {
      act(() => {
        pointer('pointerdown', 0);
        pointer('pointermove', 20);
        useCommittedApplyStore.getState().bump(origin);
        pointer('pointerup', 20);
      });
      expect(move).toHaveBeenCalledExactlyOnceWith(30);
      expect(commit).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(host.firstElementChild!.getAttribute('data-active')).toBe('false');
      expect(document.body.style.userSelect).toBe('');
    },
  );
  it('잠금 획득과 history 반영 사이 pointerup은 이전 값을 저장하지 않는다', () => {
    act(() => {
      pointer('pointerdown', 0);
      pointer('pointermove', 20);
      acquireHistoryEditorFlushLock('scrub-release');
      pointer('pointerup', 20);
    });
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledExactlyOnceWith('history');
    expect(host.firstElementChild!.getAttribute('data-active')).toBe('false');
    act(() => useCommittedApplyStore.getState().bump('historyUndo'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(document.body.style.userSelect).toBe('');
  });
  it('일반 commit echo는 진행 중 스크럽을 취소하지 않는다', () => {
    act(() => {
      pointer('pointerdown', 0);
      pointer('pointermove', 20);
      useCommittedApplyStore.getState().bump(undefined);
      pointer('pointerup', 20);
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith(30);
    expect(cancel).not.toHaveBeenCalled();
  });
  it('history 잠금 중 직접 호출한 새 스크럽도 시작하지 않는다', () => {
    acquireHistoryEditorFlushLock('scrub-start');
    act(() => {
      handlers.onPointerDown({
        button: 0,
        pointerId: 1,
        clientX: 0,
        currentTarget: host.firstElementChild,
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent<HTMLElement>);
      pointer('pointermove', 20);
      pointer('pointerup', 20);
    });
    expect(move).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(host.firstElementChild!.getAttribute('data-active')).toBe('false');
  });
});
