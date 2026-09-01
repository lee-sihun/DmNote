/**
 * 자세 기즈모 드래그 소유권
 * - 노브 드래그가 축 고정 역산으로 preview·commit을 흘리고 마지막 move를 flush한다
 * - 다른 pointerId의 move·up은 무시된다
 * - 세션 종료가 활성 드래그를 취소하고 전역 드래그 락을 돌려놓는다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useSpritePoseGizmoStore,
  type SpritePoseGizmoSession,
} from '@stores/grid/useSpritePoseGizmoStore';
import {
  releaseDragSession,
  tryAcquireDragSession,
} from '@hooks/Grid/dragSession';

import SpritePoseGizmo from './SpritePoseGizmo';

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// 축(50,50)·핀(50,200) - 아래로 뻗은 팔, 기본 길이 150px
const makeSession = (
  overrides: Partial<SpritePoseGizmoSession> = {},
): SpritePoseGizmoSession => ({
  positionId: 'sprite-1',
  poseId: 'pose-1',
  origin: { dx: 0, dy: 0 },
  imageRect: { x: 0, y: 0, width: 100, height: 200 },
  pivot: { x: 0.5, y: 0.25 },
  contactPoint: { x: 0.5, y: 1 },
  transform: { x: 0, y: 0, rotation: 0, scale: 1 },
  stretch: false,
  preview: vi.fn(),
  commit: vi.fn(),
  cancel: vi.fn(),
  commitContactPoint: vi.fn(),
  ...overrides,
});

describe('SpritePoseGizmo', () => {
  let container: HTMLDivElement;
  let root: Root;

  const knob = () =>
    container.querySelector<HTMLElement>('[data-sprite-contact-knob="true"]');

  const pointer = (
    type: string,
    target: EventTarget,
    init: { clientX?: number; clientY?: number; pointerId?: number } = {},
  ) =>
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: init.clientX ?? 0,
          clientY: init.clientY ?? 0,
          pointerId: init.pointerId ?? 1,
        }),
      );
    });

  beforeEach(() => {
    // rAF 스케줄러를 타이머로 강등 - flush 경로와 분리해 결정적으로 만든다
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    act(() => useSpritePoseGizmoStore.getState().setSession(null));
    releaseDragSession();
    vi.unstubAllGlobals();
  });

  const render = (session: SpritePoseGizmoSession) => {
    act(() => useSpritePoseGizmoStore.getState().setSession(session));
    act(() => {
      root.render(<SpritePoseGizmo zoom={1} panX={0} panY={0} />);
    });
  };

  it('세션이 없으면 그리지 않고, 있으면 핀 위치에 노브를 그린다', () => {
    act(() => {
      root.render(<SpritePoseGizmo zoom={1} panX={0} panY={0} />);
    });
    expect(knob()).toBeNull();

    render(makeSession());
    const el = knob()!;
    // 핀 월드 (50,200), 히트 박스 22px 중앙 정렬
    expect(el.style.left).toBe('39px');
    expect(el.style.top).toBe('189px');
  });

  // 팝업은 body 포털이라 캔버스 노브는 바깥 클릭으로 읽힌다. 이 마커가 없으면
  // 노브를 누르는 순간 자세 팝업이 닫히고 세션이 걷혀 드래그가 즉사한다
  it('루트에 온캔버스 편집 오버레이 마커를 싣는다', () => {
    render(makeSession());
    expect(
      knob()!.closest('[data-dmn-canvas-editor-overlay="true"]'),
    ).not.toBeNull();
  });

  it('노브 드래그는 up에서 마지막 move를 flush해 커밋한다 - 축 고정 회전 역산', () => {
    const session = makeSession();
    render(session);

    pointer('pointerdown', knob()!, { clientX: 50, clientY: 200 });
    // rAF 타이머를 돌리지 않아도 up의 flush가 이 좌표를 반영해야 한다
    pointer('pointermove', window, { clientX: 200, clientY: 50 });
    pointer('pointerup', window, { clientX: 200, clientY: 50 });

    expect(session.commit).toHaveBeenCalledTimes(1);
    const committed = (session.commit as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // 아래(90°) → 오른쪽(0°) 목표, 축 고정이라 x·y 불변
    expect(committed.rotation).toBeCloseTo(-90, 4);
    expect(committed.scale).toBe(1);
    expect(committed.x).toBe(0);
    expect(committed.y).toBe(0);
    expect(session.cancel).not.toHaveBeenCalled();
  });

  it('다른 pointerId의 move·up은 활성 드래그에 개입하지 못한다', () => {
    const session = makeSession();
    render(session);

    pointer('pointerdown', knob()!, {
      clientX: 50,
      clientY: 200,
      pointerId: 1,
    });
    pointer('pointermove', window, {
      clientX: 999,
      clientY: 999,
      pointerId: 2,
    });
    pointer('pointerup', window, { clientX: 999, clientY: 999, pointerId: 2 });
    expect(session.commit).not.toHaveBeenCalled();

    pointer('pointermove', window, { clientX: 200, clientY: 50, pointerId: 1 });
    pointer('pointerup', window, { clientX: 200, clientY: 50, pointerId: 1 });
    expect(session.commit).toHaveBeenCalledTimes(1);
    expect(
      (session.commit as ReturnType<typeof vi.fn>).mock.calls[0][0].rotation,
    ).toBeCloseTo(-90, 4);
  });

  it('드래그 중 세션 종료는 제스처를 취소하고 전역 드래그 락을 돌려놓는다', () => {
    const session = makeSession();
    render(session);

    pointer('pointerdown', knob()!, { clientX: 50, clientY: 200 });
    // 드래그가 락을 점유 중이다
    expect(tryAcquireDragSession()).toBe(false);

    act(() => useSpritePoseGizmoStore.getState().setSession(null));

    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(session.commit).not.toHaveBeenCalled();
    // 락 반환 - 이후 요소 드래그가 다시 가능해야 한다
    expect(tryAcquireDragSession()).toBe(true);
    releaseDragSession();

    // 유령 up이 와도 커밋되지 않는다
    pointer('pointerup', window, { clientX: 200, clientY: 50 });
    expect(session.commit).not.toHaveBeenCalled();
  });

  // 리사이즈 착지·undo는 세션을 유지한 채 세대만 올린다. 이때 대기 중이던 마지막
  // move를 flush하면 패널이 이미 닫아둔 preview 제스처가 다시 열리고, 커밋만
  // 생략되어 낡은 세션이 남는다
  it('소유권이 무효화되면 대기 move를 버리고 커밋 없이 취소한다', () => {
    const session = makeSession();
    render(session);

    pointer('pointerdown', knob()!, { clientX: 50, clientY: 200 });
    pointer('pointermove', window, { clientX: 200, clientY: 50 });
    act(() =>
      useSpritePoseGizmoStore.getState().invalidateOwnership('sprite-1'),
    );
    (session.preview as ReturnType<typeof vi.fn>).mockClear();

    pointer('pointerup', window, { clientX: 200, clientY: 50 });

    expect(session.preview).not.toHaveBeenCalled();
    expect(session.commit).not.toHaveBeenCalled();
    expect(session.cancel).toHaveBeenCalledTimes(1);
    // 락 반환까지 포기 경로와 동일해야 한다
    expect(tryAcquireDragSession()).toBe(true);
    releaseDragSession();
  });

  it('소유권 무효화 뒤의 move는 preview를 되열지 않는다', async () => {
    const session = makeSession();
    render(session);

    pointer('pointerdown', knob()!, { clientX: 50, clientY: 200 });
    act(() =>
      useSpritePoseGizmoStore.getState().invalidateOwnership('sprite-1'),
    );

    pointer('pointermove', window, { clientX: 200, clientY: 50 });
    // rAF 스케줄러가 타이머로 강등돼 있어 한 틱 뒤에 콜백이 돈다
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(session.preview).not.toHaveBeenCalled();
  });

  it('Alt 드래그는 transform 대신 핀 위치를 커밋한다', () => {
    const session = makeSession();
    render(session);

    act(() => {
      knob()!.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 50,
          clientY: 200,
          pointerId: 1,
          altKey: true,
        }),
      );
    });
    pointer('pointermove', window, { clientX: 50, clientY: 100 });
    pointer('pointerup', window, { clientX: 50, clientY: 100 });

    expect(session.commit).not.toHaveBeenCalled();
    expect(session.commitContactPoint).toHaveBeenCalledTimes(1);
    const pin = (session.commitContactPoint as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // (50,100) → 이미지 정규화 (0.5, 0.5)
    expect(pin.x).toBeCloseTo(0.5, 4);
    expect(pin.y).toBeCloseTo(0.5, 4);
  });
});
