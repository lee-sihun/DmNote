import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SingleKnobPanel } from './SingleSelectionPanel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  axisListener: null as null | ((event: { axisId: string }) => void),
  patchAxis: vi.fn(() => Promise.resolve(true)),
  patchAuthority: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/core/axisEventBus', () => ({
  axisEventBus: {
    initialize: vi.fn(),
    subscribe: (listener: (event: { axisId: string }) => void) => {
      mocks.axisListener = listener;
      return () => {
        if (mocks.axisListener === listener) mocks.axisListener = null;
      };
    },
  },
}));

vi.mock('@src/renderer/editor/runtime/operations/elementOps', () => ({
  patchKnobAxisIdById: mocks.patchAxis,
  patchElementPropertyViaAuthority: mocks.patchAuthority,
}));

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));

const knobPosition = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  dx: 0,
  dy: 0,
  width: 60,
  height: 60,
  axisId: 'HIDA:test',
  sensitivity: 1,
  reverse: false,
};

// 이 패널은 피커와 축 캡처 세션을 편집 트리 경계 위에서 소유한다.
// 경계 리마운트로는 안 걷히므로 대상 전환에 직접 반응해야 한다
describe('SingleKnobPanel 대상 전환 세션 정리', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (position = knobPosition, selectedKeyType = '4key') => {
    act(() => {
      root.render(
        <SingleKnobPanel
          setPanelElement={vi.fn()}
          singleKnobPosition={position as never}
          selectedKeyType={selectedKeyType}
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>() as never}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          singleScrollRefFor={() => vi.fn()}
          panelElement={null}
          useCustomCSS={false}
          t={((key: string) => key) as never}
        />,
      );
    });
  };

  // 축 캡처 토글은 title에 축 ID를 달고 있다
  const captureButton = () =>
    container.querySelector<HTMLButtonElement>(
      `button[title="${knobPosition.axisId}"]`,
    )!;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.axisListener = null;
    window.__dmn_window_type = 'main';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.__dmn_window_type;
  });

  const emitAxis = (axisId: string) => {
    act(() => {
      mocks.axisListener?.({ axisId });
    });
  };

  it('stable capture는 selection과 index가 바뀌어도 시작 ID에 완료한다', () => {
    act(() => captureButton().click());
    render({
      ...knobPosition,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    emitAxis('  HIDA:raw  ');
    emitAxis('  HIDA:raw  ');
    emitAxis('  HIDA:raw  ');

    expect(mocks.patchAxis).toHaveBeenCalledWith(
      knobPosition.id,
      '  HIDA:raw  ',
    );
  });

  it('stable capture 대상이 삭제되면 미적용 결과로 조용히 종료한다', () => {
    mocks.patchAxis.mockResolvedValueOnce(false);
    act(() => captureButton().click());
    emitAxis('HIDA:deleted');
    emitAxis('HIDA:deleted');
    emitAxis('HIDA:deleted');

    expect(mocks.patchAxis).toHaveBeenCalledWith(
      knobPosition.id,
      'HIDA:deleted',
    );
    expect(captureButton().textContent).not.toBe(
      'propertiesPanel.knobCapturing',
    );
  });

  it('stable capture는 mode가 바뀌어도 시작 ID에 완료한다', () => {
    act(() => captureButton().click());
    render(knobPosition, '7key');
    emitAxis('HIDA:mode');
    emitAxis('HIDA:mode');
    emitAxis('HIDA:mode');

    expect(mocks.patchAxis).toHaveBeenCalledWith(knobPosition.id, 'HIDA:mode');
  });

  it('다른 노브로 바뀌면 그 행에 감지 중을 표시하지 않는다', () => {
    act(() => captureButton().click());
    expect(captureButton().textContent).toBe('propertiesPanel.knobCapturing');

    render({
      ...knobPosition,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });

    // 쓰기는 동결된 시작 ID로 가므로, 새 노브 행에 감지 중이 뜨면 사용자는
    // 이 노브가 대기 중이라 읽고 돌렸다가 옛 노브에 축이 바인딩된다
    expect(captureButton().textContent).not.toBe(
      'propertiesPanel.knobCapturing',
    );
  });

  it('다른 노브의 잔여 대기는 첫 클릭이 취소가 아니라 대상 이전이다', () => {
    act(() => captureButton().click());
    render({
      ...knobPosition,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });

    act(() => captureButton().click());

    expect(captureButton().textContent).toBe('propertiesPanel.knobCapturing');
    emitAxis('HIDA:moved');
    emitAxis('HIDA:moved');
    emitAxis('HIDA:moved');
    expect(mocks.patchAxis).toHaveBeenCalledWith(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'HIDA:moved',
    );
  });

  it('같은 대상이면 캡처 대기를 유지한다', () => {
    act(() => captureButton().click());

    render();

    expect(captureButton().textContent).toBe('propertiesPanel.knobCapturing');
  });

  it('synthetic capture는 시작하지 않고 어떤 writer도 호출하지 않는다', () => {
    render({ ...knobPosition, id: 'knob-4' });
    act(() => captureButton().click());
    emitAxis('HIDA:legacy');
    emitAxis('HIDA:legacy');
    emitAxis('HIDA:legacy');

    expect(mocks.patchAxis).not.toHaveBeenCalled();
    expect(mocks.patchAuthority).not.toHaveBeenCalled();
  });
});

