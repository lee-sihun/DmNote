import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  pluginKeysUpdate: vi.fn(async () => ({})),
  pluginKeysUpdateWithPositions: vi.fn(async () => ({})),
  pluginEditorCommit: vi.fn(async () => ({})),
  pluginPositionsUpdate: vi.fn(async () => ({ '4key': [] })),
}));

vi.mock('./pluginWriteGateway', () => gateway);

import { createPluginApiProxy } from './pluginApiProxy';

// 직접 호출용 raw API - 프록시가 4개 위치 API를 게이트웨이로 덮지 않으면
// 여기 스파이가 호출된다
const rawApi = {
  keys: { updatePositions: vi.fn(), update: vi.fn() },
  statItems: { updatePositions: vi.fn() },
  graphItems: { updatePositions: vi.fn() },
  knobItems: { updatePositions: vi.fn() },
  editor: { commit: vi.fn() },
  plugin: { storage: { get: vi.fn(), set: vi.fn() } },
} as unknown as typeof window.api;

describe('플러그인 프록시 위치 API 재라우팅', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as { api?: typeof window.api }).api = rawApi;
  });

  it.each([
    ['keys', 'keyPositions'],
    ['statItems', 'statPositions'],
    ['graphItems', 'graphPositions'],
    ['knobItems', 'knobPositions'],
  ] as const)(
    '%s.updatePositions는 격리 v1 게이트웨이를 탄다',
    async (namespace, field) => {
      const proxied = createPluginApiProxy({
        pluginId: 'test-plugin',
        registerCleanup: () => {},
        isReloading: () => false,
        waitForReloadEnd: async () => {},
      });

      const positions = { '4key': [{ dx: 1 }] };
      await (
        proxied[namespace] as {
          updatePositions: (p: unknown) => Promise<unknown>;
        }
      ).updatePositions(positions);

      expect(gateway.pluginPositionsUpdate).toHaveBeenCalledWith(
        field,
        positions,
      );
      // raw API 직행 금지 - 자사 큐를 타면 wire v2가 되어 무ID 구 플러그인
      // 입력이 거절된다
      const raw = rawApi[namespace] as unknown as {
        updatePositions: ReturnType<typeof vi.fn>;
      };
      expect(raw.updatePositions).not.toHaveBeenCalled();
    },
  );
});
