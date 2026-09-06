/**
 * 스프라이트 캔버스 핸들
 * - 선택 중엔 기준점 십자를 그리고, 드래그가 9점 스냅·보정 patch를 commit한다
 * - 시작 시점 canonical이 바뀌면(리사이즈 착지·다른 창 편집) 낡은 patch를 버린다
 * - 자세 세션은 본체 이동·모서리 바깥 회전·모서리 배율을 요소 로컬 px로 계산한다
 * - undo/redo 반영·다른 pointerId·세션 종료는 진행 중 드래그를 커밋 없이 닫는다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useSpritePoseHandleStore,
  type SpritePoseHandleSession,
} from '@stores/grid/useSpritePoseHandleStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { releaseDragSession } from '@hooks/Grid/drag/dragSession';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import {
  makeCanonicalSpritePosition,
  makeSpritePose,
} from '@utils/sprite/spriteFixtures';

import SpriteCanvasHandles from './SpriteCanvasHandles';

const mocks = vi.hoisted(() => ({
  patchPosition: vi.fn(
    (_mode: string, _id: string, _patch: unknown, _gestureId?: string) =>
      Promise.resolve(undefined),
  ),
  discardOrphanedLocalPreviews: vi.fn(() => false),
  settleCommit: vi.fn(),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@api/modules/editor/itemsApi', () => ({
  spriteItemsApi: { patchPosition: mocks.patchPosition },
}));
vi.mock('@src/renderer/editor/runtime/gesture/editGestureController', () => ({
  editGestureController: {
    discardOrphanedLocalPreviews: mocks.discardOrphanedLocalPreviews,
    activeGestureId: () => undefined,
    settleCommit: mocks.settleCommit,
  },
}));
vi.mock('@src/renderer/editor/model/elementIdMap', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveElementById: () => ({ mode: '4key' }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SPRITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// 200x100 상자, 원점 (10, 20), 기준점 중앙 → 십자 로컬 (100, 50)
const sprite = () =>
  makeCanonicalSpritePosition({
    id: SPRITE_ID,
    dx: 10,
    dy: 20,
    width: 200,
    height: 100,
    pivot: { x: 0.5, y: 0.5 },
    poses: [
      makeSpritePose({
        poseId: 'pose-1',
        triggers: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        transform: { x: 10, y: 0, rotation: 90, scale: 1 },
      }),
    ],
  });

const makeSession = (
  overrides: Partial<SpritePoseHandleSession> = {},
): SpritePoseHandleSession => ({
  positionId: SPRITE_ID,
  poseId: 'pose-1',
  origin: { dx: 10, dy: 20 },
  width: 200,
  height: 100,
  pivot: { x: 0.5, y: 0.5 },
  imagePivot: { x: 0.5, y: 0.5 },
  followsBasePivot: true,
  placement: {
    rect: { x: 0, y: 0, width: 200, height: 100 },
    pivot: { x: 0.5, y: 0.5 },
  },
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  preview: vi.fn(),
  commit: vi.fn(),
  previewPivot: vi.fn(),
  commitPivot: vi.fn(),
  cancel: vi.fn(),
  ...overrides,
});

describe('SpriteCanvasHandles', () => {
  let container: HTMLDivElement;
  let root: Root;

  const pivotHandle = () =>
    container.querySelector<HTMLElement>('[data-sprite-pivot-handle="true"]');
  const poseFrame = () =>
    container.querySelector<SVGPolygonElement>(
      '[data-sprite-pose-frame="true"]',
    );
  const rotateCorner = () =>
    container.querySelector<HTMLElement>('[data-rotate-corner="0"]');
  const scaleKnobs = () =>
    container.querySelectorAll<HTMLElement>('[data-sprite-scale-knob="true"]');

  const pointer = (
    type: string,
    target: EventTarget,
    init: {
      clientX?: number;
      clientY?: number;
      pointerId?: number;
      buttons?: number;
      shiftKey?: boolean;
      ctrlKey?: boolean;
    } = {},
  ) =>
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: init.buttons ?? (type === 'pointerup' ? 0 : 1),
          clientX: init.clientX ?? 0,
          clientY: init.clientY ?? 0,
          pointerId: init.pointerId ?? 1,
          shiftKey: init.shiftKey ?? false,
          ctrlKey: init.ctrlKey ?? false,
        }),
      );
    });

  // move는 rAF 스케줄러에 실리므로 한 틱 기다려 preview를 흘린다
  const flushFrame = async () => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  const render = (
    selected: SelectedElement[] = [{ type: 'sprite', id: SPRITE_ID }],
    view: { zoom?: number; panX?: number; panY?: number } = {},
  ) => {
    act(() => {
      root.render(
        <SpriteCanvasHandles
          spritePositions={useSpriteStore.getState().positions}
          selectedElements={selected}
          selectedKeyType="4key"
          zoom={view.zoom ?? 1}
          panX={view.panX ?? 0}
          panY={view.panY ?? 0}
        />,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
    useSpriteStore.setState({ positions: { '4key': [sprite()] } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => useSpritePoseHandleStore.getState().setSession(null));
    useSpriteStore.setState({ positions: {} });
    releaseDragSession();
    vi.unstubAllGlobals();
  });

  it('선택이 없으면 그리지 않고, 스프라이트가 선택되면 기준점 십자를 그린다', () => {
    render([]);
    expect(pivotHandle()).toBeNull();

    render(undefined, { zoom: 2, panX: 5, panY: 7 });
    const handle = pivotHandle()!;
    // 로컬 (100, 50) → 화면 ((10+100)*2+5, (20+50)*2+7) = (225, 147), 히트 26 중심
    expect(handle.style.left).toBe('212px');
    expect(handle.style.top).toBe('134px');
    expect(poseFrame()).toBeNull();
  });

  it('스냅 해제 보조키 드래그는 캔버스 메뉴를 열지 않는다', () => {
    render();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });

    pivotHandle()!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('배치가 90도 돌아도 기준점 포인터를 상자 로컬 축으로 해석한다', async () => {
    useSpriteStore.setState({
      positions: { '4key': [{ ...sprite(), rotation: 90 }] },
    });
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, {
      clientX: 60,
      clientY: 170,
      ctrlKey: true,
    });
    await flushFrame();
    pointer('pointerup', window, { clientX: 60, clientY: 170, ctrlKey: true });
    expect(mocks.patchPosition.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      '4key',
      SPRITE_ID,
      expect.objectContaining({ pivot: { x: 1, y: 1 } }),
    ]);
    await flushFrame();
  });

  it('기준점 조작 전에 포커스된 입력을 정산한다', () => {
    render();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });

    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it('상자 핸들이 보이는 동안 표식은 선택 테두리 프레임에 앉고 자세 편집 중엔 상자 그대로다', () => {
    useSpriteStore.setState({
      positions: { '4key': [{ ...sprite(), pivot: { x: 1, y: 0 } }] },
    });
    render();
    // 로컬 (200, 0) → 화면 (210, 20), 테두리 선 중심은 모서리 밖 1px → (211, 19), 히트 26 중심
    expect(pivotHandle()!.style.left).toBe('198px');
    expect(pivotHandle()!.style.top).toBe('6px');

    act(() =>
      useSpritePoseHandleStore
        .getState()
        .setSession(makeSession({ pivot: { x: 1, y: 0 } })),
    );
    render();
    // 자세 프레임 선은 상자 그대로라 보정 없이 (210, 20)
    expect(pivotHandle()!.style.left).toBe('197px');
    expect(pivotHandle()!.style.top).toBe('7px');
  });

  it('기준점 드래그는 그림 프리뷰 없이 표식만 9점에 스냅하고 놓으면 커밋한다', async () => {
    render();
    const handle = pivotHandle()!;
    pointer('pointerdown', handle, { clientX: 110, clientY: 70 });
    // 왼쪽 아래 모서리 (10, 120)에서 5px 안쪽 - 스냅 반경 8px 안
    pointer('pointermove', window, { clientX: 14, clientY: 117 });
    await flushFrame();

    expect(parseFloat(handle.style.left) + 13).toBeCloseTo(9, 6);
    expect(mocks.patchPosition).not.toHaveBeenCalled();

    pointer('pointerup', window, { clientX: 14, clientY: 117 });
    expect(mocks.patchPosition).toHaveBeenCalledTimes(1);
    const patch = mocks.patchPosition.mock.calls[0][2] as {
      pivot: { x: number; y: number };
      poses: Array<{ transform: { x: number; y: number } }>;
    };
    expect(patch.pivot).toEqual({ x: 0, y: 1 });
    // 연결 상태는 이동값을 유지해 기본 축 변화량을 그대로 따라간다
    expect(patch.poses[0].transform.x).toBe(10);
    expect(patch.poses[0].transform.y).toBe(0);

    expect(mocks.patchPosition.mock.calls[0][2]).toEqual(patch);
    expect(mocks.settleCommit).toHaveBeenCalled();
  });

  it('Ctrl을 누르면 스냅 없이 포인터 자리를 그대로 기준점으로 쓴다', async () => {
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, {
      clientX: 14,
      clientY: 117,
      ctrlKey: true,
    });
    await flushFrame();
    pointer('pointerup', window, { clientX: 14, clientY: 117 });
    const patch = mocks.patchPosition.mock.calls[0][2] as {
      pivot: { x: number; y: number };
    };
    expect(patch.pivot.x).toBeCloseTo(4 / 200, 9);
    expect(patch.pivot.y).toBeCloseTo(97 / 100, 9);
  });

  it('스냅된 기준점은 더 넓은 이탈 반경까지 유지해 경계에서 떨리지 않는다', async () => {
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });

    pointer('pointermove', window, { clientX: 117, clientY: 70 });
    await flushFrame();
    expect(parseFloat(pivotHandle()!.style.left) + 13).toBeCloseTo(110, 6);

    pointer('pointermove', window, { clientX: 119, clientY: 70 });
    await flushFrame();
    expect(parseFloat(pivotHandle()!.style.left) + 13).toBeCloseTo(110, 6);

    pointer('pointermove', window, { clientX: 123, clientY: 70 });
    await flushFrame();
    expect(parseFloat(pivotHandle()!.style.left) + 13).toBeGreaterThan(122);
    pointer('pointerup', window, { clientX: 123, clientY: 70 });
  });

  it('기본 기준점은 pointerup이 빠져도 mouseup으로 마지막 위치를 커밋한다', async () => {
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, { clientX: 150, clientY: 70 });
    await flushFrame();

    act(() => {
      window.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
        }),
      );
    });

    expect(mocks.patchPosition).toHaveBeenCalledOnce();
    pointer('pointerup', window, { clientX: 150, clientY: 70 });
    expect(mocks.patchPosition).toHaveBeenCalledOnce();
  });

  it('기본 기준점은 캡처 해제로 끝나도 마지막 위치를 커밋한다', async () => {
    render();
    const handle = pivotHandle()!;
    pointer('pointerdown', handle, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, { clientX: 150, clientY: 70 });
    await flushFrame();

    pointer('lostpointercapture', handle, { pointerId: 1, buttons: 0 });

    expect(mocks.patchPosition).toHaveBeenCalledOnce();
    pointer('pointerup', window, { clientX: 150, clientY: 70 });
    expect(mocks.patchPosition).toHaveBeenCalledOnce();
  });

  it('기본 기준점은 눌린 move 뒤 buttons 0 move로 끝나도 커밋한다', async () => {
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, {
      clientX: 130,
      clientY: 70,
      buttons: 1,
    });
    await flushFrame();

    pointer('pointermove', window, {
      clientX: 150,
      clientY: 70,
      buttons: 0,
    });

    expect(mocks.patchPosition).toHaveBeenCalledOnce();
    pointer('pointerup', window, { clientX: 150, clientY: 70 });
    expect(mocks.patchPosition).toHaveBeenCalledOnce();
  });

  it('창 포커스를 잃은 기본 기준점 드래그는 저장하지 않고 표시만 복원한다', async () => {
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, { clientX: 150, clientY: 70 });
    await flushFrame();

    act(() => window.dispatchEvent(new Event('blur')));

    expect(mocks.patchPosition).not.toHaveBeenCalled();
    expect(parseFloat(pivotHandle()!.style.left) + 13).toBeCloseTo(110, 6);
    pointer('pointerup', window, { clientX: 150, clientY: 70 });
    expect(mocks.patchPosition).not.toHaveBeenCalled();
  });

  it('드래그 중 canonical이 바뀌면 낡은 patch를 커밋하지 않고 포기한다', async () => {
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, { clientX: 14, clientY: 117 });
    await flushFrame();
    expect(parseFloat(pivotHandle()!.style.left) + 13).not.toBeCloseTo(110, 6);

    // 리사이즈 착지·다른 창 편집 - 스토어 객체가 교체된다
    useSpriteStore.setState({
      positions: { '4key': [{ ...sprite(), width: 400 }] },
    });
    pointer('pointerup', window, { clientX: 14, clientY: 117 });

    expect(mocks.patchPosition).not.toHaveBeenCalled();
  });

  it('드래그 중 요소 원점이 바뀌면 이전 좌표계의 기준점 patch를 버린다', async () => {
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, { clientX: 150, clientY: 70 });
    await flushFrame();

    useSpriteStore.setState({
      positions: { '4key': [{ ...sprite(), dx: 40, dy: 60 }] },
    });
    pointer('pointerup', window, { clientX: 150, clientY: 70 });

    expect(mocks.patchPosition).not.toHaveBeenCalled();
  });

  it('undo/redo 반영은 진행 중 기준점 드래그를 커밋 없이 취소한다', async () => {
    render();
    pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
    pointer('pointermove', window, { clientX: 14, clientY: 117 });
    await flushFrame();

    act(() =>
      useCommittedApplyStore.setState((state) => ({
        historyTick: state.historyTick + 1,
      })),
    );
    pointer('pointerup', window, { clientX: 14, clientY: 117 });
    expect(mocks.patchPosition).not.toHaveBeenCalled();
  });

  describe('자세 세션', () => {
    const openSession = (
      overrides: Partial<SpritePoseHandleSession> = {},
      view: { zoom?: number; panX?: number; panY?: number } = {},
    ) => {
      const session = makeSession(overrides);
      act(() => useSpritePoseHandleStore.getState().setSession(session));
      render(undefined, view);
      return session;
    };

    it('자세 프레임과 기준점은 배치 회전과 로컬 자세 회전을 합성한다', () => {
      openSession({
        rotation: 90,
        transform: { x: 30, y: 0, rotation: 90, scale: 1 },
      });
      const corners = poseFrame()!
        .getAttribute('points')!
        .split(' ')
        .map((point) => point.split(',').map(Number));
      [
        [210, 150],
        [10, 150],
        [10, 50],
        [210, 50],
      ].forEach((expected, index) => {
        expect(corners[index][0]).toBeCloseTo(expected[0], 8);
        expect(corners[index][1]).toBeCloseTo(expected[1], 8);
      });
      expect(Number.parseFloat(pivotHandle()!.style.left) + 13).toBeCloseTo(
        110,
        8,
      );
      expect(Number.parseFloat(pivotHandle()!.style.top) + 13).toBeCloseTo(
        100,
        8,
      );
    });

    it('배치가 돌아도 자세 이동과 포즈 기준점은 로컬 축으로 편집한다', async () => {
      const session = openSession({ rotation: 90 }, { zoom: 2 });
      pointer('pointerdown', poseFrame()!, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, { clientX: 140, clientY: 80 });
      await flushFrame();
      expect(session.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ x: -10, y: -20 }),
      );
      pointer('pointerup', window, { clientX: 140, clientY: 80 });
      expect(session.commit).toHaveBeenLastCalledWith(
        expect.objectContaining({ x: -10, y: -20 }),
      );
      const pivotSession = openSession({ rotation: 90 });
      pointer('pointerdown', pivotHandle()!, { clientX: 110, clientY: 70 });
      pointer('pointermove', window, {
        clientX: 110,
        clientY: 90,
        ctrlKey: true,
      });
      await flushFrame();
      expect(Number.parseFloat(pivotHandle()!.style.left) + 13).toBeCloseTo(
        110,
        8,
      );
      expect(Number.parseFloat(pivotHandle()!.style.top) + 13).toBeCloseTo(
        90,
        8,
      );
      pointer('pointerup', window, {
        clientX: 110,
        clientY: 90,
        ctrlKey: true,
      });
      expect(pivotSession.commitPivot).toHaveBeenCalledWith(
        expect.objectContaining({ x: 0.6, y: 0.5 }),
        expect.anything(),
      );
    });

    it('배치 각도를 더하지 않고 자세 회전과 배율만 편집한다', async () => {
      const rotateSession = openSession({
        rotation: 90,
        transform: { x: 0, y: 0, rotation: 45, scale: 1 },
      });
      pointer('pointerdown', rotateCorner()!, { clientX: 160, clientY: 70 });
      pointer('pointermove', window, { clientX: 110, clientY: 120 });
      await flushFrame();
      expect(rotateSession.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ rotation: 135 }),
      );
      pointer('pointerup', window, { clientX: 110, clientY: 120 });
      const scaleSession = openSession({
        rotation: 90,
        transform: { x: 30, y: 0, rotation: 45, scale: 1 },
      });
      pointer('pointerdown', scaleKnobs()[0], { clientX: 160, clientY: 100 });
      pointer('pointermove', window, { clientX: 210, clientY: 100 });
      await flushFrame();
      expect(scaleSession.preview).toHaveBeenLastCalledWith(
        expect.objectContaining({ rotation: 45, scale: 2 }),
      );
      pointer('pointerup', window, { clientX: 210, clientY: 100 });
    });

    it('도중에 배치 회전이 바뀌면 이전 자세 포인터를 커밋하지 않는다', async () => {
      const session = openSession();
      pointer('pointerdown', poseFrame()!, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, { clientX: 140, clientY: 80 });
      await flushFrame();
      act(() =>
        useSpritePoseHandleStore
          .getState()
          .setSession({ ...session, rotation: 90 }),
      );
      pointer('pointerup', window, { clientX: 140, clientY: 80 });
      expect(session.commit).not.toHaveBeenCalled();
    });

    it('프레임과 회전·배율 영역 각 4개를 그리고 십자가 자세 축을 따라간다', () => {
      openSession({ transform: { x: 30, y: 0, rotation: 0, scale: 1 } });
      expect(poseFrame()).not.toBeNull();
      expect(rotateCorner()).not.toBeNull();
      expect(container.querySelectorAll('[data-rotate-corner]')).toHaveLength(
        4,
      );
      expect(container.querySelector('[data-sprite-rotate-knob]')).toBeNull();
      expect(poseFrame()!.parentElement!.querySelector('line')).toBeNull();
      expect(scaleKnobs().length).toBe(4);
      // 십자 = 원점 + P + 이동값 = (10+100+30, 20+50) → 히트 26 좌상단 (127, 57)
      expect(pivotHandle()!.style.left).toBe('127px');
      expect(pivotHandle()!.style.top).toBe('57px');
    });

    it('본체 드래그는 줌을 나눈 로컬 이동량만큼 위치를 preview하고 놓으면 커밋한다', async () => {
      const session = openSession({}, { zoom: 2 });
      pointer('pointerdown', poseFrame()!, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, { clientX: 140, clientY: 80 });
      await flushFrame();
      expect(session.preview).toHaveBeenLastCalledWith({
        x: 20,
        y: -10,
        rotation: 0,
        scale: 1,
      });
      expect(session.commit).not.toHaveBeenCalled();
      pointer('pointerup', window, { clientX: 140, clientY: 80 });
      expect(session.commit).toHaveBeenCalledWith({
        x: 20,
        y: -10,
        rotation: 0,
        scale: 1,
      });
    });

    it('모서리 바깥 회전은 실제 영역 중심에서 시작하고 Shift는 15° 단위로 스냅한다', async () => {
      const session = openSession();
      const handle = rotateCorner()!;
      const fromX =
        parseFloat(handle.style.left) + parseFloat(handle.style.width) / 2;
      const fromY =
        parseFloat(handle.style.top) + parseFloat(handle.style.height) / 2;
      const toX = 110 - (fromY - 70);
      const toY = 70 + (fromX - 110);
      pointer('pointerdown', handle, { clientX: fromX, clientY: fromY });
      pointer('pointermove', window, { clientX: toX, clientY: toY });
      await flushFrame();
      const rotated = (
        session.preview as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)![0];
      expect(rotated.rotation).toBeCloseTo(90, 6);

      pointer('pointermove', window, {
        clientX: toX + 3,
        clientY: toY,
        shiftKey: true,
      });
      await flushFrame();
      const snapped = (
        session.preview as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)![0];
      expect(snapped.rotation).toBe(90);
      expect(session.commit).not.toHaveBeenCalled();
      pointer('pointerup', window, { clientX: toX + 3, clientY: toY });
      expect(session.commit).toHaveBeenCalledWith(
        expect.objectContaining({ rotation: 90 }),
      );
    });

    it('모서리 노브는 축까지 거리 비로 배율을 바꾼다', async () => {
      const session = openSession();
      // 축 (110, 70)에서 50px 떨어진 곳에서 100px 떨어진 곳으로 - 배율 2
      pointer('pointerdown', scaleKnobs()[0], { clientX: 160, clientY: 70 });
      pointer('pointermove', window, { clientX: 210, clientY: 70 });
      await flushFrame();
      const scaled = (
        session.preview as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1)![0];
      expect(scaled.scale).toBeCloseTo(2, 9);
      expect(session.commit).not.toHaveBeenCalled();
      pointer('pointerup', window, { clientX: 210, clientY: 70 });
      expect(session.commit).toHaveBeenCalledWith(
        expect.objectContaining({ scale: 2 }),
      );
    });

    it('다른 pointerId의 move·up은 무시되고 세션 종료가 드래그를 취소한다', async () => {
      const session = openSession();
      pointer('pointerdown', poseFrame()!, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, {
        clientX: 150,
        clientY: 100,
        pointerId: 2,
      });
      await flushFrame();
      expect(session.preview).not.toHaveBeenCalled();
      pointer('pointerup', window, {
        clientX: 150,
        clientY: 100,
        pointerId: 2,
      });
      expect(session.commit).not.toHaveBeenCalled();

      act(() => useSpritePoseHandleStore.getState().setSession(null));
      expect(session.cancel).toHaveBeenCalled();
      pointer('pointerup', window, { clientX: 150, clientY: 100 });
      expect(session.commit).not.toHaveBeenCalled();
    });

    it('캡처 해제의 buttons가 남아 있어도 마지막 자세를 커밋한다', async () => {
      const session = openSession();
      const frame = poseFrame()!;
      pointer('pointerdown', frame, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, { clientX: 150, clientY: 100 });
      await flushFrame();
      expect(session.preview).toHaveBeenCalled();

      pointer('lostpointercapture', frame, { pointerId: 1 });
      expect(session.commit).toHaveBeenCalledOnce();
      expect(session.commit).toHaveBeenCalledWith(
        expect.objectContaining({ x: 50, y: 0 }),
      );
      expect(session.cancel).not.toHaveBeenCalled();
      pointer('pointerup', window, { clientX: 150, clientY: 100 });
      expect(session.commit).toHaveBeenCalledOnce();
    });

    it('버튼을 놓은 캡처 해제는 누락된 up 대신 마지막 자세를 커밋한다', async () => {
      const session = openSession();
      const frame = poseFrame()!;
      pointer('pointerdown', frame, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, { clientX: 150, clientY: 100 });
      await flushFrame();

      pointer('lostpointercapture', frame, { pointerId: 1, buttons: 0 });
      expect(session.commit).toHaveBeenCalledOnce();
      expect(session.commit).toHaveBeenCalledWith(
        expect.objectContaining({ x: 50, y: 0 }),
      );
      expect(session.cancel).not.toHaveBeenCalled();

      pointer('pointerup', window, { clientX: 150, clientY: 100 });
      expect(session.commit).toHaveBeenCalledOnce();
    });

    it('pointerup이 누락돼도 mouseup으로 마지막 자세를 커밋한다', async () => {
      const session = openSession();
      const frame = poseFrame()!;
      pointer('pointerdown', frame, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, { clientX: 150, clientY: 100 });
      await flushFrame();

      act(() => {
        window.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 0,
          }),
        );
      });
      expect(session.commit).toHaveBeenCalledOnce();
      expect(session.commit).toHaveBeenCalledWith(
        expect.objectContaining({ x: 50, y: 0 }),
      );

      pointer('pointermove', window, {
        clientX: 180,
        clientY: 100,
        buttons: 0,
      });
      await flushFrame();
      expect(session.preview).toHaveBeenCalledTimes(1);
    });

    it('눌린 move 뒤 buttons 0 move만 오면 누락된 up으로 정산한다', async () => {
      const session = openSession();
      const frame = poseFrame()!;
      pointer('pointerdown', frame, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, {
        clientX: 130,
        clientY: 100,
        buttons: 1,
      });
      await flushFrame();

      pointer('pointermove', window, {
        clientX: 150,
        clientY: 100,
        buttons: 0,
      });
      expect(session.commit).toHaveBeenCalledOnce();
      expect(session.commit).toHaveBeenCalledWith(
        expect.objectContaining({ x: 50, y: 0 }),
      );

      pointer('pointermove', window, {
        clientX: 180,
        clientY: 100,
        buttons: 0,
      });
      pointer('pointerup', window, { clientX: 180, clientY: 100 });
      await flushFrame();
      expect(session.preview).toHaveBeenCalledTimes(2);
      expect(session.commit).toHaveBeenCalledOnce();
    });

    it('리사이즈 착지의 소유권 무효화 뒤 up은 커밋 대신 취소한다', async () => {
      const session = openSession();
      pointer('pointerdown', poseFrame()!, { clientX: 100, clientY: 100 });
      pointer('pointermove', window, { clientX: 150, clientY: 100 });
      await flushFrame();
      act(() =>
        useSpritePoseHandleStore.getState().invalidateOwnership(SPRITE_ID),
      );
      pointer('pointerup', window, { clientX: 150, clientY: 100 });
      expect(session.commit).not.toHaveBeenCalled();
      expect(session.cancel).toHaveBeenCalled();
    });

    it('같은 자세라도 요소 원점이 바뀌면 진행 중 드래그의 좌표계 소유권을 무효화한다', () => {
      const session = openSession();
      pointer('pointerdown', poseFrame()!, { clientX: 100, clientY: 100 });

      act(() =>
        useSpritePoseHandleStore.getState().setSession({
          ...session,
          origin: { dx: 40, dy: 60 },
        }),
      );
      pointer('pointerup', window, { clientX: 150, clientY: 100 });

      expect(session.commit).not.toHaveBeenCalled();
      expect(session.cancel).toHaveBeenCalled();
    });
  });
});
