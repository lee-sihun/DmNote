/**
 * 드래그 세션이 반드시 끝나는지 고정한다
 *
 * pointerup이 안 오는 경로가 실제로 있다. 창 밖에서 버튼을 떼거나, 캡처하던 행이
 * 언마운트되거나, 사용자가 Esc로 무르거나. 세션이 안 끝나면 body에 고스트가 박히고
 * 전역 grabbing 커서가 남아 사용자에게는 앱이 굳은 것으로 보인다
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bendMotion = vi.hoisted(() => ({
  start: vi.fn(),
  move: vi.fn(),
  release: vi.fn(() => true),
  cancel: vi.fn(),
}));

vi.mock('@api/modules/keysApi', () => ({
  keysApi: { tabs: { swap: vi.fn(() => Promise.resolve({})) } },
}));
vi.mock('@hooks/useLenis', () => ({ scrollLenisBy: vi.fn() }));
vi.mock('@utils/animation/dragBendMotion', () => ({
  createDragBendMotion: () => bendMotion,
}));

import { keysApi } from '@api/modules/keysApi';
import { TabDragProvider } from './tabDrag';
import { useTabDrag } from './tabDragContext';
import { useKeyStore } from '@stores/data/useKeyStore';
import {
  endPopupDragSession,
  getPopupDragSessionState,
} from '@utils/ui/popupDragSession';

const CHIP_ID = 'custom-a';
const OTHER_ID = 'custom-b';
const ORDER = [CHIP_ID, OTHER_ID, '4key', '5key', '6key', '8key'];

/** jsdom은 레이아웃을 재지 않는다. 판정에 쓰는 사각형만 심어 준다 */
const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top } as
    | DOMRect
    | undefined as DOMRect);

const placeRef =
  (box: DOMRect, register: (element: HTMLElement | null) => void) =>
  (element: HTMLElement | null) => {
    if (element) element.getBoundingClientRect = () => box;
    register(element);
  };

/**
 * 교체 직후 탭이 바와 팝업 양쪽에 잠시 등록된 상태를 흉내 낸다.
 * 마운트와 언마운트 순서가 정해져 있지 않아 실제로 겹치는 프레임이 있다
 */
const Chip = () => {
  const { beginDrag, registerTarget, registerZone } = useTabDrag();
  return (
    <>
      <div ref={placeRef(rect(0, 0, 200, 30), registerZone('bar'))}>
        <div
          data-testid="chip"
          ref={placeRef(
            rect(0, 0, 100, 30),
            registerTarget(CHIP_ID, 'horizontal'),
          )}
          className="dmn-tab-chip"
          onPointerDown={(event) => beginDrag(CHIP_ID, event)}
        />
        <div
          data-testid="chip-other"
          ref={placeRef(
            rect(100, 0, 200, 30),
            registerTarget(OTHER_ID, 'horizontal'),
          )}
          className="dmn-tab-chip"
          onPointerDown={(event) => beginDrag(OTHER_ID, event)}
        />
      </div>
      <div ref={placeRef(rect(0, 100, 200, 160), registerZone('overflow'))}>
        <div
          data-testid="row"
          ref={placeRef(
            rect(0, 100, 200, 130),
            registerTarget(CHIP_ID, 'vertical'),
          )}
          className="dmn-tab-chip"
          onPointerDown={(event) => beginDrag(CHIP_ID, event)}
        />
        <div
          data-testid="row-other"
          ref={placeRef(
            rect(0, 130, 200, 160),
            registerTarget(OTHER_ID, 'vertical'),
          )}
          className="dmn-tab-chip"
          onPointerDown={(event) => beginDrag(OTHER_ID, event)}
        />
      </div>
    </>
  );
};

/** jsdom에는 PointerEvent가 없다. 포인터 전용 필드는 getter라 정의로 덮어야 한다 */
const pointerEvent = (
  type: string,
  init: MouseEventInit & {
    pointerId?: number;
    isPrimary?: boolean;
    buttons?: number;
  } = {},
) => {
  const { pointerId = 1, isPrimary = true, buttons = 1, ...mouseInit } = init;
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...mouseInit,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    isPrimary: { value: isPrimary },
    buttons: { value: buttons },
  });
  return event;
};

let container: HTMLDivElement;
let root: Root;

const ghosts = () => document.body.querySelectorAll('.dmn-tab-ghost');

