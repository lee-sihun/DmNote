import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@components/main/Grid/PropertiesPanel/PickerSurface', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@components/main/common/TabSwitch', () => ({ default: () => null }));
// 트랙은 실제 것을 쓴다. 입력과 트랙 사이의 편집 소유권 전환이 검증 대상
vi.mock('./colorPickerPrimitives', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./colorPickerPrimitives')
  >();
  return { ...actual, HueSlider: () => null };
});

import ColorPicker from './ColorPicker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressKey = (input: HTMLInputElement, key: string) => {
  const keydown = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(keydown);
  input.dispatchEvent(
    new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }),
  );
  return keydown;
};

const pointerDown = (target: HTMLElement, clientX: number) => {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    clientX,
    clientY: 5,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
  });
  target.dispatchEvent(event);
};

const alphaOf = (rgba: unknown) =>
  Number(String(rgba).match(/,\s*([\d.]+)\)$/)?.[1]);

const referenceRef = () => createRef<HTMLElement>() as never;

const mockTrack = (track: HTMLElement) => {
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    right: 100,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.defineProperties(track, {
    setPointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
    releasePointerCapture: { value: vi.fn() },
  });
  return track;
};

// after-paint 커밋(rAF → setTimeout)을 지금 흘려보낸다
const flushAfterPaint = () => {
  act(() => {
    vi.advanceTimersToNextFrame();
    vi.runOnlyPendingTimers();
  });
};

