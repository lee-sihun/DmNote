import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(
    (_event?: string, _listener?: (event: { payload: unknown }) => void) =>
      Promise.resolve(vi.fn()),
  ),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: runtime.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: runtime.listen,
}));

import {
  fromWireElements,
  selectionSessionApi,
  toWireElements,
} from './selectionSessionApi';

const KEY_ID = '00000000-0000-4000-8000-000000000001';

const validSnapshot = () =>
  ({
    selectedElements: [
      { elementType: 'key', fullId: KEY_ID },
      { elementType: 'plugin', fullId: 'plugin:element' },
    ],
    selectedGroupIds: ['group-1'],
    mode: '4key',
    selectionRevision: 1,
  } satisfies import('./selectionSessionApi').SelectionSessionSnapshot);

describe('selectionSessionApi canonical wire', () => {
  beforeEach(() => {
    runtime.invoke.mockReset();
    runtime.listen.mockReset();
    runtime.listen.mockResolvedValue(vi.fn());
  });

  it('get 응답을 정확한 ID 전용 구조로 수용한다', async () => {
    runtime.invoke.mockResolvedValueOnce(validSnapshot());

    await expect(selectionSessionApi.get()).resolves.toEqual(validSnapshot());
    expect(fromWireElements(validSnapshot().selectedElements)).toEqual([
      { type: 'key', id: KEY_ID },
      { type: 'plugin', id: 'plugin:element' },
    ]);
  });

  it.each([
    ['unknown snapshot field', { ...validSnapshot(), extra: true }],
    [
      'legacy index field',
      {
        ...validSnapshot(),
        selectedElements: [{ elementType: 'key', fullId: KEY_ID, index: null }],
      },
    ],
    [
      'missing fullId',
      { ...validSnapshot(), selectedElements: [{ elementType: 'key' }] },
    ],
    [
      'unknown type',
      {
        ...validSnapshot(),
        selectedElements: [{ elementType: 'other', fullId: KEY_ID }],
      },
    ],
    [
      'malformed native id',
      {
        ...validSnapshot(),
        selectedElements: [{ elementType: 'key', fullId: 'key-0' }],
      },
    ],
    [
      'nil native id',
      {
        ...validSnapshot(),
        selectedElements: [
          {
            elementType: 'key',
            fullId: '00000000-0000-0000-0000-000000000000',
          },
        ],
      },
    ],
    [
      'global duplicate id',
      {
        ...validSnapshot(),
        selectedElements: [
          { elementType: 'key', fullId: KEY_ID },
          { elementType: 'plugin', fullId: KEY_ID },
        ],
      },
    ],
    [
      'duplicate group id',
      { ...validSnapshot(), selectedGroupIds: ['group-1', 'group-1'] },
    ],
    [
      'element cap',
      {
        ...validSnapshot(),
        selectedElements: Array.from({ length: 4097 }, (_, index) => ({
          elementType: 'plugin',
          fullId: `plugin:${index}`,
        })),
      },
    ],
  ])('%s 응답을 내부 상태 적용 전에 거절한다', async (_name, value) => {
    runtime.invoke.mockResolvedValueOnce(value);
    await expect(selectionSessionApi.get()).rejects.toThrow();
  });

  it('publish는 locator index를 wire에 포함하지 않고 응답도 검증한다', async () => {
    runtime.invoke.mockResolvedValueOnce(validSnapshot());

    await selectionSessionApi.publish({
      selectedElements: toWireElements([
        { type: 'key', id: KEY_ID, index: 7 },
        { type: 'plugin', id: 'plugin:element' },
      ]),
      selectedGroupIds: ['group-1'],
      mode: '4key',
    });

    expect(runtime.invoke).toHaveBeenCalledWith('selection_session_publish', {
      snapshot: {
        selectedElements: validSnapshot().selectedElements,
        selectedGroupIds: ['group-1'],
        mode: '4key',
        selectionRevision: 0,
      },
    });
  });

  it('publish 응답도 get과 같은 exact parser로 거절한다', async () => {
    runtime.invoke.mockResolvedValueOnce({
      ...validSnapshot(),
      selectedElements: [{ elementType: 'key', fullId: KEY_ID, index: 0 }],
    });

    await expect(
      selectionSessionApi.publish({
        selectedElements: [{ elementType: 'key', fullId: KEY_ID }],
        selectedGroupIds: [],
        mode: '4key',
      }),
    ).rejects.toThrow();
  });

  it.each([
    [
      'group cap',
      { ...validSnapshot(), selectedGroupIds: Array(4097).fill('group') },
    ],
    ['mode UTF-8 byte cap', { ...validSnapshot(), mode: '가'.repeat(43) }],
    [
      'plugin ID byte cap',
      {
        ...validSnapshot(),
        selectedElements: [{ elementType: 'plugin', fullId: '가'.repeat(171) }],
      },
    ],
    [
      'group ID byte cap',
      { ...validSnapshot(), selectedGroupIds: ['가'.repeat(171)] },
    ],
    ['negative revision', { ...validSnapshot(), selectionRevision: -1 }],
    [
      'unsafe revision',
      { ...validSnapshot(), selectionRevision: Number.MAX_SAFE_INTEGER + 1 },
    ],
  ])('%s를 byte/safe-integer 계약으로 거절한다', async (_name, value) => {
    runtime.invoke.mockResolvedValueOnce(value);
    await expect(selectionSessionApi.get()).rejects.toThrow();
  });

  it('changed 이벤트도 get과 같은 exact parser를 통과한다', async () => {
    let eventListener: ((event: { payload: unknown }) => void) | undefined;
    runtime.listen.mockImplementationOnce(
      (_event: string, listener: (event: { payload: unknown }) => void) => {
        eventListener = listener;
        return Promise.resolve(vi.fn());
      },
    );
    const listener = vi.fn();
    const unsubscribe = selectionSessionApi.onChanged(listener);
    await unsubscribe.ready;

    expect(() =>
      eventListener?.({
        payload: {
          ...validSnapshot(),
          selectedElements: [{ elementType: 'key', fullId: KEY_ID, index: 0 }],
        },
      }),
    ).toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});
