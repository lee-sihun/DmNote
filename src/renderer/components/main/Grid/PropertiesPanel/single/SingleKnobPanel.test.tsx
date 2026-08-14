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

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  patchKnobAxisIdById: mocks.patchAxis,
}));

vi.mock('@plugins/rpc/pluginElementActions', () => ({
  patchNativeLayerPropertyViaAuthority: mocks.patchAuthority,
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

  it('같은 대상이면 캡처 대기를 유지한다', () => {
    act(() => captureButton().click());

    render();

    expect(captureButton().textContent).toBe('propertiesPanel.knobCapturing');
  });

  it('panel stable capture는 authority만 호출한다', () => {
    window.__dmn_window_type = 'panel';
    act(() => captureButton().click());
    emitAxis('HIDA:panel');
    emitAxis('HIDA:panel');
    emitAxis('HIDA:panel');

    expect(mocks.patchAuthority).toHaveBeenCalledWith({
      elementType: 'knob',
      id: knobPosition.id,
      patch: { axisId: 'HIDA:panel' },
    });
    expect(mocks.patchAxis).not.toHaveBeenCalled();
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
