import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelNavProvider } from '../navigation/PanelNavContext';
import SoundSection from './SoundSection';

const captured = vi.hoisted(() => ({
  soundPicker: null as Record<string, unknown> | null,
}));

vi.mock('@components/main/common/Checkbox', () => ({
  default: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: () => void;
  }) => (
    <button type="button" data-testid="sound-enabled" onClick={onChange}>
      {String(checked)}
    </button>
  ),
}));

vi.mock('@components/main/Modal/content/pickers/SoundPicker', () => ({
  default: (props: Record<string, unknown>) => {
    captured.soundPicker = props;
    return <div data-testid="sound-picker" />;
  },
}));

vi.mock('./PropertyInputs', () => ({
  PropertySection: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  PropertyRow: ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
  NumberInput: ({
    onChange,
    onPreview,
    onCancel,
  }: {
    onChange: (value: number) => void;
    onPreview?: (value: number) => void;
    onCancel?: () => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="volume-commit"
        onClick={() => onChange(250)}
      />
      <button
        type="button"
        data-testid="volume-preview"
        onClick={() => onPreview?.(-10)}
      />
      <button
        type="button"
        data-testid="volume-cancel"
        onClick={() => onCancel?.()}
      />
    </div>
  ),
}));

describe('SoundSection', () => {
  let host: HTMLDivElement;
  let pageHost: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    pageHost = document.createElement('div');
    document.body.append(host, pageHost);
    root = createRoot(host);
    captured.soundPicker = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    pageHost.remove();
  });

  const click = (testId: string) => {
    const button = host.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`,
    );
    expect(button).not.toBeNull();
    act(() => button?.click());
  };

  it('mixed 표시와 single preview/cancel 정책을 명시된 콜백으로 전달한다', () => {
    const enabledCommit = vi.fn();
    const volumeCommit = vi.fn();
    const volumePreview = vi.fn();
    const volumeCancel = vi.fn();

    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost,
          }}
        >
          <SoundSection
            pageKey="test:sound"
            completionBinding="element-id"
            soundEnabled={{ value: false, isMixed: true }}
            soundPath={{ value: '', isMixed: true }}
            soundVolume={{ value: 100, isMixed: true }}
            onSoundEnabledCommit={enabledCommit}
            onSoundPathCommit={vi.fn()}
            onSoundVolumeCommit={volumeCommit}
            onSoundVolumePreview={volumePreview}
            onSoundVolumeCancel={volumeCancel}
            t={(key) => key}
          />
        </PanelNavProvider>,
      );
    });

    expect(host.textContent?.match(/Mixed/g)).toHaveLength(3);
    click('sound-enabled');
    click('volume-commit');
    click('volume-preview');
    click('volume-cancel');

    expect(enabledCommit).toHaveBeenCalledWith(true);
    expect(volumeCommit).toHaveBeenCalledWith(200);
    expect(volumePreview).toHaveBeenCalledWith(0);
    expect(volumeCancel).toHaveBeenCalledOnce();
  });

  it('페이지 토글과 SoundPicker completion 계약을 보존한다', () => {
    const openPage = vi.fn();
    const closePage = vi.fn();
    const beforeToggle = vi.fn();
    const pathCommit = vi.fn();
    const render = (activePageKey: string | null) => {
      act(() => {
        root.render(
          <PanelNavProvider
            value={{
              activePageKey,
              renderPageKey: activePageKey,
              openPage,
              closePage,
              pageHost,
            }}
          >
            <SoundSection
              pageKey="test:sound"
              completionBinding="element-id"
              soundEnabled={{ value: true, isMixed: false }}
              soundPath={{ value: 'sound.wav', isMixed: false }}
              soundVolume={{ value: 80, isMixed: false }}
              onSoundEnabledCommit={vi.fn()}
              onSoundPathCommit={pathCommit}
              onSoundVolumeCommit={vi.fn()}
              onBeforeToggle={beforeToggle}
              t={(key) => key}
            />
          </PanelNavProvider>,
        );
      });
    };

    render(null);
    const configure = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'propertiesPanel.configure',
    );
    expect(configure).toBeDefined();
    act(() => configure?.click());
    expect(beforeToggle).toHaveBeenCalledOnce();
    expect(openPage).toHaveBeenCalledWith('test:sound');

    render('test:sound');
    act(() =>
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent === 'propertiesPanel.configure')
        ?.click(),
    );
    expect(closePage).toHaveBeenCalledOnce();
    expect(captured.soundPicker).toMatchObject({
      open: true,
      completionBinding: 'element-id',
      selectedSound: 'sound.wav',
      previewVolume: 80,
    });
    act(() =>
      (captured.soundPicker?.onSoundSelect as (path: string | null) => void)(
        null,
      ),
    );
    expect(pathCommit).toHaveBeenCalledWith('');
  });
});
