import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import type { HostGlobalApi } from '@src/renderer/api/hostGlobalApi';
import type { KeySlot } from '@src/types/key/keys';
import type { KeySlotUiMode } from '@utils/keySlot';
import SingleMappingSection from './SingleMappingSection';

interface CapturedPickerProps {
  open: boolean;
  members: string[];
  mode: KeySlotUiMode;
  onClose: () => void;
}

const captured = vi.hoisted(() => ({
  picker: null as CapturedPickerProps | null,
}));

vi.mock('@components/main/common/KeySlotPicker', () => ({
  default: (props: CapturedPickerProps) => {
    captured.picker = props;
    return null;
  },
}));

vi.mock('../controls/PropertyInputs', () => ({
  PropertySection: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  PropertyRow: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

interface HarnessProps {
  keyIndex: number;
  keySlot: KeySlot;
  onKeyMappingChange: (index: number, slot: KeySlot) => void;
}

const Harness = ({ keyIndex, keySlot, onKeyMappingChange }: HarnessProps) => (
  <SingleMappingSection
    keyIndex={keyIndex}
    keySlot={keySlot}
    onKeyMappingChange={onKeyMappingChange}
    t={(key) => key}
  />
);

describe('SingleMappingSection 선택 전환 수명', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rawInputListener: ((payload: unknown) => void) | null;
  let originalApi: HostGlobalApi;
  let onKeyMappingChange: Mock<(index: number, slot: KeySlot) => void>;

  const render = (keyIndex: number, keySlot: KeySlot) => {
    act(() => {
      root.render(
        <Harness
          keyIndex={keyIndex}
          keySlot={keySlot}
          onKeyMappingChange={onKeyMappingChange}
        />,
      );
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    captured.picker = null;
    rawInputListener = null;
    originalApi = window.api;
    window.api = {
      keys: {
        onRawInput: vi.fn((listener: (payload: unknown) => void) => {
          rawInputListener = listener;
          return vi.fn();
        }),
      },
    } as unknown as HostGlobalApi;
    onKeyMappingChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.api = originalApi;
    delete window.__dmn_isKeyListening;
  });

  it('열린 picker를 유지하면서 새 선택의 slot mode와 멤버로 전환한다', () => {
    render(0, { keys: ['A', 'B'], match: 'all' });
    const configureButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'propertiesPanel.configure',
    );
    expect(configureButton).toBeDefined();

    act(() => configureButton?.click());
    expect(captured.picker).toMatchObject({
      open: true,
      members: ['A', 'B'],
      mode: 'all',
    });

    render(1, 'C');

    expect(captured.picker).toMatchObject({
      open: true,
      members: ['C'],
      mode: 'single',
    });
  });

  it('캡처 중 선택이 바뀌면 완료를 최신 keyIndex와 slot에 적용한다', () => {
    render(0, 'A');
    const captureButton = host.querySelector('button');
    expect(captureButton).not.toBeNull();

    act(() => captureButton?.click());
    expect(rawInputListener).not.toBeNull();

    render(1, 'B');
    act(() => {
      rawInputListener?.({ state: 'DOWN', label: 'C' });
    });

    expect(onKeyMappingChange).toHaveBeenCalledTimes(1);
    expect(onKeyMappingChange).toHaveBeenCalledWith(1, 'C');
  });
});
