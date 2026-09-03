import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

const { commitPatch, commitGeneratedPatch } = vi.hoisted(() => ({
  commitPatch: vi.fn(),
  commitGeneratedPatch: vi.fn(),
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitPatch, commitGeneratedPatch },
}));

import { keysApi, updatePositionsWithGesture } from './keysApi';
import {
  graphItemsApi,
  knobItemsApi,
  layerGroupsApi,
  spriteItemsApi,
  statItemsApi,
} from './itemsApi';

import type {
  CanonicalEditorDocumentV1,
  CanonicalReactiveSpritePosition,
  EditorDocumentV1,
  EditorPatchV1,
} from '@src/types/editor';
import type { KeyPositions } from '@src/types/key/keys';

const document: EditorDocumentV1 = {
  schemaVersion: 1,
  keys: { '4key': ['A'] },
  keyPositions: { '4key': [createDefaultKeyPosition()] },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  spritePositions: {},
  layerGroups: { '4key': [{ id: 'group-1', name: 'Group 1' }] },
};

// 백엔드 실물 wire 형태: layerName·groupId는 None이면 직렬화에서 생략된다
const spriteFixture = (id: string): CanonicalReactiveSpritePosition => ({
  activation: 'whileHeld',
  pressDurationMs: 300,
  id,
  dx: 0,
  dy: 0,
  width: 200,
  height: 150,
  hidden: false,
  zIndex: null,
  className: null,
  useInlineStyles: null,
  baseImage: null,
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [],
  transitionMs: 90,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  referenceNaturalSize: null,
});

