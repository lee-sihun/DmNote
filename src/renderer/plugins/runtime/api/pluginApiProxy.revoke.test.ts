/**
 * 플러그인 프록시 쓰기 게이트 - 회수된 세대의 핸들은 문서를 쓰지 못한다
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  pluginKeysUpdate: vi.fn(async () => ({})),
  pluginKeysUpdateWithPositions: vi.fn(async () => ({})),
  pluginEditorCommit: vi.fn(async () => ({})),
  pluginPositionsUpdate: vi.fn(async () => ({ '4key': [] })),
}));

vi.mock('./pluginWriteGateway', () => gateway);

import { createPluginApiProxy } from './pluginApiProxy';
import type { DMNoteAPI } from '@src/types/plugin/api';

const rawApi = {
  keys: { updatePositions: vi.fn(), update: vi.fn() },
  statItems: { updatePositions: vi.fn() },
  graphItems: { updatePositions: vi.fn() },
  knobItems: { updatePositions: vi.fn() },
  editor: { commit: vi.fn() },
  plugin: { storage: { get: vi.fn(), set: vi.fn() } },
} as unknown as DMNoteAPI;

const createProxy = (isRevoked: () => boolean) =>
  createPluginApiProxy({
    pluginId: 'test-plugin',
    sourceApi: rawApi,
    registerCleanup: () => {},
    isReloading: () => false,
    waitForReloadEnd: async () => {},
    isRevoked,
  });

describe('플러그인 프록시 쓰기 게이트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('활성 세대의 쓰기는 게이트웨이로 간다', async () => {
    const proxy = createProxy(() => false);

    await proxy.keys.update({} as never);
    await proxy.editor.commit({} as never);

    expect(gateway.pluginKeysUpdate).toHaveBeenCalledTimes(1);
    expect(gateway.pluginEditorCommit).toHaveBeenCalledTimes(1);
  });

  it('회수된 세대의 쓰기는 전부 거절되고 게이트웨이에 닿지 않는다', async () => {
    let revoked = false;
    const proxy = createProxy(() => revoked);
    revoked = true;

    await expect(proxy.keys.update({} as never)).rejects.toThrow(
      /no longer active/,
    );
    await expect(
      proxy.keys.updateWithPositions({} as never, {} as never),
    ).rejects.toThrow(/no longer active/);
    await expect(proxy.keys.updatePositions({} as never)).rejects.toThrow();
    await expect(
      proxy.statItems.updatePositions({} as never),
    ).rejects.toThrow();
    await expect(
      proxy.graphItems.updatePositions({} as never),
    ).rejects.toThrow();
    await expect(
      proxy.knobItems.updatePositions({} as never),
    ).rejects.toThrow();
    await expect(proxy.editor.commit({} as never)).rejects.toThrow();

    expect(gateway.pluginKeysUpdate).not.toHaveBeenCalled();
    expect(gateway.pluginKeysUpdateWithPositions).not.toHaveBeenCalled();
    expect(gateway.pluginPositionsUpdate).not.toHaveBeenCalled();
    expect(gateway.pluginEditorCommit).not.toHaveBeenCalled();
  });

  it('defineElement·defineSettings는 컨텍스트 래핑돼 비동기 호출에도 id가 선다', () => {
    const proxy = createProxy(() => false);
    const flagged = (fn: unknown) =>
      (fn as { __dmn_plugin_wrapped__?: boolean }).__dmn_plugin_wrapped__;

    expect(flagged(proxy.plugin.defineElement)).toBe(true);
    expect(flagged(proxy.plugin.defineSettings)).toBe(true);
  });
});