// 불투명도 % 칸은 속성 패널 숫자 입력과 같은 컴포넌트라 수식과 방향키가 먹는다
describe('ColorPicker 불투명도 % 입력', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const useFrameTimers = () =>
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });

  const percentInputs = () =>
    Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[inputmode="numeric"]',
      ),
    );
  const percentInput = () => percentInputs()[0];

  const renderSolid = () => {
    const onColorChange = vi.fn();
    const onColorChangeComplete = vi.fn();
    act(() =>
      root.render(
        <ColorPicker
          open
          referenceRef={referenceRef()}
          color="rgba(255, 0, 0, 0.5)"
          solidOnly
          onColorChange={onColorChange}
          onColorChangeComplete={onColorChangeComplete}
          onClose={vi.fn()}
        />,
      ),
    );
    return { onColorChange, onColorChangeComplete };
  };

  const renderOpacity = (
    opacityPercent: number | { top: number; bottom: number },
    extra: Partial<React.ComponentProps<typeof ColorPicker>> = {},
  ) => {
    const onOpacityPercentChange = vi.fn();
    const onOpacityPercentChangeComplete = vi.fn();
    act(() =>
      root.render(
        <ColorPicker
          open
          referenceRef={referenceRef()}
          color={
            typeof opacityPercent === 'number'
              ? '#FF0000'
              : { type: 'gradient', top: '#FF0000', bottom: '#0000FF' }
          }
          opacityPercent={opacityPercent}
          opacityPercentLabel="Opacity"
          onOpacityPercentChange={onOpacityPercentChange}
          onOpacityPercentChangeComplete={onOpacityPercentChangeComplete}
          onClose={vi.fn()}
          {...extra}
        />,
      ),
    );
    return { onOpacityPercentChange, onOpacityPercentChangeComplete };
  };

  describe('solidOnly alpha', () => {
    it('수식을 Enter로 확정하면 alpha가 rgba로 나간다', () => {
      const { onColorChangeComplete } = renderSolid();
      const input = percentInput();
      expect(input.value).toBe('50');

      act(() => input.focus());
      act(() => setInputValue(input, '50+10'));
      act(() => pressKey(input, 'Enter'));

      expect(onColorChangeComplete).toHaveBeenCalledTimes(1);
      expect(alphaOf(onColorChangeComplete.mock.calls[0][0])).toBe(0.6);
      expect(input.value).toBe('60');
    });

    it('방향키는 preview만 움직이고 확정은 Enter가 한다', () => {
      const { onColorChangeComplete } = renderSolid();
      const input = percentInput();

      act(() => input.focus());
      act(() => pressKey(input, 'ArrowUp'));
      expect(input.value).toBe('51');
      expect(onColorChangeComplete).not.toHaveBeenCalled();

      act(() => pressKey(input, 'Enter'));
      expect(onColorChangeComplete).toHaveBeenCalledTimes(1);
      expect(alphaOf(onColorChangeComplete.mock.calls[0][0])).toBe(0.51);
    });

    it('빈 값으로 blur하면 확정 없이 편집 전 값으로 돌아온다', () => {
      const { onColorChangeComplete } = renderSolid();
      const input = percentInput();

      act(() => input.focus());
      act(() => setInputValue(input, ''));
      act(() => input.blur());

      expect(onColorChangeComplete).not.toHaveBeenCalled();
      expect(input.value).toBe('50');
    });

    it('수정한 뒤 Escape는 이 필드가 소비하고 값을 되돌린다', () => {
      const { onColorChangeComplete } = renderSolid();
      const input = percentInput();

      act(() => input.focus());
      act(() => setInputValue(input, '70'));
      let keydown!: KeyboardEvent;
      act(() => {
        keydown = pressKey(input, 'Escape');
      });

      expect(keydown.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(input);
      expect(input.value).toBe('50');
      expect(onColorChangeComplete).not.toHaveBeenCalled();
    });

    it('손대지 않은 필드의 Escape는 위로 올려 팝업이 닫히게 둔다', () => {
      renderSolid();
      const input = percentInput();

      act(() => input.focus());
      let keydown!: KeyboardEvent;
      act(() => {
        keydown = pressKey(input, 'Escape');
      });

      expect(keydown.defaultPrevented).toBe(false);
    });

    it('preview가 나간 뒤 빈 값으로 blur하면 확정값을 preview로 되돌린다', () => {
      useFrameTimers();
      const { onColorChange, onColorChangeComplete } = renderSolid();
      const input = percentInput();

      act(() => input.focus());
      act(() => setInputValue(input, '7'));
      flushAfterPaint();
      expect(alphaOf(onColorChange.mock.lastCall?.[0])).toBe(0.07);

      act(() => setInputValue(input, ''));
      act(() => input.blur());

      expect(alphaOf(onColorChange.mock.lastCall?.[0])).toBe(0.5);
      expect(onColorChangeComplete).not.toHaveBeenCalled();
      expect(input.value).toBe('50');
    });

    it('hex를 치고 바로 채도 트랙을 누르면 새 hex의 색상에서 출발한다', () => {
      const { onColorChange } = renderSolid();
      const hexInput = container.querySelector<HTMLInputElement>(
        'input:not([inputmode])',
      )!;
      const track = mockTrack(
        container.querySelector<HTMLElement>(
          '[role="slider"][aria-label="Saturation and brightness"]',
        )!,
      );

      act(() => hexInput.focus());
      act(() => setInputValue(hexInput, '00FF00'));
      // 채도 100%: 옛 hex(빨강)에서 출발하면 r 채널이, 새 hex(초록)면 g 채널만 남는다
      act(() => pointerDown(track, 100));

      expect(document.activeElement).not.toBe(hexInput);
      expect(String(onColorChange.mock.lastCall?.[0])).toMatch(
        /^rgba\(0, \d+, 0,/,
      );
    });

    it('슬라이더 드래그 시작은 입력 draft를 먼저 확정한 뒤 preview를 낸다', () => {
      const { onColorChange, onColorChangeComplete } = renderSolid();
      const input = percentInput();
      const track = mockTrack(
        container.querySelector<HTMLElement>(
          '[role="slider"][aria-label="Alpha"]',
        )!,
      );

      act(() => input.focus());
      act(() => setInputValue(input, '70'));
      act(() => pointerDown(track, 20));

      expect(document.activeElement).not.toBe(input);
      expect(onColorChangeComplete).toHaveBeenCalledTimes(1);
      expect(alphaOf(onColorChangeComplete.mock.calls[0][0])).toBe(0.7);
      const sliderPreview = onColorChange.mock.calls.findIndex(
        (call) => alphaOf(call[0]) === 0.2,
      );
      expect(sliderPreview).toBeGreaterThanOrEqual(0);
      expect(onColorChangeComplete.mock.invocationCallOrder[0]).toBeLessThan(
        onColorChange.mock.invocationCallOrder[sliderPreview],
      );
    });
  });

  describe('호출부 opacity 모드', () => {
    it('확정값은 상한으로 재워 change와 complete에 같은 값으로 나간다', () => {
      const { onOpacityPercentChange, onOpacityPercentChangeComplete } =
        renderOpacity(40);
      const input = percentInput();
      expect(input.value).toBe('40');
      expect(input.getAttribute('aria-label')).toBe('Opacity');

      act(() => input.focus());
      act(() => setInputValue(input, '40*2+500'));
      act(() => pressKey(input, 'Enter'));

      expect(onOpacityPercentChange).toHaveBeenLastCalledWith(100, 'solid');
      expect(onOpacityPercentChangeComplete).toHaveBeenCalledTimes(1);
      expect(onOpacityPercentChangeComplete).toHaveBeenCalledWith(100, 'solid');
    });

    it('빈 값으로 blur하면 0을 확정하지 않고 시작값으로 돌아온다', () => {
      const { onOpacityPercentChange, onOpacityPercentChangeComplete } =
        renderOpacity(40);
      const input = percentInput();

      act(() => input.focus());
      act(() => setInputValue(input, ''));
      act(() => input.blur());

      expect(onOpacityPercentChangeComplete).not.toHaveBeenCalled();
      expect(onOpacityPercentChange).not.toHaveBeenCalled();
      expect(input.value).toBe('40');
    });

    it('Escape 원복은 호출부 cancel로 위임해 preview를 다시 내보내지 않는다', () => {
      useFrameTimers();
      const onOpacityPercentCancel = vi.fn();
      const { onOpacityPercentChange, onOpacityPercentChangeComplete } =
        renderOpacity(40, { onOpacityPercentCancel });
      const input = percentInput();

      act(() => input.focus());
      act(() => setInputValue(input, '70'));
      flushAfterPaint();
      expect(onOpacityPercentChange).toHaveBeenLastCalledWith(70, 'solid');
      onOpacityPercentChange.mockClear();
      act(() => pressKey(input, 'Escape'));

      expect(onOpacityPercentCancel).toHaveBeenCalledWith('solid');
      expect(onOpacityPercentChange).not.toHaveBeenCalled();
      expect(onOpacityPercentChangeComplete).not.toHaveBeenCalled();
      expect(input.value).toBe('40');
    });

    it('그라데이션은 상·하단 칸이 각자의 target으로 확정한다', () => {
      const { onOpacityPercentChangeComplete } = renderOpacity({
        top: 30,
        bottom: 70,
      });
      const [top, bottom] = percentInputs();
      expect(top.value).toBe('30');
      expect(bottom.value).toBe('70');

      act(() => bottom.focus());
      act(() => setInputValue(bottom, '70+5'));
      act(() => pressKey(bottom, 'Enter'));
      expect(onOpacityPercentChangeComplete).toHaveBeenLastCalledWith(
        75,
        'bottom',
      );

      act(() => top.focus());
      act(() => setInputValue(top, '30-5'));
      act(() => pressKey(top, 'Enter'));
      expect(onOpacityPercentChangeComplete).toHaveBeenLastCalledWith(
        25,
        'top',
      );
    });

    it('solidOnly는 호출부 opacity 제어를 켜지 않는다', () => {
      renderOpacity(40, { solidOnly: true, color: 'rgba(255, 0, 0, 0.5)' });

      expect(percentInputs()).toHaveLength(1);
      expect(percentInput().value).toBe('50');
      expect(
        container.querySelectorAll('[role="slider"][aria-label="Alpha"]'),
      ).toHaveLength(1);
    });

    it('opacityPercentMixed면 Mixed를 보여주고 입력은 절대값으로 나간다', () => {
      const { onOpacityPercentChangeComplete } = renderOpacity(40, {
        opacityPercentMixed: true,
      });
      const input = percentInput();
      expect(input.value).toBe('');
      expect(input.placeholder).toBe('Mixed');

      act(() => input.focus());
      act(() => setInputValue(input, '55'));
      act(() => pressKey(input, 'Enter'));

      expect(onOpacityPercentChangeComplete).toHaveBeenCalledWith(55, 'solid');
    });

    it('Mixed에서 방향키는 대표값을 기준으로 움직인다', () => {
      const { onOpacityPercentChangeComplete } = renderOpacity(40, {
        opacityPercentMixed: true,
      });
      const input = percentInput();

      act(() => input.focus());
      act(() => pressKey(input, 'ArrowUp'));
      expect(input.value).toBe('41');
      act(() => pressKey(input, 'Enter'));

      expect(onOpacityPercentChangeComplete).toHaveBeenCalledWith(41, 'solid');
    });
  });
  describe('배치 Mixed 표시', () => {
    const hexInput = () =>
      container.querySelector<HTMLInputElement>('input:not([inputmode])')!;

    const renderMixedSolid = (mixed: {
      hexMixed?: boolean;
      opacityPercentMixed?: boolean;
    }) => {
      const onColorChange = vi.fn();
      const onColorChangeComplete = vi.fn();
      act(() =>
        root.render(
          <ColorPicker
            open
            referenceRef={referenceRef()}
            color="rgba(255, 255, 255, 1)"
            solidOnly
            onColorChange={onColorChange}
            onColorChangeComplete={onColorChangeComplete}
            onClose={vi.fn()}
            {...mixed}
          />,
        ),
      );
      return { onColorChange, onColorChangeComplete };
    };

    it('hexMixed면 hex 칸이 비고 Mixed placeholder가 뜬다', () => {
      renderMixedSolid({ hexMixed: true });
      const input = hexInput();
      expect(input.value).toBe('');
      expect(input.placeholder).toBe('Mixed');
      // % 칸은 알파가 공통이면 대표값 그대로
      expect(percentInput().value).toBe('100');
    });

    it('solidOnly alpha도 opacityPercentMixed면 % 칸에 Mixed가 뜬다', () => {
      renderMixedSolid({ opacityPercentMixed: true });
      expect(percentInput().value).toBe('');
      expect(percentInput().placeholder).toBe('Mixed');
      expect(hexInput().value).toBe('FFFFFF');
    });

    it('Mixed hex 칸을 손대지 않고 blur하면 대표값을 확정하지 않는다', () => {
      const { onColorChangeComplete } = renderMixedSolid({ hexMixed: true });
      const input = hexInput();

      act(() => input.focus());
      expect(input.value).toBe('');
      act(() => input.blur());

      expect(onColorChangeComplete).not.toHaveBeenCalled();
      expect(input.placeholder).toBe('Mixed');
    });

    it('Mixed hex 칸에 값을 치고 Enter하면 그 값이 전체에 확정된다', () => {
      const { onColorChangeComplete } = renderMixedSolid({ hexMixed: true });
      const input = hexInput();

      act(() => input.focus());
      act(() => setInputValue(input, 'FF0000'));
      act(() => pressKey(input, 'Enter'));

      expect(onColorChangeComplete).toHaveBeenCalledTimes(1);
      expect(String(onColorChangeComplete.mock.calls[0][0])).toMatch(
        /^rgba\(255, 0, 0,/,
      );
    });

    it('Mixed hex 칸을 손대지 않고 Enter해도 확정하지 않는다', () => {
      const { onColorChangeComplete } = renderMixedSolid({ hexMixed: true });
      const input = hexInput();

      act(() => input.focus());
      act(() => pressKey(input, 'Enter'));

      expect(onColorChangeComplete).not.toHaveBeenCalled();
    });

    it('Mixed alpha를 preview한 뒤 Escape하면 편집 전 alpha를 preview로 되돌린다', () => {
      useFrameTimers();
      const { onColorChange, onColorChangeComplete } = renderMixedSolid({
        opacityPercentMixed: true,
      });
      const input = percentInput();

      act(() => input.focus());
      act(() => setInputValue(input, '30'));
      flushAfterPaint();
      expect(alphaOf(onColorChange.mock.lastCall?.[0])).toBe(0.3);

      act(() => pressKey(input, 'Escape'));

      expect(alphaOf(onColorChange.mock.lastCall?.[0])).toBe(1);
      expect(onColorChangeComplete).not.toHaveBeenCalled();
      expect(input.placeholder).toBe('Mixed');
    });

    it('취소 콜백이 있으면 preview 없이 조용히 되돌리고 호출부에 맡긴다', () => {
      useFrameTimers();
      const onOpacityPercentCancel = vi.fn();
      const onColorChange = vi.fn();
      act(() =>
        root.render(
          <ColorPicker
            open
            referenceRef={referenceRef()}
            color="rgba(255, 255, 255, 1)"
            solidOnly
            opacityPercentMixed
            onColorChange={onColorChange}
            onColorChangeComplete={vi.fn()}
            onOpacityPercentCancel={onOpacityPercentCancel}
            onClose={vi.fn()}
          />,
        ),
      );
      const input = percentInput();

      act(() => input.focus());
      act(() => setInputValue(input, '30'));
      flushAfterPaint();
      onColorChange.mockClear();
      act(() => pressKey(input, 'Escape'));

      expect(onOpacityPercentCancel).toHaveBeenCalledWith('solid');
      expect(onColorChange).not.toHaveBeenCalled();
      // 되돌린 alpha에서 다음 편집이 출발한다
      act(() => input.focus());
      act(() => pressKey(input, 'ArrowUp'));
      expect(input.value).toBe('100');
    });

    it('그라데이션은 상·하단 Mixed를 따로 받는다', () => {
      renderOpacity(
        { top: 30, bottom: 70 },
        { opacityPercentMixed: { top: true, bottom: false } },
      );
      const [top, bottom] = percentInputs();
      expect(top.value).toBe('');
      expect(top.placeholder).toBe('Mixed');
      expect(bottom.value).toBe('70');
    });
  });
});
