// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  usePanelAnchoredPopupPosition,
  useTriggerAnchoredPopupPosition,
} from './usePanelAnchoredPopupPosition';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const wrappedUseState = ((initialState: unknown) => {
    const [state, setState] = actual.useState(initialState);
    const [, forceRender] = actual.useReducer((revision) => revision + 1, 0);

    return [
      state,
      (next: React.SetStateAction<unknown>) => {
        setState(next);
        forceRender();
      },
    ];
  }) as typeof actual.useState;

  return { ...actual, useState: wrappedUseState };
});

const createRect = (
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect =>
  ({
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  } as DOMRect);

describe('팝업 위치 상태 반복 갱신 방지', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1200 },
      innerHeight: { configurable: true, value: 800 },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('패널 기준 좌표가 같으면 레이아웃 이펙트에서 상태를 다시 쓰지 않는다', async () => {
    const panel = document.createElement('aside');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(
      createRect(900, 100, 250, 600),
    );
    document.body.appendChild(panel);

    const Harness = () => {
      const popupRef = React.useRef<HTMLDivElement>(null);
      const position = usePanelAnchoredPopupPosition({
        open: true,
        panelElement: panel,
        popupRef,
        fallbackWidth: 200,
        fallbackHeight: 100,
      });

      return (
        <div ref={popupRef} data-position={`${position?.x},${position?.y}`} />
      );
    };

    await act(async () => root.render(<Harness />));

    expect(host.firstElementChild?.getAttribute('data-position')).toBe(
      '695,350',
    );
    panel.remove();
  });

  it('트리거 기준 좌표가 같으면 레이아웃 이펙트에서 상태를 다시 쓰지 않는다', async () => {
    const section = document.createElement('section');
    section.dataset.dmnSection = 'true';
    const trigger = document.createElement('button');
    section.appendChild(trigger);
    document.body.appendChild(section);
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(
      createRect(800, 100, 300, 500),
    );
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      createRect(820, 240, 120, 40),
    );
    const referenceRef: React.RefObject<HTMLElement> = { current: trigger };

    const Harness = () => {
      const popupRef = React.useRef<HTMLDivElement>(null);
      const result = useTriggerAnchoredPopupPosition({
        open: true,
        referenceRef,
        popupRef,
        fallbackHeight: 160,
      });

      return (
        <div
          ref={popupRef}
          data-position={`${result.position?.x},${result.position?.y},${result.position?.width}`}
        />
      );
    };

    await act(async () => root.render(<Harness />));

    expect(host.firstElementChild?.getAttribute('data-position')).toBe(
      '800,285,300',
    );
    section.remove();
  });
});