/** 임계 4px를 넘겨 드래그를 실제로 연다 */
const startDrag = (testId = 'chip', to = { clientX: 40, clientY: 40 }) => {
  const chip = container.querySelector(`[data-testid="${testId}"]`)!;
  act(() => {
    chip.dispatchEvent(pointerEvent('pointerdown', { button: 0 }));
  });
  act(() => {
    window.dispatchEvent(pointerEvent('pointermove', to));
  });
  return chip as HTMLElement;
};

const drop = (at: { clientX: number; clientY: number }) => {
  act(() => {
    window.dispatchEvent(pointerEvent('pointermove', at));
  });
  act(() => {
    window.dispatchEvent(pointerEvent('pointerup', at));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(keysApi.tabs.swap).mockClear();
  bendMotion.start.mockClear();
  bendMotion.move.mockClear();
  bendMotion.release.mockReset();
  bendMotion.release.mockReturnValue(true);
  bendMotion.cancel.mockClear();
  useKeyStore.setState({
    customTabs: [
      { id: CHIP_ID, name: 'A' },
      { id: OTHER_ID, name: 'B' },
    ],
    tabOrder: ORDER,
    barCount: 4,
    pendingTabPlacements: 0,
    deferredTabPlacement: null,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <TabDragProvider>
        <Chip />
      </TabDragProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.classList.remove('dmn-dragging');
  endPopupDragSession();
});

describe('바와 팝업 양쪽에 등록된 탭', () => {
  it('바에서 집어 바의 다른 칩에 놓으면 교체가 커밋된다', () => {
    startDrag('chip', { clientX: 20, clientY: 15 });
    drop({ clientX: 150, clientY: 15 });

    // 결과 배열이 아니라 두 id만 보낸다
    expect(keysApi.tabs.swap).toHaveBeenCalledWith(CHIP_ID, OTHER_ID);
  });

  it('같은 탭을 팝업에서 집어도 팝업 행이 대상으로 잡힌다', () => {
    startDrag('row', { clientX: 100, clientY: 110 });
    drop({ clientX: 100, clientY: 145 });

    expect(keysApi.tabs.swap).toHaveBeenCalledWith(CHIP_ID, OTHER_ID);
  });

  it('거절되면 백엔드가 돌려준 권위 순서로 수렴한다', async () => {
    // 두 탭 중 하나가 다른 창에서 지워진 경우
    const authoritative = ['4key', '5key', '6key', '8key'];
    vi.mocked(keysApi.tabs.swap).mockResolvedValueOnce({
      error: 'unknown-tab',
      result: {
        customTabs: [],
        tabOrder: authoritative,
        barCount: 4,
        selectedKeyType: '4key',
      },
    });

    startDrag('chip', { clientX: 20, clientY: 15 });
    drop({ clientX: 150, clientY: 15 });

    // 낙관 적용은 이미 들어가 있다
    expect(useKeyStore.getState().tabOrder).not.toEqual(authoritative);

    await act(async () => {});

    expect(useKeyStore.getState().tabOrder).toEqual(authoritative);
    expect(useKeyStore.getState().pendingTabPlacements).toBe(0);
  });

  it('응답이 끝나지 않아도 유예 상한에서 권위 순서 잠금을 푼다', () => {
    vi.mocked(keysApi.tabs.swap).mockImplementationOnce(
      () => new Promise(() => {}),
    );

    startDrag('chip', { clientX: 20, clientY: 15 });
    drop({ clientX: 150, clientY: 15 });

    expect(useKeyStore.getState().pendingTabPlacements).toBe(1);
    act(() => vi.advanceTimersByTime(9999));
    expect(useKeyStore.getState().pendingTabPlacements).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(useKeyStore.getState().pendingTabPlacements).toBe(0);
  });

  it('실패 응답은 더 최신 세대의 배치를 되돌리지 않는다', async () => {
    let rejectSwap: (error: Error) => void = () => {};
    vi.mocked(keysApi.tabs.swap).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSwap = reject;
        }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    startDrag('chip', { clientX: 20, clientY: 15 });
    drop({ clientX: 150, clientY: 15 });
    const authoritative = ['4key', '5key', '6key', '8key', CHIP_ID, OTHER_ID];
    useKeyStore.setState((state) => ({
      tabMetadataGeneration: state.tabMetadataGeneration + 1,
      tabOrder: authoritative,
    }));

    await act(async () => rejectSwap(new Error('transport')));

    expect(useKeyStore.getState().tabOrder).toEqual(authoritative);
    expect(useKeyStore.getState().pendingTabPlacements).toBe(0);
    error.mockRestore();
  });
});

describe('탭 드래그 세션 종료', () => {
  it('포인터를 누른 순간부터 팝업 드래그 후보를 표시한다', () => {
    const chip = container.querySelector('[data-testid="chip"]')!;

    act(() => {
      chip.dispatchEvent(pointerEvent('pointerdown', { button: 0 }));
    });
    expect(getPopupDragSessionState()).toBe('pending');

    act(() => {
      window.dispatchEvent(pointerEvent('pointerup'));
    });
    expect(getPopupDragSessionState()).toBe('idle');
  });

  it('임계값 전 버튼이 풀린 세션은 드래그로 승격하지 않는다', () => {
    const chip = container.querySelector('[data-testid="chip"]')!;
    act(() => {
      chip.dispatchEvent(pointerEvent('pointerdown', { button: 0 }));
      window.dispatchEvent(
        pointerEvent('pointermove', { clientX: 2, clientY: 2 }),
      );
      window.dispatchEvent(
        pointerEvent('pointermove', {
          buttons: 0,
          clientX: 20,
          clientY: 20,
        }),
      );
    });

    expect(ghosts()).toHaveLength(0);
    expect(getPopupDragSessionState()).toBe('idle');
  });

  it.each([
    ['창 포커스 상실', () => window.dispatchEvent(new Event('blur'))],
    [
      'Esc',
      () =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
    ],
    [
      '포인터 캡처 상실',
      () => window.dispatchEvent(pointerEvent('lostpointercapture')),
    ],
    [
      '눌림이 풀린 채 이동',
      () =>
        window.dispatchEvent(
          pointerEvent('pointermove', { buttons: 0, clientX: 60, clientY: 60 }),
        ),
    ],
  ])('%s에서 고스트와 전역 커서가 회수된다', (_label, end) => {
    startDrag();
    expect(ghosts()).toHaveLength(1);
    expect(document.body.classList.contains('dmn-dragging')).toBe(true);

    act(() => {
      end();
    });
    expect(document.body.classList.contains('dmn-dragging')).toBe(false);

    // 빗나간 고스트는 제자리로 돌아간 뒤 사라진다
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(ghosts()).toHaveLength(0);
  });

  it('두 번째 포인터가 앞 세션을 덮어써도 고스트가 남지 않는다', () => {
    startDrag();
    expect(ghosts()).toHaveLength(1);

    // 멀티터치에서 다른 손가락이 같은 칩을 누르는 경우
    const chip = container.querySelector('[data-testid="chip"]')!;
    act(() => {
      chip.dispatchEvent(
        pointerEvent('pointerdown', { button: 0, pointerId: 2 }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(ghosts()).toHaveLength(0);
  });

  it('capture 해제가 던져도 고스트를 회수한다', () => {
    const chip = startDrag();
    chip.releasePointerCapture = () => {
      throw new DOMException('pointer is not active', 'NotFoundError');
    };

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(ghosts()).toHaveLength(0);
    expect(document.body.classList.contains('dmn-dragging')).toBe(false);
  });

  it('reduced motion 빗나가기는 고스트를 즉시 회수한다', () => {
    bendMotion.release.mockReturnValue(false);
    startDrag();

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(ghosts()).toHaveLength(0);
    expect(document.querySelector('.dmn-tab-returning')).toBeNull();
  });

  it('드래그 중 외부 순서 변경 뒤 좌표를 다시 측정한다', () => {
    const other = container.querySelector<HTMLElement>(
      '[data-testid="chip-other"]',
    )!;
    startDrag('chip', { clientX: 20, clientY: 15 });
    const measureOther = vi.fn(() => rect(100, 0, 200, 30));
    other.getBoundingClientRect = measureOther;

    act(() => {
      useKeyStore.setState({
        tabOrder: [OTHER_ID, CHIP_ID, '4key', '5key', '6key', '8key'],
      });
    });
    act(() => {
      window.dispatchEvent(
        pointerEvent('pointermove', { clientX: 150, clientY: 15 }),
      );
    });

    expect(measureOther).toHaveBeenCalled();
  });

  it('언마운트가 진행 중인 고스트까지 회수한다', () => {
    startDrag();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    // 복귀 전이가 끝나기 전에 언마운트
    act(() => root.unmount());
    expect(ghosts()).toHaveLength(0);
    expect(document.body.classList.contains('dmn-dragging')).toBe(false);

    // afterEach의 두 번째 unmount를 막는다
    root = createRoot(document.createElement('div'));
  });
});
