// @vitest-environment jsdom
/**
 * 온캔버스 그라데이션 축 핸들 로직 테스트
 * 축·색 분리 모델: 축 선/회전 핸들 드래그 → 각도만, 스톱 점 드래그 → pos만,
 * 축 선 클릭 → 스톱 추가, 키보드 화살표 → 각도 커밋
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GradientAxisOverlay from '@components/main/Grid/handles/GradientAxisHandle';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import type { GradientSpec } from '@src/types/color';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const SPEC: GradientSpec = {
  angle: 90,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: '#0000ff', pos: 1 },
  ],
};
const ELEMENT_A_ID = '11111111-1111-4111-8111-111111111111';
const ELEMENT_B_ID = '22222222-2222-4222-8222-222222222222';

const positions = {
  '4key': [
    {
      id: ELEMENT_A_ID,
      dx: 100,
      dy: 100,
      width: 200,
      height: 100,
    },
  ],
} as never;

// jsdom에는 PointerEvent가 없어 MouseEvent 기반으로 합성
const pointerEvent = (
  type: string,
  init: {
    pointerId: number;
    clientX: number;
    clientY: number;
    button?: number;
  },
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: init.button ?? 0,
    // 드래그 중 버튼 유지 — buttons 0은 stale 드래그로 간주돼 취소됨
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  return event;
};

describe('GradientAxisOverlay 드래그 로직', () => {
  let root: Root;
  let host: HTMLDivElement;
  let apply: ReturnType<
    typeof vi.fn<(spec: GradientSpec, commit: boolean) => void>
  >;
  let selectStop: ReturnType<typeof vi.fn<(index: number) => void>>;
  let cancel: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    apply = vi.fn<(spec: GradientSpec, commit: boolean) => void>();
    selectStop = vi.fn<(index: number) => void>();
    cancel = vi.fn<() => void>();
    act(() => {
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'key', id: ELEMENT_A_ID },
        sessionKey: 'key:4key:0:backgroundColor:idle',
        surface: 'background',
        stateMode: 'idle',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply,
        cancel,
      });
      root.render(
        <GradientAxisOverlay
          positions={positions}
          statPositions={{} as never}
          graphPositions={{} as never}
          knobPositions={{} as never}
          selectedElements={[]}
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
          continuousInputStrategy="legacy"
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      useGradientEditStore.getState().setSession(null);
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  const strip = () => host.querySelector('[role="slider"]') as HTMLElement;
  const axisAnchor = (end: 'start' | 'end') =>
    host.querySelector(`[data-axis-anchor="${end}"]`) as HTMLElement;
  const stopDot = (n: number) =>
    host.querySelector(`[aria-label="stop ${n}"]`) as HTMLElement;

  it('세션이 있으면 축 슬라이더·끝 앵커·스톱 점을 렌더한다', () => {
    expect(strip()).toBeTruthy();
    expect(axisAnchor('start')).toBeTruthy();
    expect(axisAnchor('end')).toBeTruthy();
    expect(stopDot(1)).toBeTruthy();
    expect(stopDot(2)).toBeTruthy();
  });

  it('같은 모드 재정렬 뒤에도 축과 커밋은 원래 ID의 요소를 가리킨다', () => {
    act(() => {
      root.render(
        <GradientAxisOverlay
          positions={
            {
              '4key': [
                {
                  id: ELEMENT_B_ID,
                  dx: 500,
                  dy: 400,
                  width: 60,
                  height: 60,
                },
                {
                  id: ELEMENT_A_ID,
                  dx: 100,
                  dy: 100,
                  width: 200,
                  height: 100,
                },
              ],
            } as never
          }
          statPositions={{} as never}
          graphPositions={{} as never}
          knobPositions={{} as never}
          selectedElements={[]}
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
          continuousInputStrategy="legacy"
        />,
      );
    });

    expect(strip().style.left).toBe('200px');
    expect(strip().style.top).toBe('150px');

    act(() => {
      strip().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ angle: 91 }),
      true,
    );
  });

  it('세션 대상 ID가 사라지면 축 세션을 취소한다', () => {
    act(() => {
      root.render(
        <GradientAxisOverlay
          positions={
            {
              '4key': [
                {
                  id: ELEMENT_B_ID,
                  dx: 500,
                  dy: 400,
                  width: 60,
                  height: 60,
                },
              ],
            } as never
          }
          statPositions={{} as never}
          graphPositions={{} as never}
          knobPositions={{} as never}
          selectedElements={[]}
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
          continuousInputStrategy="legacy"
        />,
      );
    });

    expect(useGradientEditStore.getState().session).toBeNull();
    expect(
      host.querySelector('[data-dmn-canvas-editor-overlay="true"]'),
    ).toBeNull();
  });

  it('축을 잡고 window에서 움직이면 각도 프리뷰·커밋이 적용된다', () => {
    // 요소 중심 (200, 150), 각도 90 → 축은 수평
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 260,
          clientY: 150,
        }),
      );
    });
    // 임계값 전에도 프레스 즉시 잡기 커서 - 전역 클래스로 고정, 인라인은 대기값
    expect(document.documentElement.classList.contains('dmn-drag-cursor')).toBe(
      true,
    );
    expect(strip().style.cursor).toBe('default');

    act(() => {
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 1,
          clientX: 260,
          clientY: 90,
        }),
      );
    });
    expect(strip().style.cursor).toBe('grabbing');
    expect(apply).toHaveBeenCalled();
    const [previewSpec, previewCommit] = apply.mock.calls.at(-1)!;
    expect(previewCommit).toBe(false);
    expect(previewSpec.angle).not.toBe(90);

    act(() => {
      window.dispatchEvent(
        pointerEvent('pointerup', { pointerId: 1, clientX: 260, clientY: 90 }),
      );
    });
    const [finalSpec, finalCommit] = apply.mock.calls.at(-1)!;
    expect(finalCommit).toBe(true);
    expect(finalSpec.angle).not.toBe(90);
    // 놓으면 전역 커서 고정 해제
    expect(document.documentElement.classList.contains('dmn-drag-cursor')).toBe(
      false,
    );
  });

  it('드래그 중 오버레이가 언마운트되면 시작 spec으로 복원한다', () => {
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 10,
          clientX: 260,
          clientY: 150,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 10,
          clientX: 260,
          clientY: 90,
        }),
      );
    });
    expect(apply).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ angle: SPEC.angle }),
      false,
    );

    act(() => root.render(null));

    expect(apply).toHaveBeenLastCalledWith(SPEC, false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(apply.mock.calls.some(([, commit]) => commit)).toBe(false);
  });

  it('pointercancel은 시작 spec을 복원하고 외부 preview 제스처를 폐기한다', () => {
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 11,
          clientX: 260,
          clientY: 150,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 11,
          clientX: 260,
          clientY: 90,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointercancel', {
          pointerId: 11,
          clientX: 260,
          clientY: 90,
        }),
      );
    });

    expect(apply).toHaveBeenLastCalledWith(SPEC, false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('축 끝 앵커를 끌면 각도만 바뀐다', () => {
    // end 앵커 위치: 선 끝 (300, 150)
    act(() => {
      axisAnchor('end').dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 3,
          clientX: 300,
          clientY: 150,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 3,
          clientX: 200,
          clientY: 60,
        }),
      );
    });
    const [previewSpec, previewCommit] = apply.mock.calls.at(-1)!;
    expect(previewCommit).toBe(false);
    expect(previewSpec.angle).toBe(0);
    expect(previewSpec.stops).toEqual(SPEC.stops);

    act(() => {
      window.dispatchEvent(
        pointerEvent('pointerup', { pointerId: 3, clientX: 200, clientY: 60 }),
      );
    });
    const [finalSpec, finalCommit] = apply.mock.calls.at(-1)!;
    expect(finalCommit).toBe(true);
    expect(finalSpec.angle).toBe(0);
  });

  it('스톱 점을 끌면 축에 사영된 pos만 바뀌고 각도는 불변이다', () => {
    act(() => {
      stopDot(1).dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 2,
          clientX: 100,
          clientY: 150,
        }),
      );
    });
    expect(selectStop).toHaveBeenCalledWith(0);

    // 대각선 드래그 — 축(수평) 성분만 반영돼야 한다
    act(() => {
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 2,
          clientX: 160,
          clientY: 90,
        }),
      );
    });
    expect(apply).toHaveBeenCalled();
    const [previewSpec, previewCommit] = apply.mock.calls.at(-1)!;
    expect(previewCommit).toBe(false);
    expect(previewSpec.angle).toBe(90);
    expect(previewSpec.stops[0].pos).toBeCloseTo(0.3);
  });

  it('스톱 연속 이동은 프레임당 최신 좌표 한 번만 프리뷰한다', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));

    act(() => {
      root.render(
        <GradientAxisOverlay
          positions={positions}
          statPositions={{} as never}
          graphPositions={{} as never}
          knobPositions={{} as never}
          selectedElements={[]}
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
        />,
      );
    });
    act(() => {
      stopDot(1).dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 12,
          clientX: 100,
          clientY: 150,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 12,
          clientX: 140,
          clientY: 150,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 12,
          clientX: 180,
          clientY: 150,
        }),
      );
    });

    expect(apply).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    act(() => {
      const callback = [...callbacks.values()][0];
      callbacks.clear();
      callback(performance.now());
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stops: expect.arrayContaining([
          expect.objectContaining({ pos: expect.closeTo(0.4, 5) }),
        ]),
      }),
      false,
    );
    act(() => {
      window.dispatchEvent(
        pointerEvent('pointerup', {
          pointerId: 12,
          clientX: 180,
          clientY: 150,
        }),
      );
    });
  });

  it('프레임 전 pointerup도 마지막 스톱 좌표를 커밋한다', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    act(() => {
      root.render(
        <GradientAxisOverlay
          positions={positions}
          statPositions={{} as never}
          graphPositions={{} as never}
          knobPositions={{} as never}
          selectedElements={[]}
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
        />,
      );
      stopDot(1).dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 13,
          clientX: 100,
          clientY: 150,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 13,
          clientX: 140,
          clientY: 150,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointerup', {
          pointerId: 13,
          clientX: 180,
          clientY: 150,
        }),
      );
    });

    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stops: expect.arrayContaining([
          expect.objectContaining({ pos: expect.closeTo(0.4, 5) }),
        ]),
      }),
      true,
    );
  });

  it('축 선을 클릭하면 그 위치에 스톱이 추가된다', () => {
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 4,
          clientX: 240,
          clientY: 150,
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        pointerEvent('pointerup', { pointerId: 4, clientX: 240, clientY: 150 }),
      );
    });
    const [finalSpec, finalCommit] = apply.mock.calls.at(-1)!;
    expect(finalCommit).toBe(true);
    expect(finalSpec.stops).toHaveLength(3);
    expect(finalSpec.stops[1].pos).toBeCloseTo(0.7);
    expect(finalSpec.stops[1].color).toBe('#ff0000');
    expect(selectStop).toHaveBeenCalledWith(1);
  });

  it('키보드 화살표로 각도가 커밋된다', () => {
    act(() => {
      strip().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ angle: 91 }),
      true,
    );
  });

  it('축을 클릭하면 슬라이더가 포커스를 받는다', () => {
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 7,
          clientX: 260,
          clientY: 150,
        }),
      );
    });
    expect(document.activeElement).toBe(strip());
    act(() => {
      window.dispatchEvent(
        pointerEvent('pointerup', { pointerId: 7, clientX: 260, clientY: 150 }),
      );
    });
  });

  it('드래그 도중 세션이 다른 상태로 교체되면 새 세션에 커밋하지 않는다', () => {
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 5,
          clientX: 260,
          clientY: 150,
        }),
      );
    });

    // 같은 요소의 입력(active) 상태 세션으로 교체 — 대기/입력 탭 전환 시나리오
    const activeApply = vi.fn<(spec: GradientSpec, commit: boolean) => void>();
    act(() => {
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'key', id: ELEMENT_A_ID },
        sessionKey: 'key:4key:0:backgroundColor:active',
        surface: 'background',
        stateMode: 'active',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply: activeApply,
      });
    });

    act(() => {
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 5,
          clientX: 260,
          clientY: 90,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointerup', { pointerId: 5, clientX: 260, clientY: 90 }),
      );
    });
    // 새 세션에는 프리뷰도 커밋도 가지 않는다
    expect(activeApply).not.toHaveBeenCalled();
  });

  it('포인터 이벤트 사이에 세션이 A→B→새 A로 왕복해도 커밋하지 않는다', () => {
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 6,
          clientX: 260,
          clientY: 150,
        }),
      );
    });

    // 포인터 이벤트 없이 B(입력 상태) 경유 후 같은 key의 새 A 세션으로 복귀
    const newIdleApply = vi.fn<(spec: GradientSpec, commit: boolean) => void>();
    act(() => {
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'key', id: ELEMENT_A_ID },
        sessionKey: 'key:4key:0:backgroundColor:active',
        surface: 'background',
        stateMode: 'active',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply: vi.fn(),
      });
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'key', id: ELEMENT_A_ID },
        sessionKey: 'key:4key:0:backgroundColor:idle',
        surface: 'background',
        stateMode: 'idle',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply: newIdleApply,
      });
    });

    act(() => {
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 6,
          clientX: 260,
          clientY: 90,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointerup', { pointerId: 6, clientX: 260, clientY: 90 }),
      );
    });
    // 세대 불일치로 드래그가 중단돼야 한다 — 원 세션·새 세션 모두 무커밋
    expect(newIdleApply).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('포인터 이벤트 사이에 세션이 A→null→새 A로 재개방돼도 커밋하지 않는다', () => {
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 9,
          clientX: 260,
          clientY: 150,
        }),
      );
    });

    const newIdleApply = vi.fn<(spec: GradientSpec, commit: boolean) => void>();
    act(() => {
      useGradientEditStore.getState().setSession(null);
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'key', id: ELEMENT_A_ID },
        sessionKey: 'key:4key:0:backgroundColor:idle',
        surface: 'background',
        stateMode: 'idle',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply: newIdleApply,
      });
    });

    act(() => {
      window.dispatchEvent(
        pointerEvent('pointermove', {
          pointerId: 9,
          clientX: 260,
          clientY: 90,
        }),
      );
      window.dispatchEvent(
        pointerEvent('pointerup', { pointerId: 9, clientX: 260, clientY: 90 }),
      );
    });

    expect(newIdleApply).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('batch idle 세션은 선택 전체 bounds 중심을 쓴다', () => {
    act(() => {
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'batch' },
        sessionKey: 'batch:4key:backgroundColor:idle',
        surface: 'background',
        stateMode: 'idle',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply,
      });
      root.render(
        <GradientAxisOverlay
          positions={positions}
          statPositions={
            {
              '4key': [
                {
                  id: '33333333-3333-4333-8333-333333333333',
                  dx: 400,
                  dy: 400,
                  width: 60,
                  height: 60,
                },
              ],
            } as never
          }
          graphPositions={{} as never}
          knobPositions={{} as never}
          selectedElements={
            [
              { type: 'key', id: ELEMENT_A_ID, index: 0 },
              {
                type: 'stat',
                id: '33333333-3333-4333-8333-333333333333',
                index: 0,
              },
            ] as never
          }
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
          continuousInputStrategy="legacy"
        />,
      );
    });
    // key(100,100,200x100) + stat(400,400,60x60) → 전체 (100..460) 중심
    expect(strip().style.left).toBe('280px');
    expect(strip().style.top).toBe('280px');
  });

  it('batch active 세션은 키·노브 bounds 중심만 쓴다', () => {
    // active 편집 대상이 아닌 통계·그래프는 축 중심·자석 각도에서 제외
    act(() => {
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'batch' },
        sessionKey: 'batch:4key:backgroundColor:active',
        surface: 'background',
        stateMode: 'active',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply,
      });
      root.render(
        <GradientAxisOverlay
          positions={positions}
          statPositions={
            {
              '4key': [
                {
                  id: '33333333-3333-4333-8333-333333333333',
                  dx: 400,
                  dy: 400,
                  width: 60,
                  height: 60,
                },
              ],
            } as never
          }
          graphPositions={{} as never}
          knobPositions={{} as never}
          selectedElements={
            [
              { type: 'key', id: ELEMENT_A_ID, index: 0 },
              {
                type: 'stat',
                id: '33333333-3333-4333-8333-333333333333',
                index: 0,
              },
            ] as never
          }
          selectedKeyType="4key"
          zoom={1}
          panX={0}
          panY={0}
          continuousInputStrategy="legacy"
        />,
      );
    });
    // 편집 대상은 키뿐 → 키(100,100,200x100) 중심
    expect(strip().style.left).toBe('200px');
    expect(strip().style.top).toBe('150px');
  });

  it('A→B→새 A 왕복 후 pointercancel도 새 세션에 stale 롤백을 보내지 않는다', () => {
    act(() => {
      strip().dispatchEvent(
        pointerEvent('pointerdown', {
          pointerId: 8,
          clientX: 260,
          clientY: 150,
        }),
      );
    });

    const newIdleApply = vi.fn<(spec: GradientSpec, commit: boolean) => void>();
    act(() => {
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'key', id: ELEMENT_A_ID },
        sessionKey: 'key:4key:0:backgroundColor:active',
        surface: 'background',
        stateMode: 'active',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply: vi.fn(),
      });
      useGradientEditStore.getState().setSession({
        anchor: { kind: 'key', id: ELEMENT_A_ID },
        sessionKey: 'key:4key:0:backgroundColor:idle',
        surface: 'background',
        stateMode: 'idle',
        spec: SPEC,
        selectedIndex: 0,
        selectStop,
        apply: newIdleApply,
      });
    });

    act(() => {
      window.dispatchEvent(
        pointerEvent('pointercancel', {
          pointerId: 8,
          clientX: 260,
          clientY: 150,
        }),
      );
    });
    // 취소 경로도 세대 검사 — 교체된 세션에 startSpec 복원 preview 미전달
    expect(newIdleApply).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
