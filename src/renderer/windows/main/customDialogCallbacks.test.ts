// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  closeCustomDialogOwnedSurface,
  replaceCustomDialogCallbacks,
} from './customDialogCallbacks';

describe('custom dialog callback lifecycle', () => {
  it('새 dialog로 교체할 때 이전 요청을 cancel로 settle한다', () => {
    const onCancel = vi.fn();
    const next = { onConfirm: vi.fn() };
    const ref = { current: { onCancel } };

    replaceCustomDialogCallbacks(ref, next);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(ref.current).toBe(next);
  });

  it('cancel 재진입 전에 callback ref를 새 소유자로 교체한다', () => {
    const next = { onConfirm: vi.fn() };
    const ref = {
      current: {
        onCancel: () => expect(ref.current).toBe(next),
      },
    };

    replaceCustomDialogCallbacks(ref, next);
  });

  it('plugin dialog 내부 anchor의 picker만 함께 닫는다', () => {
    const root = document.createElement('div');
    root.setAttribute('data-plugin-dialog-content', '');
    const anchor = document.createElement('button');
    root.appendChild(anchor);
    const close = vi.fn();

    closeCustomDialogOwnedSurface(anchor, close);
    closeCustomDialogOwnedSurface(document.createElement('button'), close);

    expect(close).toHaveBeenCalledOnce();
  });
});
