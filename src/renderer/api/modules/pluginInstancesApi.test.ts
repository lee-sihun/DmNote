import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { pluginInstancesApi } from './pluginInstancesApi';

const request = {
  pluginId: 'demo',
  instances: [],
  mutationId: '00000000-0000-0000-0000-000000000001',
  authorityGeneration: 1,
};

describe('pluginInstancesApi commit provenance', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('직접 저장은 RPC 출처를 null로 전달한다', () => {
    void pluginInstancesApi.commit(request);

    expect(invoke).toHaveBeenCalledWith('plugin_instances_commit', {
      request,
      rpcRequestId: null,
    });
  });

  it('패널 RPC 저장은 원래 request ID를 전달한다', () => {
    void pluginInstancesApi.commit(
      request,
      '00000000-0000-0000-0000-000000000002',
    );

    expect(invoke).toHaveBeenCalledWith('plugin_instances_commit', {
      request,
      rpcRequestId: '00000000-0000-0000-0000-000000000002',
    });
  });
});
