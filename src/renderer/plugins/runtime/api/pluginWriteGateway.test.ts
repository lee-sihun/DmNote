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
  pluginEditorCommit,
  pluginKeysUpdate,
  pluginKeysUpdateWithPositions,
  pluginPositionsUpdate,
} from './pluginWriteGateway';
import type { PluginEditorCommitRequest } from '@src/types/editor';
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

  // 자사 wire가 v2로 옮겨가도 raw plugin envelope는 재직렬화 없이
  // 선언된 버전 그대로 백엔드에 도달해야 한다
  it('forwards a raw editor commit envelope without reserialization', async () => {
    editorCommitRaw.mockReset();
    editorCommitRaw.mockResolvedValue({ revision: 2, changedFields: [] });
    const request = {
      baseRevision: 1,
      mutationId: '00000000-0000-4000-8000-000000000001',
      changes: { schemaVersion: 1, statPositions: {} },
    } as unknown as PluginEditorCommitRequest;

    await pluginEditorCommit(request);

    expect(editorCommitRaw).toHaveBeenCalledTimes(1);
    // 같은 참조가 무가공 전달된다 (버전 재작성 지점 자체가 없음)
    expect(editorCommitRaw.mock.calls[0][0]).toBe(request);
  });

  // commit wire v2는 자사 내부 전용 - 플러그인 경계는 v1만 통과해야 한다
  it('rejects a v2 envelope at the plugin boundary', async () => {
    editorCommitRaw.mockReset();
    const request = {
      baseRevision: 1,
      mutationId: '00000000-0000-4000-8000-000000000003',
      changes: { schemaVersion: 2, statPositions: {} },
    } as unknown as PluginEditorCommitRequest;

    await expect(pluginEditorCommit(request)).rejects.toThrow(TypeError);
    expect(editorCommitRaw).not.toHaveBeenCalled();
  });

  it('serializes keys-bearing raw commits but keeps the envelope untouched', async () => {
    editorCommitRaw.mockReset();
    editorCommitRaw.mockResolvedValue({ revision: 2, changedFields: [] });
    runSerializedPluginCommit.mockReset();
    runSerializedPluginCommit.mockImplementation(
      (run: () => Promise<unknown>) => run(),
    );
    const request = {
      baseRevision: 1,
      mutationId: '00000000-0000-4000-8000-000000000002',
      changes: { schemaVersion: 1, keys: { '4key': ['Z'] } },
    } as unknown as PluginEditorCommitRequest;

    await pluginEditorCommit(request);

    expect(runSerializedPluginCommit).toHaveBeenCalledTimes(1);
    expect(editorCommitRaw.mock.calls[0][0]).toBe(request);
  });

  it.each([
    ['keyPositions'],
    ['statPositions'],
    ['graphPositions'],
    ['knobPositions'],
  ] as const)(
    '%s 단독 쓰기는 격리 v1 커밋을 타고 canonical 필드를 돌려준다',
    async (field) => {
      const canonical = {
        keys: {},
        keyPositions: {},
        statPositions: {},
        graphPositions: {},
        knobPositions: {},
        [field]: { '4key': [{ id: 'adapter-issued', dx: 1 }] },
      };
      commitIsolatedPluginPatch.mockResolvedValue(canonical);

      const input = { '4key': [{ dx: 1 }] };
      const result = await pluginPositionsUpdate(field, input);

      expect(commitIsolatedPluginPatch).toHaveBeenCalledWith(
        { schemaVersion: 1, [field]: input },
        { multiKey: false },
      );
      // 입력 에코가 아니라 adapter가 발급한 ID를 포함한 canonical
      expect(result).toEqual({ '4key': [{ id: 'adapter-issued', dx: 1 }] });
    },
  );

  it('위치 쓰기 실패는 원 오류 그대로 reject된다', async () => {
    const original = { errorCode: 'VALIDATION_FAILED', message: 'bad' };
    commitIsolatedPluginPatch.mockRejectedValueOnce(original);

    await expect(
      pluginPositionsUpdate('keyPositions', { '4key': [] }),
    ).rejects.toBe(original);
  });
});
