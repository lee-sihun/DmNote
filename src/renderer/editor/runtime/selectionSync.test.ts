import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

interface FakeSelectionState {
  selectedElements: SelectedElement[];
  selectedGroupIds: string[];
  clearSelection: () => void;
}

type SelectionListener = (state: FakeSelectionState) => void;

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  get: vi.fn(),
  changedListener: null as null | ((snapshot: unknown) => void),
  selectionListeners: new Set<SelectionListener>(),
  selectionState: null as FakeSelectionState | null,
  selectedKeyType: '4key',
}));

const notifySelection = () => {
  const state = mocks.selectionState!;
  mocks.selectionListeners.forEach((listener) => listener(state));
};

const setSelection = (selectedElements: SelectedElement[]) => {
  mocks.selectionState = {
    ...mocks.selectionState!,
    selectedElements,
  };
  notifySelection();
};

vi.mock('@api/modules/selectionSessionApi', () => ({
  selectionSessionApi: {
    publish: mocks.publish,
    get: mocks.get,
    onChanged: (listener: (snapshot: unknown) => void) => {
      mocks.changedListener = listener;
      const unsubscribe = () => {};
      return Object.assign(unsubscribe, { ready: Promise.resolve() });
    },
  },
  toWireElements: (elements: SelectedElement[]) =>
    elements.map((element) => ({
      elementType: element.type,
      index: element.index ?? null,
      fullId: element.id,
    })),
  fromWireElements: (
    elements: Array<{
      elementType: SelectedElement['type'];
      index?: number | null;
      fullId?: string | null;
    }>,
  ) =>
    elements
      .filter((element) => element.fullId != null)
      .map((element) => ({
        type: element.elementType,
        id: element.fullId!,
        ...(element.index != null ? { index: element.index } : {}),
      })),
}));

vi.mock('@stores/grid/useGridSelectionStore', () => ({
  useGridSelectionStore: {
    getState: () => mocks.selectionState!,
    setState: (next: Partial<FakeSelectionState>) => {
      mocks.selectionState = { ...mocks.selectionState!, ...next };
      notifySelection();
    },
    subscribe: (listener: SelectionListener) => {
      mocks.selectionListeners.add(listener);
      return () => mocks.selectionListeners.delete(listener);
    },
  },
}));

vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: () => ({ selectedKeyType: mocks.selectedKeyType }),
  },
}));

const responseFor = (
  selectedElements: Array<{
    elementType: string;
    index?: number | null;
    fullId?: string | null;
  }>,
  selectionRevision: number,
) => ({
  selectedElements,
  selectedGroupIds: [],
  mode: mocks.selectedKeyType,
  selectionRevision,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('selection sync drain', () => {
  let selectionSync: typeof import('./selectionSync');

  beforeEach(async () => {
    vi.resetModules();
    mocks.publish.mockReset();
    mocks.get.mockReset().mockResolvedValue(responseFor([], 0));
    mocks.changedListener = null;
    mocks.selectionListeners.clear();
    mocks.selectedKeyType = '4key';
    mocks.selectionState = {
      selectedElements: [],
      selectedGroupIds: [],
      clearSelection: () => setSelection([]),
    };
    selectionSync = await import('./selectionSync');
  });

  it('예약된 publish의 ACK까지 기다린다', async () => {
    const pending = deferred<ReturnType<typeof responseFor>>();
    mocks.publish.mockReturnValueOnce(pending.promise);
    const stop = selectionSync.initSelectionSync();
    setSelection([{ type: 'key', id: 'key-0', index: 0 }]);

    let settled = false;
    const drain = selectionSync.flushSelectionSync().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    pending.resolve(
      responseFor([{ elementType: 'key', fullId: 'key-0', index: 0 }], 1),
    );
    await expect(drain).resolves.toBe(true);
    stop();
  });

  it('진행 중 선택 변경의 후속 publish까지 기다린다', async () => {
    const first = deferred<ReturnType<typeof responseFor>>();
    const second = deferred<ReturnType<typeof responseFor>>();
    mocks.publish
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const stop = selectionSync.initSelectionSync();

    setSelection([{ type: 'graph', id: 'graph-0', index: 0 }]);
    await Promise.resolve();
    expect(mocks.publish).toHaveBeenCalledTimes(1);

    setSelection([{ type: 'key', id: 'key-0', index: 0 }]);
    await Promise.resolve();
    const drain = selectionSync.flushSelectionSync();

    first.resolve(
      responseFor([{ elementType: 'graph', fullId: 'graph-0', index: 0 }], 1),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.publish).toHaveBeenCalledTimes(2);

    second.resolve(
      responseFor([{ elementType: 'key', fullId: 'key-0', index: 0 }], 2),
    );
    await expect(drain).resolves.toBe(true);
    expect(mocks.publish.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        selectedElements: [{ elementType: 'key', fullId: 'key-0', index: 0 }],
      }),
    );
    stop();
  });

  it('idle 상태의 미발행 선택을 한 번 publish한다', async () => {
    mocks.publish.mockResolvedValueOnce(responseFor([], 1));

    await expect(selectionSync.flushSelectionSync()).resolves.toBe(true);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('최신 선택 publish 실패를 false로 반환한다', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('publish failed'));

    await expect(selectionSync.flushSelectionSync()).resolves.toBe(false);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('실패 뒤 같은 선택의 다음 drain은 다시 publish한다', async () => {
    mocks.publish
      .mockRejectedValueOnce(new Error('publish failed'))
      .mockResolvedValueOnce(responseFor([], 1));

    await expect(selectionSync.flushSelectionSync()).resolves.toBe(false);
    await expect(selectionSync.flushSelectionSync()).resolves.toBe(true);
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });
});
