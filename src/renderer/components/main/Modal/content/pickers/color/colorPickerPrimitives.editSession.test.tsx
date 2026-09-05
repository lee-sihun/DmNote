// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { EditSessionScope } from '@src/renderer/contexts/EditSessionScope';

import { usePointerSession } from './colorPickerPrimitives';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const selectKey = (index: number) => {
  useGridSelectionStore.setState({
    selectedElements: [{ type: 'key', id: `key-${index}`, index }],
  });
};

describe('usePointerSession 언마운트 커밋', () => {
  let container: HTMLDivElement;
  let root: Root;
  let emit: Mock<(ratioX: number, ratioY: number, final: boolean) => void>;

  const Track = () => {
    const session = usePointerSession(emit);
    return <div data-testid="track" {...session} style={{ width: 100 }} />;
  };

  const startDrag = () => {
    const track = container.querySelector<HTMLDivElement>(
      '[data-testid="track"]',
    )!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 100,
      top: 0,
      bottom: 12,
      width: 100,
      height: 12,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    // jsdom에는 포인터 캡처 API가 없다
    track.setPointerCapture = vi.fn();
    track.hasPointerCapture = vi.fn(() => false);
    track.releasePointerCapture = vi.fn();

    act(() => {
      track.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          pointerId: 1,
          isPrimary: true,
          clientX: 50,
          clientY: 6,
        }),
      );
    });
  };

  const mount = (scoped: boolean) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        scoped ? (
          <EditSessionScope>
            <Track />
          </EditSessionScope>
        ) : (
          <Track />
        ),
      ),
    );
  };

  beforeEach(() => {
    emit = vi.fn();
    useKeyStore.setState({ selectedKeyType: '4key' });
    selectKey(0);
    mount(true);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('대상이 그대로면 언마운트에서 마지막 값을 확정한다', () => {
    startDrag();
    emit.mockClear();

    act(() => root.unmount());

    expect(emit).toHaveBeenCalledWith(0.5, 0.5, true);
  });

  it('편집 대상이 갈린 뒤 사라지면 확정하지 않는다', () => {
    startDrag();
    emit.mockClear();

    act(() => selectKey(1));
    act(() => root.unmount());

    expect(emit).not.toHaveBeenCalled();
  });

  it('드래그 중이 아니면 언마운트가 아무것도 내보내지 않는다', () => {
    act(() => root.unmount());

    expect(emit).not.toHaveBeenCalled();
  });

  // 같은 피커 컴포넌트가 전역 플러그인 설정에서도 쓰인다.
  // 거기까지 억제하면 무관한 캠버스 선택 변경이 멀쩡한 색 편집을 지운다
  it('캠버스 대상에 묶이지 않은 피커는 선택이 바뀌어도 확정한다', () => {
    act(() => root.unmount());
    container.remove();
    mount(false);
    startDrag();
    emit.mockClear();

    act(() => selectKey(1));
    act(() => root.unmount());

    expect(emit).toHaveBeenCalledWith(0.5, 0.5, true);
  });
});
