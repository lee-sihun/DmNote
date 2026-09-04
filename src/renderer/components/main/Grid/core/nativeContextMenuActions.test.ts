import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeNativeContextMenuAction } from './nativeContextMenuActions';

const actionMocks = vi.hoisted(() => ({
  deleteElement: vi.fn(() => Promise.resolve()),
  commitLayer: vi.fn(() => Promise.resolve()),
  reportError: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  deleteElementById: actionMocks.deleteElement,
}));
vi.mock('@src/renderer/editor/runtime/layerZOrderIntent', () => ({
  commitStableLayerZOrder: actionMocks.commitLayer,
}));
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpError: actionMocks.reportError,
}));

describe('executeNativeContextMenuAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('삭제를 안정 ID로 실행한다', () => {
    const handled = executeNativeContextMenuAction({
      menuItemId: 'delete',
      type: 'stat',
      mode: '4key',
      elementId: 'stat-id',
      resolvedIndex: 2,
      onDuplicate: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(actionMocks.deleteElement).toHaveBeenCalledWith('stat', 'stat-id');
  });

  it('복제는 액션 시점에 재해석된 index만 전달한다', () => {
    const onDuplicate = vi.fn();
    executeNativeContextMenuAction({
      menuItemId: 'duplicate',
      type: 'graph',
      mode: '4key',
      elementId: 'graph-id',
      resolvedIndex: 3,
      onDuplicate,
    });
    executeNativeContextMenuAction({
      menuItemId: 'duplicate',
      type: 'graph',
      mode: '4key',
      elementId: 'graph-id',
      resolvedIndex: null,
      onDuplicate,
    });

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledWith(3);
  });

  it.each([
    ['bringToFront', 'front'],
    ['bringForward', 'forward'],
    ['sendBackward', 'backward'],
    ['sendToBack', 'back'],
  ] as const)('%s를 레이어 액션 %s로 변환한다', (menuItemId, action) => {
    executeNativeContextMenuAction({
      menuItemId,
      type: 'key',
      mode: '4key',
      elementId: 'key-id',
      resolvedIndex: 0,
      onDuplicate: vi.fn(),
    });

    expect(actionMocks.commitLayer).toHaveBeenCalledWith({
      mode: '4key',
      targets: [{ type: 'key', id: 'key-id' }],
      action,
    });
  });

  it('지원하지 않는 메뉴 항목은 소비하지 않는다', () => {
    expect(
      executeNativeContextMenuAction({
        menuItemId: 'plugin:item',
        type: 'key',
        mode: '4key',
        elementId: 'key-id',
        resolvedIndex: 0,
        onDuplicate: vi.fn(),
      }),
    ).toBe(false);
  });
});
