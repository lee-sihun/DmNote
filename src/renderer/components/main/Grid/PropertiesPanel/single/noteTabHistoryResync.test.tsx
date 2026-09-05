// @vitest-environment jsdom
import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteTabContent from './NoteTabContent';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import type { EditorNotePaintPropertyPatchV1 } from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';
import type { GradientSpec } from '@src/types/color';

type PickerProps = {
  color: string;
  opacityPercent?: number;
  hideColorAlpha?: boolean;
  footerSlot?: ReactElement<{
    onFormatChange: (next: 'solid' | 'gradient') => void;
  }>;
  onColorChangeComplete: (color: string) => void;
};

const captured = vi.hoisted(() => ({
  picker: null as PickerProps | null,
}));

vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: (props: PickerProps) => {
    captured.picker = props;
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
vi.mock('@components/main/Modal/content/pickers/ColorSwatch', async () => {
  const ReactModule = await import('react');
  return {
    ColorSwatchButton: ReactModule.forwardRef<
      HTMLButtonElement,
      { onClick?: () => void }
    >(function SwatchStub(props, ref) {
      return <button ref={ref} data-testid="swatch" onClick={props.onClick} />;
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
vi.mock('@components/main/common/Checkbox', () => ({
  default: () => null,
}));
vi.mock('@components/main/common/Dropdown', () => ({
  default: () => null,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ELEMENT_ID = '33333333-3333-4333-8333-333333333333';

const borderSpec: GradientSpec = {
  angle: 180,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: '#0000ff', pos: 1 },
  ],
};

const solidBorder = (opacity: number): KeyPosition => ({
  ...createDefaultKeyPosition(),
  id: ELEMENT_ID,
  noteBorderColor: '#FF0000',
  noteBorderOpacity: opacity,
});

const gradientBorder = (opacity: number): KeyPosition => ({
  ...createDefaultKeyPosition(),
  id: ELEMENT_ID,
  noteBorderColor: '#FF0000',
  noteBorderGradient: borderSpec,
  noteBorderOpacity: opacity,
});

describe('NoteTabContent 열린 피커 재동기화', () => {
  let root: Root;
  let host: HTMLDivElement;
  let commit: ReturnType<
    typeof vi.fn<(patch: EditorNotePaintPropertyPatchV1) => void>
  >;

  const render = (position: KeyPosition) => {
    act(() =>
      root.render(
        <NoteTabContent
          keyPosition={position}
          onNotePaintCommit={commit}
          t={(key) => key}
        />,
      ),
    );
  };

  // 스와치 순서: 노트(0) → 테두리(1) → 글로우(2)
  const openBorderPicker = () => {
    const swatches = host.querySelectorAll('[data-testid="swatch"]');
    act(() => {
      (swatches[1] as HTMLButtonElement).click();
    });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    captured.picker = null;
    commit = vi.fn<(patch: EditorNotePaintPropertyPatchV1) => void>();
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

  it('열린 단색 테두리 피커의 투명도를 canonical 반영 틱에 재동기화하고 낡은 값을 재저장하지 않는다', () => {
    render(solidBorder(25));
    openBorderPicker();
    // 단색 테두리는 색 알파가 투명도를 겸한다
    expect(captured.picker?.color).toBe('rgba(255, 0, 0, 0.25)');

    // undo나 플러그인 commit이 store를 37로 바꿨지만 피커는 열려 있다 - 게이트는 25를 유지
    render(solidBorder(37));
    expect(captured.picker?.color).toBe('rgba(255, 0, 0, 0.25)');

    act(() => useCommittedApplyStore.getState().bump('historyUndo'));
    expect(captured.picker?.color).toBe('rgba(255, 0, 0, 0.37)');

    // 알파 없는 hex 확정은 로컬 투명도를 쓰므로 낡은 25가 아니라 37이 저장된다
    act(() => captured.picker?.onColorChangeComplete('#abcdef'));
    expect(commit.mock.calls.at(-1)?.[0]).toEqual({
      property: 'noteBorderPaint',
      value: { color: '#ABCDEF', opacity: 37 },
    });
  });

  it('그라데이션 형식의 테두리 피커에는 전역 배율 조절기가 없고 커밋은 배율 100이다', () => {
    render(gradientBorder(100));
    openBorderPicker();
    expect(captured.picker?.opacityPercent).toBeUndefined();
    expect(captured.picker?.hideColorAlpha).toBeFalsy();

    act(() => captured.picker?.onColorChangeComplete('#abcdef'));
    const patch = commit.mock.calls.at(-1)?.[0];
    expect(patch?.property).toBe('noteBorderPaint');
    if (patch?.property !== 'noteBorderPaint') return;
    expect(patch.value.opacity).toBe(100);
    expect('gradient' in patch.value && patch.value.gradient).toBeTruthy();
  });

  it('테두리 그라데이션을 단색으로 바꿨다 되돌려도 스톱 알파를 다시 곱하지 않는다', () => {
    const fadedBorder: KeyPosition = {
      ...gradientBorder(100),
      noteBorderGradient: {
        ...borderSpec,
        stops: [
          { color: 'rgba(255,0,0,0.6)', pos: 0 },
          { color: 'rgba(0,0,255,0)', pos: 1 },
        ],
      },
    };
    render(fadedBorder);
    openBorderPicker();

    act(() => captured.picker?.footerSlot?.props.onFormatChange('solid'));
    expect(commit.mock.calls.at(-1)?.[0]).toEqual({
      property: 'noteBorderPaint',
      value: { color: '#FF0000', opacity: 60 },
    });

    render(solidBorder(60));
    act(() => captured.picker?.footerSlot?.props.onFormatChange('gradient'));
    const patch = commit.mock.calls.at(-1)?.[0];
    expect(patch?.property).toBe('noteBorderPaint');
    if (
      patch?.property !== 'noteBorderPaint' ||
      !('gradient' in patch.value) ||
      !patch.value.gradient
    )
      throw new Error(
        `gradient border patch expected: ${JSON.stringify(patch)}`,
      );
    expect(patch.value.gradient.stops[0].color).toBe('rgba(255,0,0,0.6)');
    expect(patch.value.opacity).toBe(100);
  });
});
