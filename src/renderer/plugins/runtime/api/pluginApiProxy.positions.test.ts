import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  pluginKeysUpdate: vi.fn(async () => ({})),
  pluginKeysUpdateWithPositions: vi.fn(async () => ({})),
  pluginEditorCommit: vi.fn(async () => ({})),
  pluginPositionsUpdate: vi.fn(async () => ({ '4key': [] })),
}));

vi.mock('./pluginWriteGateway', () => gateway);

import {
  createPluginApiProxy,
  createPluginWindowProxy,
} from './pluginApiProxy';
import type { DMNoteAPI } from '@src/types/plugin/api';

// 직접 호출용 raw API - 프록시가 4개 위치 API를 게이트웨이로 덮지 않으면
// 여기 스파이가 호출된다
const rawApi = {
  keys: { updatePositions: vi.fn(), update: vi.fn() },
  statItems: { updatePositions: vi.fn() },
  graphItems: { updatePositions: vi.fn() },
  knobItems: { updatePositions: vi.fn() },
  editor: { commit: vi.fn() },
  plugin: { storage: { get: vi.fn(), set: vi.fn() } },
} as unknown as DMNoteAPI;

const createProxy = () =>
  createPluginApiProxy({
    pluginId: 'test-plugin',
    sourceApi: rawApi,
    registerCleanup: () => {},
    isReloading: () => false,
    waitForReloadEnd: async () => {},
  });

describe('플러그인 프록시 위치 API 재라우팅', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['keys', 'keyPositions'],
    ['statItems', 'statPositions'],
    ['graphItems', 'graphPositions'],
    ['knobItems', 'knobPositions'],
  ] as const)(
    '%s.updatePositions는 격리 v1 게이트웨이를 탄다',
    async (namespace, field) => {
      const proxied = createProxy();

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

  it('공개 window.api와 window.dmn은 같은 플러그인 프록시를 반환한다', () => {
    const proxiedApi = createProxy();
    const proxyWindow = createPluginWindowProxy(proxiedApi);

    expect(proxyWindow.api).toBe(proxiedApi);
    expect((proxyWindow as unknown as { dmn: DMNoteAPI }).dmn).toBe(proxiedApi);
    expect('api' in proxyWindow).toBe(true);
    expect('dmn' in proxyWindow).toBe(true);
    expect(Object.getOwnPropertyDescriptor(proxyWindow, 'api')?.value).toBe(
      proxiedApi,
    );
    expect(Object.getOwnPropertyDescriptor(proxyWindow, 'dmn')?.value).toBe(
      proxiedApi,
    );
  });

  it.each(['api', 'dmn'] as const)(
    '플러그인이 proxy window.%s를 다시 정의해도 root는 바뀌지 않는다',
    (property) => {
      const proxiedApi = createProxy();
      const original = Object.getOwnPropertyDescriptor(window, property);
      const rootValue = { surface: 'host-read-only' };
      Object.defineProperty(window, property, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: rootValue,
      });

      try {
        const proxyWindow = createPluginWindowProxy(proxiedApi);
        expect(Reflect.set(proxyWindow, property, { bypass: true })).toBe(
          false,
        );
        expect(
          Reflect.defineProperty(proxyWindow, property, {
            configurable: true,
            value: { bypass: true },
          }),
        ).toBe(false);
        expect(Reflect.deleteProperty(proxyWindow, property)).toBe(false);

        expect(Reflect.get(window, property)).toBe(rootValue);
        expect(Reflect.get(proxyWindow, property)).toBe(proxiedApi);
        expect(
          Object.getOwnPropertyDescriptor(proxyWindow, property)?.value,
        ).toBe(proxiedApi);
      } finally {
        if (original) {
          Object.defineProperty(window, property, original);
        } else {
          Reflect.deleteProperty(window, property);
        }
      }
    },
  );
});
