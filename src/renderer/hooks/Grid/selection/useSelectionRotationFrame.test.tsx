import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { previewOverlay } from '@src/renderer/editor/runtime/gesture/previewOverlay';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSelectionRotationStore } from '@stores/grid/useSelectionRotationStore';
import { rotateSelection } from '@utils/element/selectionRotation';
import { useSelectionRotationFrame } from './useSelectionRotationFrame';

const IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];
const initialPositions = () => [
  {
    ...createDefaultKeyPosition(0, 0),
    id: IDS[0],
    width: 40,
    height: 20,
    rotation: 30,
  },
  {
    ...createDefaultKeyPosition(130, 60),
    id: IDS[1],
    width: 20,
    height: 80,
    rotation: -15,
  },
];
type Frame = ReturnType<typeof useSelectionRotationFrame>;

describe('선택 공통 틀의 방향과 중심', () => {
  let host: HTMLDivElement;
  let root: Root;
  let frame: Frame;
  let secondFrame: Frame;
  const Harness = ({ second = false }: { second?: boolean }) => {
    const result = useSelectionRotationFrame();
    useLayoutEffect(() => {
      if (second) secondFrame = result;
      else frame = result;
    }, [result, second]);
    return null;
  };
  const render = (second = false) =>
    act(() =>
      root.render(
        <>
          <Harness />
          {second && <Harness second />}
        </>,
      ),
    );
  const center = (value: NonNullable<Frame>) => ({
    x: value.bounds.x + value.bounds.width / 2,
    y: value.bounds.y + value.bounds.height / 2,
  });
  const turn = (degrees: number, preview = false) => {
    const updates = rotateSelection(
      { ...frame!.snapshot, center: center(frame!) },
      degrees,
    )!;
    act(() => {
      if (preview) {
        for (const update of updates)
          previewOverlay.applyLocalPatchByIds(
            'frame-preview',
            '4key',
            [update.id],
            update.patch,
          );
      } else {
        const positions = useKeyStore.getState().canonicalPositions['4key'];
        useKeyStore.setState({
          canonicalPositions: {
            '4key': positions.map((position) => ({
              ...position,
              ...updates.find(({ id }) => id === position.id)!.patch,
            })),
          },
        });
      }
    });
  };
  const expectSameFrameSizeAndCenter = (initial: NonNullable<Frame>) => {
    expect(frame!.bounds.width).toBeCloseTo(initial.bounds.width, 8);
    expect(frame!.bounds.height).toBeCloseTo(initial.bounds.height, 8);
    expect(center(frame!).x).toBeCloseTo(center(initial).x, 8);
    expect(center(frame!).y).toBeCloseTo(center(initial).y, 8);
  };

  beforeEach(() => {
    previewOverlay.clearAll();
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': initialPositions() },
    });
    useStatItemStore.setState({ positions: {} });
    useGraphItemStore.setState({ positions: {} });
    useKnobItemStore.setState({ positions: {} });
    useSpriteStore.setState({ positions: {} });
    useGridSelectionStore.setState({
      selectedElements: IDS.map((id) => ({ type: 'key', id })),
    });
    useSelectionRotationStore.setState({
      selectionKey: null,
      referenceRotation: 0,
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    previewOverlay.clearAll();
  });

  it('기존 각도가 달라도 최초 선택 틀은 수평이며 반복 회전의 중심과 비율이 유지된다', () => {
    const initial = frame!;
    expect(initial.rotation).toBe(0);
    for (const degrees of [35, 25, 90, 40]) {
      turn(degrees);
      expectSameFrameSizeAndCenter(initial);
    }
    expect(frame!.rotation).toBe(-170);
    const positions = useKeyStore.getState().canonicalPositions['4key'];
    expect(positions[0].width).toBe(40);
    expect(positions[1].height).toBe(80);
  });

  it('로컬 프리뷰와 취소가 같은 틀에 반영되며 canonical은 바뀌지 않는다', () => {
    const initial = frame!;
    turn(45, true);
    expect(frame!.rotation).toBe(45);
    expectSameFrameSizeAndCenter(initial);
    expect(useKeyStore.getState().canonicalPositions['4key']).toEqual(
      initialPositions(),
    );
    act(() => previewOverlay.clearAll());
    expect(frame!.rotation).toBe(0);
    expect(frame!.bounds).toEqual(initial.bounds);
  });

  it('회전 뒤 열린 숫자 패널도 캔버스와 같은 기준각을 공유하며 Undo가 틀까지 복원한다', () => {
    const initial = frame!;
    turn(45);
    render(true);
    expect(secondFrame!.rotation).toBe(45);
    expect(secondFrame!.bounds).toEqual(frame!.bounds);
    act(() =>
      useKeyStore.setState({
        canonicalPositions: { '4key': initialPositions() },
      }),
    );
    expect(frame!.rotation).toBe(0);
    expect(secondFrame!.rotation).toBe(0);
    expect(frame!.bounds).toEqual(initial.bounds);
  });

  it('다시 선택하면 현재 배치에서 수평 틀을 만들고 선택 순서 변경은 방향을 유지한다', () => {
    turn(45);
    act(() =>
      useGridSelectionStore.setState({
        selectedElements: [
          ...useGridSelectionStore.getState().selectedElements,
        ].reverse(),
      }),
    );
    expect(frame!.rotation).toBe(45);
    act(() => useGridSelectionStore.setState({ selectedElements: [] }));
    expect(frame).toBeNull();
    act(() =>
      useGridSelectionStore.setState({
        selectedElements: IDS.map((id) => ({ type: 'key', id })),
      }),
    );
    expect(frame!.rotation).toBe(0);
  });

  it('플러그인 혼합 선택이나 사라진 대상은 일부 회전 틀을 만들지 않는다', () => {
    act(() =>
      useGridSelectionStore.setState({
        selectedElements: [
          { type: 'key', id: IDS[0] },
          { type: 'plugin', id: 'plugin:one' },
        ],
      }),
    );
    expect(frame).toBeNull();
    act(() =>
      useGridSelectionStore.setState({
        selectedElements: [
          { type: 'key', id: IDS[0] },
          { type: 'key', id: 'missing' },
        ],
      }),
    );
    expect(frame).toBeNull();
  });
});
