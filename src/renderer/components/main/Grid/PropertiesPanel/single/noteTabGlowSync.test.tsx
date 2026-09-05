// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteTabContent from './NoteTabContent';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type { EditorElementPropertyPatchV1 } from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';

const captured = vi.hoisted(() => ({
  pickerOpen: false,
}));

vi.mock('@components/main/Modal/content/pickers/color/ColorPicker', () => ({
  default: () => {
    captured.pickerOpen = true;
    return null;
  },
}));
vi.mock('@components/main/Modal/PopupExit', () => ({
  default: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactElement | null;
  }) => (open ? children : null),
}));
vi.mock('@components/main/Modal/content/pickers/color/ColorSwatch', async () => {
  const ReactModule = await import('react');
  return {
    ColorSwatchButton: ReactModule.forwardRef<
      HTMLButtonElement,
      { onClick?: () => void; disabled?: boolean }
    >(function SwatchStub(props, ref) {
      return (
        <button
          ref={ref}
          data-testid="swatch"
          disabled={props.disabled}
          onClick={props.onClick}
        />
      );
    }),
  };
});
vi.mock('../controls/PropertyInputs', () => ({
  PropertyRow: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PropertySection: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  NumberInput: () => null,
  OptionalNumberInput: () => null,
}));
vi.mock('@components/main/common/checkbox/Checkbox', () => ({
  default: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: () => void;
  }) => (
    <button
      data-testid="checkbox"
      data-checked={checked ? 'true' : 'false'}
      onClick={onChange}
    />
  ),
}));
vi.mock('@components/main/common/dropdown/Dropdown', () => ({
  default: ({
    options,
    value,
    onChange,
  }: {
    options: { value: string }[];
    value: string;
    onChange: (value: string) => void;
  }) => (
    <div data-testid="dropdown" data-value={value}>
      {options.map((option) => (
        <button
          key={option.value}
          data-testid={`dropdown-${option.value}`}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ELEMENT_ID = '44444444-4444-4444-8444-444444444444';

const position = (noteGlowSyncPaint: boolean): KeyPosition => ({
  ...createDefaultKeyPosition(),
  id: ELEMENT_ID,
  noteGlowSyncPaint,
});

describe('NoteTabContent 글로우 색상 노트 동기화', () => {
  let root: Root;
  let host: HTMLDivElement;
  let commit: ReturnType<
    typeof vi.fn<(patch: EditorElementPropertyPatchV1) => void>
  >;

  const render = (keyPosition: KeyPosition) => {
    act(() =>
      root.render(
        <NoteTabContent
          keyPosition={keyPosition}
          onElementPropertyCommit={commit}
          t={(key) => key}
        />,
      ),
    );
  };

  // 스와치 순서: 노트(0) → 테두리(1) → 글로우(2)
  const glowSwatch = () =>
    host.querySelectorAll('[data-testid="swatch"]')[2] as HTMLButtonElement;
  // 드롭다운 순서: 노트 정렬(0) → 테두리 방향(1) → 글로우 소스(2)
  const sourceDropdown = () =>
    host.querySelectorAll('[data-testid="dropdown"]')[2] as HTMLDivElement;
  const pickSource = (value: 'follow' | 'custom') => {
    act(() => {
      (
        sourceDropdown().querySelector(
          `[data-testid="dropdown-${value}"]`,
        ) as HTMLButtonElement
      ).click();
    });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    captured.pickerOpen = false;
    commit = vi.fn<(patch: EditorElementPropertyPatchV1) => void>();
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
    });
    host.remove();
  });

  it('따라가기면 글로우 스와치가 잠기고 피커가 열리지 않는다', () => {
    render(position(true));
    expect(glowSwatch().disabled).toBe(true);
    expect(sourceDropdown().dataset.value).toBe('follow');
    act(() => {
      glowSwatch().click();
    });
    expect(captured.pickerOpen).toBe(false);
  });

  it('직접 지정이면 글로우 피커가 열린다', () => {
    render(position(false));
    expect(glowSwatch().disabled).toBe(false);
    expect(sourceDropdown().dataset.value).toBe('custom');
    act(() => {
      glowSwatch().click();
    });
    expect(captured.pickerOpen).toBe(true);
  });

  it('소스 드롭다운은 noteGlowSyncPaint 단일 속성 op으로 커밋한다', () => {
    render(position(false));
    pickSource('follow');
    expect(commit).toHaveBeenCalledWith({
      property: 'noteGlowSyncPaint',
      value: true,
    });

    render(position(true));
    pickSource('custom');
    expect(commit).toHaveBeenLastCalledWith({
      property: 'noteGlowSyncPaint',
      value: false,
    });
  });

  it('글로우 피커가 열린 채 따라가기로 바꾸면 피커를 닫는다', () => {
    render(position(false));
    act(() => {
      glowSwatch().click();
    });
    expect(captured.pickerOpen).toBe(true);
    captured.pickerOpen = false;
    pickSource('follow');
    // 커밋은 부모가 반영하므로 여기서는 열림 상태만 본다
    expect(commit).toHaveBeenCalledWith({
      property: 'noteGlowSyncPaint',
      value: true,
    });
    expect(captured.pickerOpen).toBe(false);
  });
});
