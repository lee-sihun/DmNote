// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBatchNotePaint, type BatchNoteSurface } from './useBatchNotePaint';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { isNotePaintPropertyPatchV1 } from '@src/types/key/notePaint';
import type { EditorNotePaintPropertyPatchV1 } from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';
import type { GradientSpec } from '@src/types/color';

type HookState = ReturnType<typeof useBatchNotePaint>;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const twoStops: GradientSpec = {
  angle: 180,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: '#0000ff', pos: 1 },
  ],
};

const threeStops: GradientSpec = {
  angle: 90,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: '#00ff00', pos: 0.5 },
    { color: '#0000ff', pos: 1 },
  ],
};

const keyAt = (id: string, patch: Partial<KeyPosition> = {}): KeyPosition => ({
  ...createDefaultKeyPosition(),
  id,
  ...patch,
});

describe('useBatchNotePaint 집계·커밋', () => {
  let root: Root;
  let host: HTMLDivElement;
  let stateCapture: { current: HookState | null };
  let commitNotePaint: ReturnType<
    typeof vi.fn<(patch: EditorNotePaintPropertyPatchV1) => void>
  >;

  const Harness = ({
    positions,
    open,
  }: {
    positions: KeyPosition[];
    open: BatchNoteSurface | null;
  }) => {
    const state = useBatchNotePaint({
      positions,
      open,
      selectionKey: `4key:${ID_A},${ID_B}`,
      commitNotePaint,
    });
    useEffect(() => {
      stateCapture.current = state;
    }, [state]);
    return null;
  };

  const latest = () => {
    if (!stateCapture.current) throw new Error('batch note state not captured');
    return stateCapture.current;
  };

  const render = (positions: KeyPosition[], open: BatchNoteSurface | null) => {
    act(() => root.render(<Harness positions={positions} open={open} />));
  };

  const lastPatch = () => {
    const patch = commitNotePaint.mock.calls.at(-1)?.[0];
    if (!patch) throw new Error('no note paint commit');
    return patch;
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    stateCapture = { current: null };
    commitNotePaint = vi.fn<(patch: EditorNotePaintPropertyPatchV1) => void>();
    act(() => {
      useGridSelectionStore.getState().setSelectedElements([
        { type: 'key', id: ID_A, index: 0 },
        { type: 'key', id: ID_B, index: 1 },
      ]);
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

  it('테두리 GradientSpec 구조 차이를 Mixed로 집계한다', () => {
    render(
      [
        keyAt(ID_A, { noteBorderGradient: threeStops }),
        keyAt(ID_B, { noteBorderGradient: twoStops }),
      ],
      null,
    );
    expect(latest().displays.border.isMixed).toBe(true);
    expect(latest().displays.border.label).toBe('Mixed');
  });

  it('같은 spec이라도 저장 배율이 다르면 실제 출력 차이라 Mixed로 집계한다', () => {
    render(
      [
        keyAt(ID_A, { noteBorderGradient: twoStops, noteBorderOpacity: 25 }),
        keyAt(ID_B, { noteBorderGradient: twoStops, noteBorderOpacity: 75 }),
      ],
      null,
    );
    expect(latest().displays.border.isMixed).toBe(true);
  });

  it('legacy 프로파일과 신형 spec의 실제 출력이 다르면 Mixed로 집계한다', () => {
    // legacy 80/40 그대로 vs 같은 제시 spec에 배율 80이 곱해진 신형 (64/32)
    const legacy = keyAt(ID_A, {
      noteColor: { type: 'gradient', top: '#ff0000', bottom: '#0000ff' },
      noteOpacity: 80,
      noteOpacityTop: 80,
      noteOpacityBottom: 40,
    });
    const modern = keyAt(ID_B, {
      noteGradient: {
        angle: 180,
        stops: [
          { color: 'rgba(255,0,0,0.8)', pos: 0 },
          { color: 'rgba(0,0,255,0.4)', pos: 1 },
        ],
      },
      noteOpacity: 80,
    });
    render([legacy, modern], null);
    expect(latest().displays.note.isMixed).toBe(true);
  });

  it('동일 테두리 spec은 이미지로 표시하고 배율을 따로 곱하지 않는다', () => {
    render(
      [
        keyAt(ID_A, { noteBorderGradient: twoStops, noteBorderOpacity: 100 }),
        keyAt(ID_B, { noteBorderGradient: twoStops, noteBorderOpacity: 100 }),
      ],
      null,
    );
    const display = latest().displays.border;
    expect(display.isMixed).toBe(false);
    expect(display.image).toContain('linear-gradient');
    expect(display.opacity).toBeUndefined();
  });

  it('본체 신형 spec 차이를 Mixed로 집계한다', () => {
    render(
      [
        keyAt(ID_A, { noteGradient: threeStops }),
        keyAt(ID_B, { noteGradient: twoStops }),
      ],
      null,
    );
    expect(latest().displays.note.isMixed).toBe(true);
  });

  it('테두리 그라데이션 색 확정은 spec을 보존하고 배율 100으로 기록한다', () => {
    render(
      [
        keyAt(ID_A, { noteBorderGradient: twoStops, noteBorderOpacity: 100 }),
        keyAt(ID_B, { noteBorderGradient: twoStops, noteBorderOpacity: 100 }),
      ],
      'border',
    );
    expect(latest().states.border.format).toBe('gradient');
    act(() => latest().states.border.handlePickerColorChange('#abcdef', true));

    const patch = lastPatch();
    expect(patch.property).toBe('noteBorderPaint');
    if (patch.property !== 'noteBorderPaint') return;
    expect('gradient' in patch.value && patch.value.gradient).toBeTruthy();
    expect(patch.value.opacity).toBe(100);
    expect(isNotePaintPropertyPatchV1(patch)).toBe(true);
  });

  it('남은 저장 배율은 스톱 알파에 접혀 제시되고 커밋 시 100으로 수렴한다', () => {
    render(
      [
        keyAt(ID_A, { noteBorderGradient: twoStops, noteBorderOpacity: 50 }),
        keyAt(ID_B, { noteBorderGradient: twoStops, noteBorderOpacity: 50 }),
      ],
      'border',
    );
    // 제시 spec: 알파 1.0 스톱이 0.5로 접혀 있다
    expect(latest().states.border.pickerColor).toBe('rgba(255,0,0,0.5)');
    // 두 번째 스톱만 바꿔도 첫 스톱은 접힌 알파를 유지하고 배율은 100
    act(() => {
      const header = latest().states.border.headerSlot as React.ReactElement<{
        onSelectStop: (index: number) => void;
      }>;
      header.props.onSelectStop(1);
    });
    act(() => latest().states.border.handlePickerColorChange('#abcdef', true));
    const patch = lastPatch();
    if (patch.property !== 'noteBorderPaint') return;
    expect(patch.value.opacity).toBe(100);
    expect(
      'gradient' in patch.value && patch.value.gradient?.stops[0].color,
    ).toBe('rgba(255,0,0,0.5)');
  });

  it('신형 보유 선택의 본체 단색 확정은 gradient null 원자 op를 보낸다', () => {
    render(
      [
        keyAt(ID_A, { noteColor: '#FFFFFF', noteOpacity: 60 }),
        keyAt(ID_B, { noteGradient: twoStops, noteOpacity: 80 }),
      ],
      'note',
    );
    // 첫 대상이 단색이라 피커는 단색 형식으로 열린다
    expect(latest().states.note.format).toBe('solid');
    act(() => latest().states.note.handlePickerColorChange('#123456', true));

    expect(lastPatch()).toEqual({
      property: 'notePaint',
      value: { color: '#123456', opacity: 60, gradient: null },
    });
  });

  it('전부 구형·단색 선택의 단색 확정은 구형 {color}를 유지한다', () => {
    render(
      [
        keyAt(ID_A, { noteColor: '#FFFFFF' }),
        keyAt(ID_B, { noteColor: '#FFFFFF' }),
      ],
      'note',
    );
    act(() => latest().states.note.handlePickerColorChange('#123456', true));

    expect(lastPatch()).toEqual({
      property: 'notePaint',
      value: { color: '#123456' },
    });
  });

  it('단색에서 그라데이션으로 바꾸면 단색 투명도가 스톱 알파에 접힌다', () => {
    render(
      [
        keyAt(ID_A, { noteColor: '#FF0000', noteOpacity: 40 }),
        keyAt(ID_B, { noteColor: '#FF0000', noteOpacity: 40 }),
      ],
      'note',
    );
    act(() => {
      const footer = latest().states.note.footerSlot as React.ReactElement<{
        onFormatChange: (next: 'solid' | 'gradient') => void;
      }>;
      footer.props.onFormatChange('gradient');
    });
    const patch = lastPatch();
    expect(patch.property).toBe('notePaint');
    if (patch.property !== 'notePaint') return;
    if (!('gradient' in patch.value) || !patch.value.gradient) {
      throw new Error('gradient descriptor expected');
    }
    expect(patch.value.opacity).toBe(100);
    expect(patch.value.gradient.stops[0].color).toBe('rgba(255,0,0,0.4)');
  });

  it('그라데이션에서 단색으로 돌아오면 첫 스톱 알파가 단색 투명도가 된다', () => {
    const faded: GradientSpec = {
      angle: 180,
      stops: [
        { color: 'rgba(255,0,0,0.3)', pos: 0 },
        { color: 'rgba(255,0,0,0)', pos: 1 },
      ],
    };
    render(
      [
        keyAt(ID_A, { noteBorderGradient: faded, noteBorderOpacity: 100 }),
        keyAt(ID_B, { noteBorderGradient: faded, noteBorderOpacity: 100 }),
      ],
      'border',
    );
    act(() => {
      const footer = latest().states.border.footerSlot as React.ReactElement<{
        onFormatChange: (next: 'solid' | 'gradient') => void;
      }>;
      footer.props.onFormatChange('solid');
    });
    expect(lastPatch()).toEqual({
      property: 'noteBorderPaint',
      value: { color: '#FF0000', opacity: 30 },
    });
  });

  it('canonical 반영 틱에 열린 표면의 로컬 투명도를 재동기화한다', () => {
    const solidKeys = (opacity: number) => [
      keyAt(ID_A, { noteBorderColor: '#FF0000', noteBorderOpacity: opacity }),
      keyAt(ID_B, { noteBorderColor: '#FF0000', noteBorderOpacity: opacity }),
    ];
    render(solidKeys(25), 'border');
    expect(latest().borderOpacity).toBe(25);

    // 외부 commit(undo·플러그인)이 store를 37로 바꿨지만 피커는 열려 있다
    render(solidKeys(37), 'border');
    expect(latest().borderOpacity).toBe(25);

    act(() => useCommittedApplyStore.getState().bump(undefined));
    expect(latest().borderOpacity).toBe(37);

    // 다음 색 확정이 낡은 25가 아니라 37을 재저장한다
    act(() => latest().commitBorderSolid('#abcdef'));
    const patch = lastPatch();
    if (patch.property !== 'noteBorderPaint') return;
    expect(patch.value.opacity).toBe(37);
  });

  it('글로우 색이 없으면 본체 신형 spec을 스톱·각도 그대로 상속해 제시한다', () => {
    const inherited = (id: string) =>
      keyAt(id, {
        noteGradient: threeStops,
        noteGlowColor: undefined,
        noteGlowOpacityTop: 70,
        noteGlowOpacityBottom: 30,
      });
    render([inherited(ID_A), inherited(ID_B)], 'glow');
    const state = latest().states.glow;
    expect(state.format).toBe('gradient');
    expect(state.paletteGradientSpec?.stops).toHaveLength(3);
    expect(state.paletteGradientSpec?.angle).toBe(90);
    // 첫 커밋도 3스톱·90도를 보존한다
    act(() => state.handlePickerColorChange('#abcdef', true));
    const patch = lastPatch();
    if (patch.property !== 'noteGlowPaint') throw new Error('glow expected');
    if (!('gradient' in patch.value) || !patch.value.gradient) {
      throw new Error('gradient descriptor expected');
    }
    expect(patch.value.gradient.stops).toHaveLength(3);
    expect(patch.value.gradient.angle).toBe(90);
    expect(patch.value.opacity).toBe(100);
  });

  it('구형 그라데이션에서 단색으로 돌아와도 첫 스톱 알파가 단색 투명도가 된다', () => {
    const legacy = (id: string) =>
      keyAt(id, {
        noteColor: { type: 'gradient', top: '#ff0000', bottom: '#0000ff' },
        noteOpacity: 80,
        noteOpacityTop: 40,
        noteOpacityBottom: 10,
      });
    render([legacy(ID_A), legacy(ID_B)], 'note');
    act(() => {
      const footer = latest().states.note.footerSlot as React.ReactElement<{
        onFormatChange: (next: 'solid' | 'gradient') => void;
      }>;
      footer.props.onFormatChange('solid');
    });
    expect(lastPatch()).toEqual({
      property: 'notePaint',
      value: { color: '#FF0000', opacity: 40, gradient: null },
    });
  });

  it('그라데이션 대상이 섞인 선택은 단색 투명도 조절기를 두지 않는다', () => {
    render(
      [
        keyAt(ID_A, { noteColor: '#FFFFFF', noteOpacity: 60 }),
        keyAt(ID_B, {
          noteGradient: twoStops,
          noteOpacity: 80,
          // 글로우 색이 없어 본체를 상속 - 글로우도 제시 gradient가 있는 대상
          noteGlowColor: undefined,
        }),
      ],
      'note',
    );
    expect(latest().states.note.format).toBe('solid');
    expect(latest().anyPresented.note).toBe(true);
    expect(latest().anyPresented.glow).toBe(true);
    expect(latest().anyPresented.border).toBe(false);
  });
});
