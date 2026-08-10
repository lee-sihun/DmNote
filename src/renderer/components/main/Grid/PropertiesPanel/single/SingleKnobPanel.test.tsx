import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SingleKnobPanel } from './SingleSelectionPanel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));

const knobPosition = {
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

  const render = (singleKnobIndex: number) => {
    act(() => {
      root.render(
        <SingleKnobPanel
          setPanelElement={vi.fn()}
          singleKnobPosition={knobPosition as never}
          singleKnobIndex={singleKnobIndex}
          selectedKeyType="4key"
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>() as never}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          handleKnobUpdate={vi.fn()}
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
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    render(0);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('대상이 바뀌면 축 캡처 대기를 끊는다', () => {
    act(() => captureButton().click());
    expect(captureButton().textContent).toBe('propertiesPanel.knobCapturing');

    render(1);

    expect(captureButton().textContent).not.toBe(
      'propertiesPanel.knobCapturing',
    );
  });

  it('같은 대상이면 캡처 대기를 유지한다', () => {
    act(() => captureButton().click());

    render(0);

    expect(captureButton().textContent).toBe('propertiesPanel.knobCapturing');
  });
});