describe('SingleKnobPanel 이름 변경 헤더 계약', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (
    renameProps: Partial<
      Pick<
        React.ComponentProps<typeof SingleKnobPanel>,
        | 'isRenaming'
        | 'renameInputRef'
        | 'renameValue'
        | 'setRenameValue'
        | 'renameCancelledRef'
        | 'handleRenameCommit'
        | 'handleRenameCancel'
        | 'handleRenameStart'
        | 't'
      >
    > = {},
  ) => {
    act(() => {
      root.render(
        <SingleKnobPanel
          setPanelElement={vi.fn()}
          singleKnobPosition={
            { ...knobPosition, layerName: 'Named knob' } as never
          }
          selectedKeyType="4key"
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>() as never}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          singleScrollRefFor={() => vi.fn()}
          panelElement={null}
          useCustomCSS={false}
          t={((key: string) => key) as never}
          {...renameProps}
        />,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.__dmn_window_type = 'main';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.__dmn_window_type;
  });

  it('제목 DOM과 더블클릭·버튼 시작 계약을 유지한다', () => {
    const handleRenameStart = vi.fn();
    render({ handleRenameStart });

    const title = container.querySelector<HTMLSpanElement>(
      'span[title="Named knob"]',
    )!;
    const button = container.querySelector<HTMLButtonElement>(
      'button[title="contextMenu.rename"]',
    )!;

    expect(title.textContent).toBe('Named knob');
    expect(title.className).toBe(
      'text-fg text-label truncate max-w-[100px] cursor-default',
    );
    expect(button.className).toBe(
      'w-[18px] h-[18px] flex items-center justify-center text-fg-faint hover:text-fg transition-colors flex-shrink-0',
    );
    act(() =>
      title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
    act(() => button.click());
    expect(handleRenameStart).toHaveBeenCalledTimes(2);
    expect(handleRenameStart.mock.calls[0]?.[0]).toMatchObject({
      type: 'dblclick',
    });
    expect(handleRenameStart.mock.calls[1]?.[0]).toMatchObject({
      type: 'click',
    });
  });

  it('이름 편집 중에는 rename 번역을 평가하지 않는다', () => {
    const t = vi.fn((key: string) => key);
    render({ isRenaming: true, t: t as never });
    expect(t).not.toHaveBeenCalledWith('contextMenu.rename');

    t.mockClear();
    render({ isRenaming: false, t: t as never });
    expect(t).toHaveBeenCalledWith('contextMenu.rename');
  });

  it('Enter는 blur 뒤 현재 값을 커밋하고 cancel ref를 초기화한다', () => {
    const order: string[] = [];
    const renameCancelledRef = { current: false };
    const handleRenameCommit = vi.fn((value: string) => {
      order.push(`commit:${value}`);
    });
    render({
      isRenaming: true,
      renameValue: 'Draft name',
      renameCancelledRef,
      handleRenameCommit,
    });
    const input = container.querySelector('input')!;
    input.focus();
    const nativeBlur = input.blur.bind(input);
    vi.spyOn(input, 'blur').mockImplementation(() => {
      order.push('blur');
      nativeBlur();
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(order).toEqual(['blur', 'commit:Draft name']);
    expect(renameCancelledRef.current).toBe(false);
  });

  it('Escape는 기본 동작만 막고 취소하며 blur cancel은 커밋 없이 ref를 초기화한다', () => {
    const renameCancelledRef = { current: true };
    const handleRenameCommit = vi.fn();
    const handleRenameCancel = vi.fn();
    render({
      isRenaming: true,
      renameValue: 'Cancelled name',
      renameCancelledRef,
      handleRenameCommit,
      handleRenameCancel,
    });
    const input = container.querySelector('input')!;
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(handleRenameCancel).toHaveBeenCalledTimes(1);
    expect(handleRenameCommit).not.toHaveBeenCalled();
    act(() => input.blur());
    expect(handleRenameCommit).not.toHaveBeenCalled();
    expect(renameCancelledRef.current).toBe(false);
  });
});
