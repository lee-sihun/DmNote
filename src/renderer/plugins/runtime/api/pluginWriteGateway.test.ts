import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  commitIsolatedPluginPatch,
  runSerializedPluginCommit,
  editorCommitRaw,
} = vi.hoisted(() => ({
  commitIsolatedPluginPatch: vi.fn(),
  runSerializedPluginCommit: vi.fn(),
  editorCommitRaw: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitIsolatedPluginPatch, runSerializedPluginCommit },
}));
vi.mock('@api/modules/editorApi', () => ({ editorCommitRaw }));

import {
  pluginKeysUpdate,
  pluginKeysUpdateWithPositions,
} from './pluginWriteGateway';
import type { KeyMappings, KeyPositions } from '@src/types/key/keys';

describe('pluginWriteGateway', () => {
  beforeEach(() => {
    commitIsolatedPluginPatch.mockReset();
    commitIsolatedPluginPatch.mockResolvedValue({
      keys: {},
      keyPositions: {},
    });
  });

  it('rejects containers whose wire form is not an object map', async () => {
    // Date는 객체 검사를 통과해도 wire에서는 문자열 - transport 전에 거절
    await expect(
      pluginKeysUpdateWithPositions(
        new Date() as unknown as KeyMappings,
        {} as KeyPositions,
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      pluginKeysUpdate(null as unknown as KeyMappings),
    ).rejects.toThrow(TypeError);
    await expect(
      pluginKeysUpdate([] as unknown as KeyMappings),
    ).rejects.toThrow(TypeError);
    await expect(
      pluginKeysUpdate({ '4key': 'Z' } as unknown as KeyMappings),
    ).rejects.toThrow(TypeError);
    expect(commitIsolatedPluginPatch).not.toHaveBeenCalled();
  });

  it('normalizes slots like the backend before transport', async () => {
    await pluginKeysUpdate(
      {
        '4key': [
          'Z',
          // 중복 멤버 제거, 구분자 포함 멤버 탈락 후 2개 유지
          { keys: ['A', 'A', 'B', 'C+D'], match: 'any' },
          // 정제 후 1개 남으면 Single로 축약
          { keys: ['E', 'E'], match: 'all' },
        ],
      } as KeyMappings,
      { multiKey: true },
    );

    expect(commitIsolatedPluginPatch).toHaveBeenCalledWith(
      {
        schemaVersion: 1,
        keys: {
          '4key': ['Z', { keys: ['A', 'B'], match: 'any' }, 'E'],
        },
      },
      { multiKey: true },
    );
  });

  it('passes the declared multiKey value through without promotion', async () => {
    await pluginKeysUpdate({ '4key': ['Z'] });
    expect(commitIsolatedPluginPatch).toHaveBeenLastCalledWith(
      expect.anything(),
      { multiKey: false },
    );
  });
});
