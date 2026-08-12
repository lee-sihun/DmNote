import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: runtime.invoke }));

import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { EditorProtocolError, assertEditorOpsV1 } from '@src/types/editor';
import { editorCommitRaw } from './editorApi';

describe('editorCommitRaw semantic op protocol', () => {
  beforeEach(() => {
    runtime.invoke.mockReset();
    window.__dmn_runtime = 'tauri';
  });

  it('op 요청 길이와 순서에 대응하는 결과만 수용한다', async () => {
    runtime.invoke.mockResolvedValueOnce({
      revision: 1,
      changedFields: ['keyPositions'],
      opResults: [
        {
          status: 'applied',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    });
    const request = {
      baseRevision: 0,
      mutationId: '00000000-0000-4000-8000-000000000001',
      opsVersion: 1 as const,
      ops: [
        {
          kind: 'setBounds' as const,
          elementType: 'key' as const,
          id: '00000000-0000-4000-8000-000000000002',
          bounds: { dx: 1, dy: 2, width: 3, height: 4 },
        },
      ],
    };

    await expect(editorCommitRaw(request)).resolves.toMatchObject({
      opResults: [{ status: 'applied' }],
    });
    expect(runtime.invoke).toHaveBeenCalledWith('editor_commit', { request });
  });

  it('patch 응답의 opResults와 길이가 다른 opResults를 거절한다', async () => {
    runtime.invoke.mockResolvedValueOnce({
      revision: 0,
      changedFields: [],
      opResults: [],
    });
    await expect(
      editorCommitRaw({
        baseRevision: 0,
        mutationId: '00000000-0000-4000-8000-000000000003',
        changes: { schemaVersion: 1 as const },
      }),
    ).rejects.toBeInstanceOf(EditorProtocolError);

    runtime.invoke.mockResolvedValueOnce({
      revision: 0,
      changedFields: [],
      opResults: [],
    });
    await expect(
      editorCommitRaw({
        baseRevision: 0,
        mutationId: '00000000-0000-4000-8000-000000000004',
        opsVersion: 1,
        ops: [
          {
            kind: 'setBounds',
            elementType: 'key',
            id: '00000000-0000-4000-8000-000000000005',
            bounds: { dx: 1, dy: 2, width: 3, height: 4 },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(EditorProtocolError);
  });

  it('insertFrozenElements nested wire는 exact key와 i32 z를 강제한다', () => {
    const valid = {
      kind: 'insertFrozenElements' as const,
      mode: '4key',
      elements: [
        {
          elementType: 'key' as const,
          slot: 'KeyA',
          position: {
            ...createDefaultKeyPosition(),
            id: '00000000-0000-4000-8000-000000000006',
            zIndex: 2_147_483_647,
          },
        },
      ],
      groups: [{ id: 'group-a', name: 'Group A' }],
      zUpdates: [
        {
          elementType: 'key' as const,
          id: '00000000-0000-4000-8000-000000000007',
          zIndex: -2_147_483_648,
        },
      ],
    };

    expect(() => assertEditorOpsV1([valid])).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          ...valid,
          elements: [
            {
              ...valid.elements[0],
              position: { ...valid.elements[0].position, unknown: true },
            },
          ],
        },
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          ...valid,
          elements: [
            {
              ...valid.elements[0],
              position: {
                ...valid.elements[0].position,
                counter: {
                  ...valid.elements[0].position.counter,
                  unexpected: true,
                },
              },
            },
          ],
        },
      ]),
    ).toThrow(EditorProtocolError);
    for (const slot of [
      { keys: ['KeyA', 'KeyA'], match: 'all' as const },
      { keys: ['KeyA', 'Key+B'], match: 'any' as const },
    ]) {
      expect(() =>
        assertEditorOpsV1([
          {
            ...valid,
            elements: [{ ...valid.elements[0], slot }],
          },
        ]),
      ).toThrow(EditorProtocolError);
    }
    expect(() =>
      assertEditorOpsV1([
        {
          ...valid,
          zUpdates: [{ ...valid.zUpdates[0], zIndex: 2_147_483_648 }],
        },
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          ...valid,
          elements: [
            {
              ...valid.elements[0],
              position: {
                ...valid.elements[0].position,
                zIndex: -2_147_483_649,
              },
            },
          ],
        },
      ]),
    ).toThrow(EditorProtocolError);
  });

  it('reorderElements는 sole op와 complete 계약을 exact하게 강제한다', () => {
    const valid = {
      kind: 'reorderElements' as const,
      mode: '4key',
      completeModeOrder: true,
      zUpdates: [
        {
          elementType: 'key' as const,
          id: '00000000-0000-4000-8000-000000000031',
          zIndex: 1,
        },
      ],
      groupUpdates: [
        {
          elementType: 'key' as const,
          id: '00000000-0000-4000-8000-000000000031',
          groupId: null,
        },
      ],
    };
    expect(() => assertEditorOpsV1([valid])).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        valid,
        {
          kind: 'deleteElement',
          elementType: 'key',
          id: valid.zUpdates[0].id,
        },
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          ...valid,
          completeModeOrder: false,
        },
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          ...valid,
          groupUpdates: [
            {
              ...valid.groupUpdates[0],
              id: '00000000-0000-4000-8000-000000000032',
            },
          ],
        },
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([{ ...valid, mode: '한'.repeat(43) }]),
    ).toThrow(EditorProtocolError);
  });

  it('patchElement와 setKeySlot은 좁은 exact payload만 수용한다', () => {
    const id = '00000000-0000-4000-8000-000000000041';
    const slotId = '00000000-0000-4000-8000-000000000042';
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'key',
          id,
          patch: { hidden: true },
        },
        { kind: 'setKeySlot', id: slotId, slot: 'KeyA' },
      ]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'key',
          id,
          patch: { hidden: true, zIndex: 9 },
        } as never,
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        { kind: 'setKeySlot', id, slot: { keys: ['A'], match: 'any' } },
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'setKeySlot',
          id,
          slot: { keys: ['A', 'B'], match: 'any', index: 0 },
        } as never,
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'setKeySlot',
          id,
          slot: { keys: ['A', 'A'], match: 'all' },
        },
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'setKeySlot',
          id,
          slot: { keys: ['A+B', 'C'], match: 'all' },
        },
      ]),
    ).toThrow(EditorProtocolError);
  });

  it('insertFrozenElements는 sole op이며 groups-only 요청을 거절한다', () => {
    const groupsOnly = {
      kind: 'insertFrozenElements' as const,
      mode: '4key',
      elements: [],
      groups: [{ id: 'group-a', name: 'Group A' }],
      zUpdates: [],
    };
    expect(() => assertEditorOpsV1([groupsOnly])).toThrow(EditorProtocolError);
    const insert = {
      ...groupsOnly,
      elements: [
        {
          elementType: 'key' as const,
          slot: 'KeyA',
          position: {
            ...createDefaultKeyPosition(),
            id: '00000000-0000-4000-8000-000000000009',
          },
        },
      ],
    };
    expect(() =>
      assertEditorOpsV1([
        insert,
        {
          kind: 'deleteElement',
          elementType: 'key',
          id: '00000000-0000-4000-8000-000000000008',
        },
      ]),
    ).toThrow(EditorProtocolError);
  });

  it('insertFrozenElements 결과는 applied와 noChange만 wire 계약대로 수용한다', async () => {
    const request = {
      baseRevision: 0,
      mutationId: '00000000-0000-4000-8000-000000000010',
      opsVersion: 1 as const,
      ops: [
        {
          kind: 'insertFrozenElements' as const,
          mode: '4key',
          elements: [
            {
              elementType: 'key' as const,
              slot: 'KeyA',
              position: {
                ...createDefaultKeyPosition(),
                id: '00000000-0000-4000-8000-000000000011',
              },
            },
          ],
          groups: [{ id: 'group-a', name: 'Group A' }],
          zUpdates: [],
        },
      ],
    };
    runtime.invoke.mockResolvedValueOnce({
      revision: 1,
      changedFields: ['keys', 'keyPositions', 'layerGroups'],
      opResults: [{ status: 'applied' }],
    });
    await expect(editorCommitRaw(request)).resolves.toMatchObject({
      opResults: [{ status: 'applied' }],
    });

    runtime.invoke.mockResolvedValueOnce({
      revision: 1,
      changedFields: [],
      opResults: [{ status: 'noChange' }],
    });
    await expect(editorCommitRaw(request)).resolves.toMatchObject({
      opResults: [{ status: 'noChange' }],
    });

    runtime.invoke.mockResolvedValueOnce({
      revision: 1,
      changedFields: [],
      opResults: [{ status: 'targetMissing' }],
    });
    await expect(editorCommitRaw(request)).rejects.toBeInstanceOf(
      EditorProtocolError,
    );

    runtime.invoke.mockResolvedValueOnce({
      revision: 1,
      changedFields: ['keys', 'keyPositions'],
      opResults: [{ status: 'applied' }],
    });
    await expect(editorCommitRaw(request)).rejects.toBeInstanceOf(
      EditorProtocolError,
    );
  });
});
