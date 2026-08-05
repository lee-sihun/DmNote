// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyPosition } from '@src/types/key/keys';
import { createDefaultCounterSettings } from '@src/types/key/keys';
import StyleTabContent from '@components/main/Grid/PropertiesPanel/single/StyleTabContent';
import CounterTabContent from '@components/main/Grid/PropertiesPanel/single/CounterTabContent';
import { PanelNavProvider } from '@components/main/Grid/PropertiesPanel/PanelNavContext';

interface CapturedColorPickerProps {
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
    return <div data-testid="color-picker" />;
  },
}));

vi.mock('@components/main/Grid/PropertiesPanel/ShadowControls', () => ({
  default: () => null,
}));

const counter = createDefaultCounterSettings();
const keyPosition = {
  dx: 0,
  dy: 0,
  width: 60,
  height: 60,
  count: 0,
  backgroundColor: '#111111',
  activeBackgroundColor: '#222222',
  borderColor: '#333333',
  activeBorderColor: '#444444',
  fontColor: '#555555',
  activeFontColor: '#666666',
  counter: {
    ...counter,
    fill: { idle: '#112233', active: '#445566' },
    stroke: { idle: '#778899', active: '#aabbcc' },
  },
} as KeyPosition;

const navValue = {
  activePageKey: null,
  renderPageKey: null,
  openPage: vi.fn(),
  closePage: vi.fn(),
  pageHost: null,
};

const findFirstSwatch = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button')).find((button) =>
    button.className.includes('w-[23px]'),
  );

describe('단일 통계 active 색 편집 차단', () => {
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

  it('StyleTabContent는 키에서 통계로 바뀌면 피커를 닫고 idle 필드만 기록한다', () => {
    const onKeyUpdate = vi.fn();
    const renderStyle = (showActiveState: boolean) =>
      root.render(
        <PanelNavProvider value={navValue}>
          <StyleTabContent
            keyIndex={0}
            keyPosition={keyPosition}
            keyCode={null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={onKeyUpdate}
            shadowActiveState={showActiveState}
            showSoundControls={false}
            t={(key) => key}
          />
        </PanelNavProvider>,
      );

    act(() => renderStyle(true));
    act(() => findFirstSwatch(host)?.click());
    act(() => captured.colorPickerProps?.onStateModeChange?.('active'));
    expect(captured.colorPickerProps?.stateMode).toBe('active');

    act(() => renderStyle(false));
    expect(host.querySelector('[data-testid="color-picker"]')).toBeNull();

    act(() => findFirstSwatch(host)?.click());
    expect(captured.colorPickerProps?.stateMode).toBeUndefined();
    expect(captured.colorPickerProps?.color).toBe('#111111');
    act(() => captured.colorPickerProps?.onColorChangeComplete('#abcdef'));

    const update = onKeyUpdate.mock.calls.at(-1)?.[0];
    expect(update.backgroundColor).toBe('#abcdef');
    expect(update).not.toHaveProperty('activeBackgroundColor');
  });

  it('CounterTabContent는 키에서 통계로 바뀌면 피커를 닫고 idle 쌍만 바꾼다', () => {
    const onKeyUpdate = vi.fn();
    const renderCounter = (isStat: boolean) =>
      root.render(
        <PanelNavProvider value={navValue}>
          <CounterTabContent
            keyIndex={0}
            keyPosition={keyPosition}
            isStat={isStat}
            onKeyUpdate={onKeyUpdate}
            t={(key) => key}
          />
        </PanelNavProvider>,
      );

    act(() => renderCounter(false));
    act(() => findFirstSwatch(host)?.click());
    act(() => captured.colorPickerProps?.onStateModeChange?.('active'));
    expect(captured.colorPickerProps?.stateMode).toBe('active');

    act(() => renderCounter(true));
    expect(host.querySelector('[data-testid="color-picker"]')).toBeNull();

    act(() => findFirstSwatch(host)?.click());
    expect(captured.colorPickerProps?.stateMode).toBeUndefined();
    expect(captured.colorPickerProps?.color).toBe('#112233');
    act(() => captured.colorPickerProps?.onColorChangeComplete('#abcdef'));

    const update = onKeyUpdate.mock.calls.at(-1)?.[0];
    expect(update.counter.fill.idle).toBe('#abcdef');
    expect(update.counter.fill.active).toBe('#445566');
  });
});
