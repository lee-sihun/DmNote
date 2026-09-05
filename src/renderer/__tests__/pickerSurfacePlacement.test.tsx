// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PickerSurface from '@components/main/Grid/PropertiesPanel/controls/PickerSurface';
import { PanelHostContext } from '@contexts/PanelHostContext';
import { getTriggerAnchoredPopupPosition } from '@hooks/ui/usePanelAnchoredPopupPosition';

interface CapturedPopupProps {
  open: boolean;
  placement: string;
  offset: number;
  offsetY: number;
  fixedX?: number;
  fixedY?: number;
  animate: boolean;
}

const ANCHORED = { settled: true, position: { x: 8, y: 120, width: 224 } };

const captured = vi.hoisted(() => ({
  popupProps: null as CapturedPopupProps | null,
  triggerResult: {
    settled: true,
    position: { x: 8, y: 120, width: 224 } as {
      x: number;
      y: number;
      width: number;
    } | null,
  },
}));

vi.mock('@components/main/Modal/floatingPopup/FloatingPopup', () => ({
  default: (props: CapturedPopupProps & { children: React.ReactNode }) => {
    captured.popupProps = props;
    return props.open ? (
      <div data-testid="floating-popup">{props.children}</div>
    ) : null;
  },
}));

// 좌표는 실측 기반이라 jsdom에서 계산되지 않음 —
// 어느 배치 규칙을 쓰는지와 그 결과가 어떻게 흐르는지만 본다
vi.mock('@hooks/ui/usePanelAnchoredPopupPosition', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@hooks/ui/usePanelAnchoredPopupPosition')
  >();
  return {
    ...actual,
    usePanelAnchoredPopupPosition: ({ open }: { open: boolean }) =>
      open ? { x: 11, y: 22 } : null,
    useTriggerAnchoredPopupPosition: ({ open }: { open: boolean }) =>
      open ? captured.triggerResult : { settled: false, position: null },
  };
});

// 분리 상태는 패널 호스트 컨텍스트가 알려준다 (자식 창 문서에 붙어 있음)
const Harness = ({ detached = false }: { detached?: boolean }) => {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  return (
    <PanelHostContext.Provider
      value={{
        placement: detached ? 'detached' : 'docked',
        window,
        document,
      }}
    >
      <div>
        <button ref={triggerRef} data-testid="trigger" />
        <PickerSurface
          open
          ariaLabel="색상"
          referenceRef={triggerRef}
          panelElement={document.body}
          fallbackWidth={168}
          fallbackHeight={300}
          cardClassName="w-[168px]"
          placement="right-start"
          offsetY={-80}
          onClose={vi.fn()}
        >
          <div data-testid="body" />
        </PickerSurface>
      </div>
    </PanelHostContext.Provider>
  );
};

const card = () =>
  document.querySelector<HTMLElement>('[data-testid="body"]')?.parentElement;

describe('분리 창 피커 배치', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    captured.popupProps = null;
    captured.triggerResult = { ...ANCHORED };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('분리 창에서는 섹션 정렬 좌표와 폭을 따른다', () => {
    act(() => {
      root.render(<Harness detached />);
    });

    expect(captured.popupProps?.fixedX).toBe(8);
    expect(captured.popupProps?.fixedY).toBe(120);
    expect(captured.popupProps?.offsetY).toBe(0);
    // 카드 고정 폭 대신 섹션 폭
    expect(card()?.style.width).toBe('224px');
    expect(card()?.style.visibility).toBe('');
  });

  it('섹션 앵커가 없으면 감추지 않고 기본 배치로 넘긴다', () => {
    captured.triggerResult = { settled: true, position: null };

    act(() => {
      root.render(<Harness detached />);
    });

    // 좌표를 못 잡았다고 팝업이 사라지면 안 됨
    expect(card()?.style.visibility).toBe('');
    expect(captured.popupProps?.placement).toBe('bottom-end');
    expect(captured.popupProps?.fixedX).toBeUndefined();
  });

  it('앵커 탐색이 끝나기 전에는 감춘다', () => {
    captured.triggerResult = { settled: false, position: null };

    act(() => {
      root.render(<Harness detached />);
    });

    expect(card()?.style.visibility).toBe('hidden');
  });

  it('메인 창에서는 기존 패널 왼쪽 도킹을 유지한다', () => {
    act(() => {
      root.render(<Harness />);
    });

    expect(captured.popupProps?.placement).toBe('right-start');
    expect(captured.popupProps?.fixedX).toBe(11);
    expect(captured.popupProps?.fixedY).toBe(22);
    expect(captured.popupProps?.offset).toBe(32);
    // 폭은 카드 클래스가 소유
    expect(card()?.style.width).toBe('');
  });
});

describe('트리거 앵커 좌표 계산', () => {
  const base = {
    sectionRect: { left: 8, width: 224 },
    triggerRect: { top: 100, bottom: 132 },
    viewportWidth: 240,
    viewportHeight: 470,
  };

  it('섹션 좌측·폭에 맞추고 트리거 행 아래에 놓는다', () => {
    expect(
      getTriggerAnchoredPopupPosition({ ...base, popupHeight: 200 }),
    ).toEqual({ x: 8, y: 137, width: 224 });
  });

  it('아래 공간이 모자라면 행 위로 뒤집는다', () => {
    expect(
      getTriggerAnchoredPopupPosition({
        ...base,
        triggerRect: { top: 400, bottom: 432 },
        popupHeight: 200,
      }),
    ).toEqual({ x: 8, y: 195, width: 224 });
  });

  it('위아래 모두 모자라면 화면 안으로 클램프한다', () => {
    expect(
      getTriggerAnchoredPopupPosition({
        ...base,
        triggerRect: { top: 40, bottom: 72 },
        popupHeight: 440,
      }),
    ).toEqual({ x: 8, y: 25, width: 224 });
  });

  it('섹션이 창보다 넓으면 창 안으로 줄인다', () => {
    expect(
      getTriggerAnchoredPopupPosition({
        ...base,
        sectionRect: { left: 0, width: 400 },
        popupHeight: 100,
      }),
    ).toEqual({ x: 5, y: 137, width: 230 });
  });
});
