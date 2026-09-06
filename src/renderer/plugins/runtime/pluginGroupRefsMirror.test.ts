import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentPluginGroupMembers } from '@src/renderer/editor/runtime/intent/pluginGroupMembers';

import { initPluginGroupRefsMirror } from './pluginGroupRefsMirror';

const { groupRefsGetMock, onChangedMock } = vi.hoisted(() => ({
  groupRefsGetMock: vi.fn(),
  onChangedMock: vi.fn(),
}));

vi.mock('@api/modules/plugin/pluginInstancesApi', () => ({
  pluginInstancesApi: {
    groupRefsGet: groupRefsGetMock,
    onChanged: onChangedMock,
  },
}));

const flushPulls = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('pluginGroupRefsMirror', () => {
  let changedListener: (() => void) | null = null;
  const unsubscribeMock = vi.fn();
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    groupRefsGetMock.mockReset();
    onChangedMock.mockReset();
    unsubscribeMock.mockClear();
    changedListener = null;
    onChangedMock.mockImplementation((listener: () => void) => {
      changedListener = listener;
      return unsubscribeMock;
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('초기화 시 1회 pull하고 미로드 플러그인 참조를 병합에 노출한다', async () => {
    groupRefsGetMock.mockResolvedValue({
      refs: { 'idle-plugin': { '4key': ['group-a'] } },
      modelRevision: 3,
    });

    dispose = initPluginGroupRefsMirror();
    await flushPulls();

    expect(groupRefsGetMock).toHaveBeenCalledTimes(1);
    expect(currentPluginGroupMembers()).toEqual([
      { tabId: '4key', groupId: 'group-a' },
    ]);
  });

  it('pluginInstances:changed 수신 시 재pull로 미러를 갱신한다', async () => {
    groupRefsGetMock.mockResolvedValueOnce({
      refs: { 'idle-plugin': { '4key': ['group-a'] } },
      modelRevision: 3,
    });
    dispose = initPluginGroupRefsMirror();
    await flushPulls();

    groupRefsGetMock.mockResolvedValueOnce({
      refs: { 'idle-plugin': { '6key': ['group-b'] } },
      modelRevision: 4,
    });
    changedListener?.();
    await flushPulls();

    expect(groupRefsGetMock).toHaveBeenCalledTimes(2);
    expect(currentPluginGroupMembers()).toEqual([
      { tabId: '6key', groupId: 'group-b' },
    ]);
  });

  it('늦게 도착한 낡은 revision의 pull은 무시한다', async () => {
    groupRefsGetMock.mockResolvedValueOnce({
      refs: { 'idle-plugin': { '4key': ['group-new'] } },
      modelRevision: 5,
    });
    dispose = initPluginGroupRefsMirror();
    await flushPulls();

    groupRefsGetMock.mockResolvedValueOnce({
      refs: { 'idle-plugin': { '4key': ['group-old'] } },
      modelRevision: 4,
    });
    changedListener?.();
    await flushPulls();

    expect(currentPluginGroupMembers()).toEqual([
      { tabId: '4key', groupId: 'group-new' },
    ]);
  });

  it('pull 실패는 기존 미러를 유지하고 예외를 밖으로 내지 않는다', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    groupRefsGetMock.mockResolvedValueOnce({
      refs: { 'idle-plugin': { '4key': ['group-a'] } },
      modelRevision: 3,
    });
    dispose = initPluginGroupRefsMirror();
    await flushPulls();

    groupRefsGetMock.mockRejectedValueOnce(new Error('backend gone'));
    changedListener?.();
    await flushPulls();

    expect(currentPluginGroupMembers()).toEqual([
      { tabId: '4key', groupId: 'group-a' },
    ]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('dispose 시 구독을 해제하고 병합 기여를 비운다', async () => {
    groupRefsGetMock.mockResolvedValue({
      refs: { 'idle-plugin': { '4key': ['group-a'] } },
      modelRevision: 3,
    });
    dispose = initPluginGroupRefsMirror();
    await flushPulls();

    dispose();
    dispose = null;

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(currentPluginGroupMembers()).toEqual([]);
  });
});