describe('editor API compatibility adapters', () => {
  beforeEach(() => {
    commitPatch.mockReset();
    commitPatch.mockResolvedValue(structuredClone(document));
    commitGeneratedPatch.mockReset();
    commitGeneratedPatch.mockResolvedValue(structuredClone(document));
  });

  it('routes key writers through editor_commit and preserves return shapes', async () => {
    const mappings = { '4key': ['A'] };
    // 입력 echo와 canonical fixture가 값 비교되므로 id까지 같은 사본을 쓴다
    const positions = structuredClone(document.keyPositions) as KeyPositions;

    await expect(keysApi.update(mappings)).resolves.toEqual(document.keys);
    await expect(keysApi.updatePositions(positions)).resolves.toEqual(
      document.keyPositions,
    );
    await expect(
      keysApi.updateWithPositions(mappings, positions),
    ).resolves.toEqual({
      keys: document.keys,
      positions: document.keyPositions,
    });

    expect(commitPatch.mock.calls).toEqual([
      [{ schemaVersion: 1, keys: mappings }],
      [{ schemaVersion: 1, keyPositions: positions }, undefined],
      [
        {
          schemaVersion: 1,
          keys: mappings,
          keyPositions: positions,
        },
        undefined,
      ],
    ]);

    commitPatch.mockClear();
    commitPatch.mockResolvedValue(structuredClone(document));
    await updatePositionsWithGesture(
      positions,
      '6f9c2f6a-0b1d-4e5f-8a3c-2d7e9b4c1a50',
    );
    expect(commitPatch).toHaveBeenCalledWith(
      { schemaVersion: 1, keyPositions: positions },
      { gestureId: '6f9c2f6a-0b1d-4e5f-8a3c-2d7e9b4c1a50' },
    );
  });

  it('routes every item collection writer and returns its canonical field', async () => {
    await expect(statItemsApi.updatePositions({})).resolves.toEqual({});
    await expect(graphItemsApi.updatePositions({})).resolves.toEqual({});
    await expect(knobItemsApi.updatePositions({})).resolves.toEqual({});
    await expect(layerGroupsApi.update(document.layerGroups)).resolves.toEqual(
      document.layerGroups,
    );

    expect(commitPatch.mock.calls).toEqual([
      [{ schemaVersion: 1, statPositions: {} }],
      [{ schemaVersion: 1, graphPositions: {} }],
      [{ schemaVersion: 1, knobPositions: {} }],
      [{ schemaVersion: 1, layerGroups: document.layerGroups }],
    ]);
  });

  it('sprite patchPosition은 슬롯 안 최신 base에서 대상만 패치해 생성한다', async () => {
    const spriteA = spriteFixture('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const spriteB = spriteFixture('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    const base = {
      ...structuredClone(document),
      spritePositions: { '4key': [spriteA, spriteB] },
    } as CanonicalEditorDocumentV1;
    const generated: Array<EditorPatchV1 | null> = [];
    commitGeneratedPatch.mockImplementation(
      async (generate: (base: CanonicalEditorDocumentV1) => unknown) => {
        generated.push(generate(base) as EditorPatchV1 | null);
        return structuredClone(document);
      },
    );

    // patch가 명시 null layerName·groupId를 실어 와도 wire 형태로 정규화
    await expect(
      spriteItemsApi.patchPosition('4key', spriteA.id, {
        baseImage: 'hand.png',
        layerName: null,
        groupId: null,
      }),
    ).resolves.toBe('committed');

    expect(commitGeneratedPatch).toHaveBeenCalledWith(
      expect.any(Function),
      undefined,
    );
    // 최신 base 기준으로 대상 필드만 갱신, 같은 모드 이웃은 그대로
    expect(generated[0]).toEqual({
      schemaVersion: 1,
      spritePositions: {
        '4key': [{ ...spriteA, baseImage: 'hand.png' }, spriteB],
      },
    });
    const patched = (generated[0] as EditorPatchV1).spritePositions?.[
      '4key'
    ]?.[0] as CanonicalReactiveSpritePosition;
    expect('layerName' in patched).toBe(false);
    expect('groupId' in patched).toBe(false);
  });

  it('sprite patchPosition은 대상 소실이면 무커밋 targetMissing이다', async () => {
    const emptyBase = structuredClone(document) as CanonicalEditorDocumentV1;
    const generated: Array<EditorPatchV1 | null> = [];
    commitGeneratedPatch.mockImplementation(
      async (generate: (base: CanonicalEditorDocumentV1) => unknown) => {
        generated.push(generate(emptyBase) as EditorPatchV1 | null);
        return structuredClone(document);
      },
    );

    await expect(
      spriteItemsApi.patchPosition(
        '4key',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        { baseImage: 'hand.png' },
      ),
    ).resolves.toBe('targetMissing');
    expect(generated[0]).toBeNull();
  });

  it('sprite patchPosition은 대기 뒤 최신 대상에서 의도 patch를 다시 계산한다', async () => {
    const sprite = {
      ...spriteFixture('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      poses: [
        {
          poseId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          triggers: ['ffffffff-ffff-4fff-8fff-ffffffffffff'],
          transform: { x: 42, y: 7, rotation: 0, scale: 1 },
          imageOverride: null,
          imageOverrideMetrics: null,
          pivot: { x: 0.4, y: 0.6 },
        },
      ],
    };
    const base = {
      ...structuredClone(document),
      spritePositions: { '4key': [sprite] },
    } as CanonicalEditorDocumentV1;
    let generated: EditorPatchV1 | null = null;
    commitGeneratedPatch.mockImplementation(
      async (generate: (base: CanonicalEditorDocumentV1) => unknown) => {
        generated = generate(base) as EditorPatchV1 | null;
        return structuredClone(document);
      },
    );

    const stalePoses = structuredClone(sprite.poses);
    stalePoses[0].transform.x = -100;
    await spriteItemsApi.patchPosition(
      '4key',
      sprite.id,
      { poses: stalePoses },
      undefined,
      (current) => ({
        pivot: { x: 0.25, y: 0.75 },
        poses: current.poses,
      }),
    );

    const patched = generated?.spritePositions?.['4key']?.[0];
    expect(patched?.pivot).toEqual({ x: 0.25, y: 0.75 });
    expect(patched?.poses[0].transform.x).toBe(42);
  });

  it('sprite patchPosition은 최신 상태에서 의도를 적용할 수 없으면 건너뛴다', async () => {
    const sprite = spriteFixture('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const base = {
      ...structuredClone(document),
      spritePositions: { '4key': [sprite] },
    } as CanonicalEditorDocumentV1;
    let generated: EditorPatchV1 | null = null;
    commitGeneratedPatch.mockImplementation(
      async (generate: (base: CanonicalEditorDocumentV1) => unknown) => {
        generated = generate(base) as EditorPatchV1 | null;
        return structuredClone(document);
      },
    );

    await expect(
      spriteItemsApi.patchPosition(
        '4key',
        sprite.id,
        { hidden: true },
        undefined,
        () => null,
      ),
    ).resolves.toBe('skipped');
    expect(generated).toBeNull();
  });

  it('sprite patchPosition은 gestureId를 editor_commit 메타로 실어 보낸다', async () => {
    // 수동 mock은 generate를 실행하지 않아 typed 결과는 targetMissing 유지
    await expect(
      spriteItemsApi.patchPosition(
        '4key',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        { hidden: true },
        '6f9c2f6a-0b1d-4e5f-8a3c-2d7e9b4c1a50',
      ),
    ).resolves.toBe('targetMissing');

    expect(commitGeneratedPatch).toHaveBeenCalledWith(expect.any(Function), {
      gestureId: '6f9c2f6a-0b1d-4e5f-8a3c-2d7e9b4c1a50',
    });
  });

  it('preserves each legacy caller return value when writes are queued together', async () => {
    const first = { '4key': ['B'] };
    const second = { '4key': ['C'] };
    let resolveFirst!: (value: EditorDocumentV1) => void;
    const firstCommit = new Promise<EditorDocumentV1>((resolve) => {
      resolveFirst = resolve;
    });
    commitPatch
      .mockImplementationOnce(() => firstCommit)
      .mockResolvedValueOnce({ ...document, keys: second });

    const firstWrite = keysApi.update(first);
    const secondWrite = keysApi.update(second);

    await vi.waitFor(() => expect(commitPatch).toHaveBeenCalledOnce());
    resolveFirst({ ...document, keys: first });
    await expect(firstWrite).resolves.toEqual(first);
    await vi.waitFor(() => expect(commitPatch).toHaveBeenCalledTimes(2));
    await expect(secondWrite).resolves.toEqual(second);
  });

  it('does not reject an acknowledged legacy write when the next queued write fails', async () => {
    const first = { '4key': ['B'] };
    const second = { '4key': ['C'] };
    const secondError = new Error('second write failed');
    let resolveFirst!: (value: EditorDocumentV1) => void;
    const firstCommit = new Promise<EditorDocumentV1>((resolve) => {
      resolveFirst = resolve;
    });
    commitPatch
      .mockImplementationOnce(() => firstCommit)
      .mockRejectedValueOnce(secondError);

    const firstWrite = keysApi.update(first);
    const secondWrite = keysApi.update(second);
    const secondOutcome = secondWrite.catch((error) => error);

    await vi.waitFor(() => expect(commitPatch).toHaveBeenCalledOnce());
    resolveFirst({ ...document, keys: first });
    await expect(firstWrite).resolves.toEqual(first);
    await vi.waitFor(() => expect(commitPatch).toHaveBeenCalledTimes(2));
    await expect(secondOutcome).resolves.toBe(secondError);
  });
});
