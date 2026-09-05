// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorInput } from '@components/main/Grid/PropertiesPanel/controls/PropertyInputs';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';

interface CapturedColorPickerProps {
  open: boolean;
  color: string;
  stateMode?: 'idle' | 'active';
  onStateModeChange?: (mode: 'idle' | 'active') => void;
  onColorChangeComplete: (color: string) => void;
}

const captured = vi.hoisted(() => ({
  colorPickerProps: null as CapturedColorPickerProps | null,
}));

vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: (props: CapturedColorPickerProps) => {
    captured.colorPickerProps = props;
    // 퇴장 유예 동안 DOM은 남지만 open은 즉시 false - 닫힘 판정은 open이 소유
    return props.open ? <div data-testid="color-picker" /> : null;
  },
}));

vi.mock('@components/main/Modal/FloatingPopup', () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="floating-popup">{children}</div> : null,
}));

vi.mock('@hooks/ui/usePanelAnchoredPopupPosition', () => ({
  usePanelAnchoredPopupPosition: () => null,
  useTriggerAnchoredPopupPosition: () => ({ settled: true, position: null }),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('상태별 피커 capability 전환', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    captured.colorPickerProps = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('ColorInput은 상태 탭이 사라지면 열린 피커를 닫고 대기 색만 기록한다', () => {
    const onChange = vi.fn();
    const onActiveChange = vi.fn();
    const renderInput = (showStateTabs: boolean) =>
      root.render(
        <ColorInput
          value="#111111"
          activeValue="#222222"
          onChange={onChange}
          onActiveChange={onActiveChange}
          showStateTabs={showStateTabs}
          pickerMountStrategy="sync"
        />,
      );

    act(() => renderInput(true));
    act(() => host.querySelector('button')?.click());
    act(() => captured.colorPickerProps?.onStateModeChange?.('active'));
    expect(captured.colorPickerProps?.stateMode).toBe('active');

    act(() => renderInput(false));
    expect(host.querySelector('[data-testid="color-picker"]')).toBeNull();

    act(() => host.querySelector('button')?.click());
    expect(captured.colorPickerProps?.stateMode).toBeUndefined();
    expect(captured.colorPickerProps?.color).toBe('#111111');
    act(() => captured.colorPickerProps?.onColorChangeComplete('#abcdef'));

    expect(onChange).toHaveBeenLastCalledWith('#abcdef');
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it('ImagePicker는 capability가 사라지면 탭 없이 대기 이미지 경로만 쓴다', () => {
    const onIdleImageReset = vi.fn();
    const onActiveImageReset = vi.fn();
    const referenceRef = React.createRef<HTMLButtonElement>();
    const renderPicker = (showActiveState: boolean) =>
      root.render(
        <ImagePicker
          open
          referenceRef={referenceRef}
          idleImage="idle.png"
          activeImage="active.png"
          onIdleImageReset={onIdleImageReset}
          onActiveImageReset={onActiveImageReset}
          onClose={vi.fn()}
          showActiveState={showActiveState}
        />,
      );

    act(() => renderPicker(true));
    const activeTab = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'imagePicker.active',
    );
    act(() => activeTab?.click());

    act(() => renderPicker(false));
    expect(host.textContent).not.toContain('imagePicker.active');
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[title="imagePicker.reset"]')
        ?.click(),
    );

    expect(onIdleImageReset).toHaveBeenCalledOnce();
    expect(onActiveImageReset).not.toHaveBeenCalled();
  });
});
