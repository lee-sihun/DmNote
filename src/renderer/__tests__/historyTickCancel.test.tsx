// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { AlphaSlider } from '@components/main/Modal/content/pickers/colorPickerPrimitives';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { hsvToColorObject } from '@utils/color/colorUtils';
import type { ColorModeValue, GradientSpec } from '@src/types/color';

type GradientState = ReturnType<typeof useGradientColorState>;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ELEMENT_ID = '44444444-4444-4444-8444-444444444444';

const stored: GradientSpec = {
  angle: 180,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: 'rgba(255,0,0,0)', pos: 1 },
  ],
};

describe('undo/redo 반영 틱의 편집 세션 취소', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: ELEMENT_ID, index: 0 }]);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      useGradientEditStore.getState().setSession(null);
      useGridSelectionStore.getState().clearSelection();
    });
    host.remove();
  });

  it('useGradientColorState는 historyTick에 미커밋 초안을 버린다', () => {
    const stateCapture: { current: GradientState | null } = { current: null };
    const onCommit = vi.fn<(value: ColorModeValue) => void>();
    const Harness = () => {
      const state = useGradientColorState({
        pair: { color: '#ff0000', gradient: stored },
        fallbackColor: '#ffffff',
        contextKey: `key:${ELEMENT_ID}:noteBorder`,
        onCommit,
      });
      useEffect(() => {
        stateCapture.current = state;
      }, [state]);
      return null;
    };
    act(() => root.render(<Harness />));
    const latest = () => {
      if (!stateCapture.current) throw new Error('state not captured');
      return stateCapture.current;
    };

    // 드래그 프리뷰(미커밋 초안)
    act(() => latest().handlePickerColorChange('#00ff00', false));
    expect(latest().pickerColor).toBe('#00ff00');

    act(() => useCommittedApplyStore.getState().bump('historyUndo'));
    // 초안이 사라지고 저장값으로 돌아간다
    expect(latest().pickerColor).toBe('#ff0000');

    // 일반 커밋 echo는 초안을 건드리지 않는다
    act(() => latest().handlePickerColorChange('#00ff00', false));
    act(() => useCommittedApplyStore.getState().bump(undefined));
    expect(latest().pickerColor).toBe('#00ff00');
  });

  it('AlphaSlider 드래그는 historyTick에 커밋 없이 끝난다', () => {
    const proto = HTMLElement.prototype as HTMLElement & {
      setPointerCapture: (id: number) => void;
      releasePointerCapture: (id: number) => void;
      hasPointerCapture: (id: number) => boolean;
    };
    const original = {
      set: proto.setPointerCapture,
      release: proto.releasePointerCapture,
      has: proto.hasPointerCapture,
    };
    proto.setPointerCapture = () => {};
    proto.releasePointerCapture = () => {};
    proto.hasPointerCapture = () => false;
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 10,
        top: 0,
        left: 0,
        right: 100,
        bottom: 10,
        toJSON: () => ({}),
      } as DOMRect);
    try {
      const onChange = vi.fn();
      const onChangeComplete = vi.fn();
      act(() =>
        root.render(
          <AlphaSlider
            color={hsvToColorObject({ h: 0, s: 1, v: 1, a: 1 })}
            onChange={onChange}
            onChangeComplete={onChangeComplete}
          />,
        ),
      );
      const slider = host.querySelector('[role="slider"]') as HTMLElement;
      const pointer = (type: string, clientX: number) =>
        new (
          window as typeof globalThis & { PointerEvent: typeof MouseEvent }
        ).PointerEvent(type, {
          bubbles: true,
          clientX,
          clientY: 5,
          button: 0,
          pointerId: 1,
          isPrimary: true,
        } as PointerEventInit);
      act(() => {
        slider.dispatchEvent(pointer('pointerdown', 20));
      });
      expect(onChange).toHaveBeenCalled();

      act(() => useCommittedApplyStore.getState().bump('historyRedo'));
      act(() => {
        slider.dispatchEvent(pointer('pointerup', 80));
      });
      expect(onChangeComplete).not.toHaveBeenCalled();
    } finally {
      rect.mockRestore();
      proto.setPointerCapture = original.set;
      proto.releasePointerCapture = original.release;
      proto.hasPointerCapture = original.has;
    }
  });
});
