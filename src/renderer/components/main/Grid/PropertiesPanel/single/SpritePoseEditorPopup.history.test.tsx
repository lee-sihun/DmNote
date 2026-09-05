import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { drainPendingOptimisticCommits } from '@hooks/pendingOptimisticCommits';
import SpritePoseEditorPopup from './SpritePoseEditorPopup';
import {
  acquireHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from '@src/renderer/editor/runtime/historyEditorFlushLock';

vi.mock('@components/main/Grid/PropertiesPanel/PickerSurface', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@components/main/Grid/PropertiesPanel/PropertyInputs', () => ({
  PropertySection: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@components/main/common/Checkbox', () => ({ default: () => null }));
vi.mock('@components/main/common/Dropdown', () => ({ default: () => null }));
vi.mock('./SpriteImagePreviewCard', () => ({ default: () => null }));

describe('자세 팝업에서 숫자 스크럽의 history 취소 전달', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onTransformPreview = vi.fn();
  const onTransformCommit = vi.fn();
  const onTransformCancel = vi.fn();
  const onPivotPreview = vi.fn();
  const onPivotCommit = vi.fn();

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root.render(
        <SpritePoseEditorPopup
          open
          ariaLabel="pose"
          poseId="pose-a"
          transform={{ x: 0, y: 0, rotation: 0, scale: 1 }}
          pivot={{ x: 0.5, y: 0.5 }}
          followsBasePivot={false}
          referenceRef={createRef()}
          panelElement={host}
          poseControls={{
            keyOptions: [],
            triggers: [],
            isDuplicate: false,
            imageOverride: null,
            onToggleTrigger: vi.fn(),
            onImagePick: vi.fn(),
            onImageReset: vi.fn(),
          }}
          onTransformCommit={onTransformCommit}
          onTransformPreview={onTransformPreview}
          onTransformCancel={onTransformCancel}
          onPivotCommit={onPivotCommit}
          onPivotPreview={onPivotPreview}
          onPivotLinkChange={vi.fn()}
          onClose={vi.fn()}
          t={(key) => key}
        />,
      ),
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetHistoryEditorFlushLock();
  });

  it.each(
    [
      'propertiesPanel.spriteScale',
      'propertiesPanel.spriteStatePivot X',
    ].flatMap((ariaLabel) =>
      ['applied', 'locked'].map((boundary) => ({ ariaLabel, boundary })),
    ),
  )(
    '$ariaLabel, $boundary 취소 사유를 자세 프리뷰 소유자에게 전달한다',
    ({ ariaLabel, boundary }) => {
      const input = host.querySelector<HTMLInputElement>(
        `input[aria-label="${ariaLabel}"]`,
      )!;
      const handle = input.closest('label')!.querySelector('span')!;
      const pointer = (type: string, clientX: number) =>
        handle.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX,
          }),
        );
      act(() => {
        pointer('pointerdown', 0);
        pointer('pointermove', 5);
        drainPendingOptimisticCommits();
      });
      expect(
        onTransformPreview.mock.calls.length + onPivotPreview.mock.calls.length,
      ).toBe(1);
      onTransformPreview.mockClear();
      onPivotPreview.mockClear();
      act(() => {
        if (boundary === 'applied')
          useCommittedApplyStore.getState().bump('historyUndo');
        else acquireHistoryEditorFlushLock('popup-release');
        pointer('pointerup', 5);
        drainPendingOptimisticCommits();
      });
      expect(onTransformCancel).toHaveBeenCalledExactlyOnceWith('history');
      expect(onTransformPreview).not.toHaveBeenCalled();
      expect(onPivotPreview).not.toHaveBeenCalled();
      expect(onTransformCommit).not.toHaveBeenCalled();
      expect(onPivotCommit).not.toHaveBeenCalled();
      if (boundary === 'locked') {
        act(() => useCommittedApplyStore.getState().bump('historyUndo'));
        expect(onTransformCancel).toHaveBeenCalledOnce();
      }
    },
  );
});
