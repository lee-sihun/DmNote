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
          kind: 'patchElement',
          elementType: 'stat',
          id: '00000000-0000-4000-8000-00000000000f',
          patch: { fontFamily: '  Raw Family  ' },
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'stat',
          id: '00000000-0000-4000-8000-000000000010',
          patch: { fontFamily: null },
        } as never,
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'stat',
          id: '00000000-0000-4000-8000-000000000011',
          patch: { fontFamily: 'Family', fontItalic: true },
        } as never,
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'graph',
          id: '00000000-0000-4000-8000-00000000000d',
          patch: { graphColor: 'raw color' },
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'knob',
          id: '00000000-0000-4000-8000-00000000000e',
          patch: { graphColor: '#fff' },
        } as never,
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'graph',
          id: '00000000-0000-4000-8000-00000000000b',
          patch: { graphType: 'bar' },
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'stat',
          id: '00000000-0000-4000-8000-00000000000c',
          patch: { graphType: 'bar' },
        } as never,
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
        {
          kind: 'patchElement',
          elementType: 'graph',
          id,
          patch: { layerName: null },
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'graph',
          id,
          patch: { hidden: true, layerName: 'both' },
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

  it.each([
    ['graph', { showAvgLine: true }],
    ['graph', { graphAnimationEnabled: false }],
    ['graph', { graphSpeed: 4_294_967_295 }],
    ['knob', { reverse: true }],
    ['knob', { sensitivity: -0.5 }],
    ['knob', { axisId: '  HIDA:raw  ' }],
    ['knob', { axisId: '' }],
    ['key', { soundPath: '  sounds/raw.wav  ' }],
    ['key', { soundPath: '' }],
    ['key', { inactiveImage: '  /tmp/raw.png  ' }],
    ['stat', { inactiveImage: '' }],
    ['graph', { inactiveImage: 'graph.png' }],
    ['knob', { inactiveImage: 'knob.png' }],
    ['key', { activeImage: '  /tmp/raw active.png  ' }],
    ['knob', { activeImage: '' }],
    ['key', { idleTransparent: true }],
    ['stat', { idleTransparent: false }],
    ['graph', { idleTransparent: true }],
    ['knob', { idleTransparent: false }],
    ['key', { activeTransparent: true }],
    ['knob', { activeTransparent: false }],
    ['key', { idleImageFit: 'cover' }],
    ['stat', { idleImageFit: 'contain' }],
    ['graph', { idleImageFit: 'fill' }],
    ['knob', { idleImageFit: 'none' }],
    ['key', { activeImageFit: 'contain' }],
    ['knob', { activeImageFit: 'fill' }],
    ['key', { soundEnabled: true }],
    ['key', { soundVolume: 0 }],
    ['key', { soundVolume: 200 }],
    ['key', { counterEnabled: true }],
    ['stat', { counterAnimationEnabled: false }],
    ['key', { counterPlacement: 'outside' }],
    ['stat', { counterAlign: 'left' }],
    ['key', { counterAlignMode: 'between' }],
    ['stat', { counterGap: 4_294_967_295 }],
    ['key', { counterFontSize: 8 }],
    ['stat', { counterFontSize: 72 }],
    ['key', { counterFontWeight: 100 }],
    ['stat', { counterFontWeight: 900 }],
    ['key', { counterFontItalic: true }],
    ['stat', { counterFontUnderline: false }],
    ['key', { counterFontStrikethrough: true }],
    ['key', { counterAnimationPreset: { presetId: 'builtin-ease-out' } }],
    [
      'stat',
      {
        counterAnimationPreset: {
          presetId: 'preset-a',
          applyPresetId: true,
          bezier: [0.25, 0.1, 0.25, 1],
          scale: 1.2,
          durationMs: 500,
        },
      },
    ],
    ['key', { useInlineStyles: false }],
    ['stat', { useInlineStyles: true }],
    ['graph', { useInlineStyles: false }],
    ['knob', { useInlineStyles: true }],
    ['key', { fontWeight: 4_294_967_295 }],
    ['stat', { fontItalic: false }],
    ['graph', { fontUnderline: true }],
    ['knob', { fontStrikethrough: false }],
    ['key', { noteEffectEnabled: false }],
    ['key', { noteAutoYCorrection: true }],
    ['key', { noteGlowEnabled: false }],
    ['key', { noteAlignment: 'right' }],
    ['key', { noteBorderSide: 'horizontal' }],
  ] as const)(
    'patchElement %s runtime leaf %j의 exact wire를 수용한다',
    (elementType, patch) => {
      expect(() =>
        assertEditorOpsV1([
          {
            kind: 'patchElement',
            elementType,
            id: '00000000-0000-4000-8000-000000000043',
            patch,
          },
        ]),
      ).not.toThrow();
    },
  );

  it.each([
    ['stat', { showAvgLine: true }],
    ['knob', { graphAnimationEnabled: true }],
    ['graph', { graphSpeed: -1 }],
    ['graph', { graphSpeed: 4_294_967_296 }],
    ['graph', { graphSpeed: 1.5 }],
    ['graph', { reverse: true }],
    ['knob', { sensitivity: Number.POSITIVE_INFINITY }],
    ['knob', { reverse: true, sensitivity: 1 }],
    ['key', { axisId: 'HIDA:test' }],
    ['knob', { axisId: 1 }],
    ['knob', { axisId: 'HIDA:test', reverse: false }],
    ['stat', { soundPath: 'sounds/stat.wav' }],
    ['graph', { soundPath: 'sounds/graph.wav' }],
    ['knob', { soundPath: 'sounds/knob.wav' }],
    ['stat', { soundEnabled: true }],
    ['key', { soundEnabled: 1 }],
    ['key', { soundEnabled: true, soundPath: 'sounds/key.wav' }],
    ['stat', { soundVolume: 100 }],
    ['key', { soundVolume: -0.1 }],
    ['key', { soundVolume: 200.1 }],
    ['key', { soundVolume: Number.POSITIVE_INFINITY }],
    ['key', { soundVolume: 100, soundEnabled: true }],
    ['key', { soundPath: 1 }],
    ['key', { soundPath: 'sounds/key.wav', soundEnabled: true }],
    ['key', { inactiveImage: 1 }],
    ['stat', { inactiveImage: null }],
    ['graph', { inactiveImage: 'graph.png', activeImage: 'active.png' }],
    ['stat', { activeImage: 'active.png' }],
    ['graph', { activeImage: 'active.png' }],
    ['key', { activeImage: 1 }],
    ['knob', { activeImage: 'active.png', inactiveImage: 'idle.png' }],
    ['key', { idleTransparent: 1 }],
    ['graph', { idleTransparent: true, activeTransparent: false }],
    ['stat', { activeTransparent: true }],
    ['graph', { activeTransparent: false }],
    ['key', { activeTransparent: 'true' }],
    ['knob', { activeTransparent: true, idleTransparent: false }],
    ['key', { idleImageFit: 'stretch' }],
    ['graph', { idleImageFit: 'cover', activeImageFit: 'contain' }],
    ['stat', { activeImageFit: 'cover' }],
    ['graph', { activeImageFit: 'none' }],
    ['key', { activeImageFit: null }],
    ['graph', { counterEnabled: true }],
    ['knob', { counterAnimationEnabled: false }],
    ['key', { counterEnabled: 1 }],
    ['stat', { counterAnimationEnabled: 'yes' }],
    ['graph', { counterPlacement: 'inside' }],
    ['key', { counterPlacement: 'middle' }],
    ['stat', { counterAlign: 'center' }],
    ['key', { counterAlignMode: 'ends' }],
    ['key', { counterGap: -1 }],
    ['key', { counterGap: 1.5 }],
    ['key', { counterGap: 4_294_967_296 }],
    ['key', { counterGap: 8, counterAlign: 'top' }],
    ['graph', { counterFontSize: 12 }],
    ['knob', { counterFontItalic: true }],
    ['key', { counterFontSize: 7 }],
    ['stat', { counterFontSize: 73 }],
    ['key', { counterFontSize: 12.5 }],
    ['stat', { counterFontWeight: 99 }],
    ['key', { counterFontWeight: 901 }],
    ['key', { counterFontWeight: 400.5 }],
    ['stat', { counterFontItalic: 1 }],
    ['key', { counterFontUnderline: true, counterFontItalic: false }],
    ['key', { counterEnabled: true, counterAnimationEnabled: false }],
    ['graph', { counterAnimationPreset: { presetId: 'preset-a' } }],
    ['key', { counterAnimationPreset: { presetId: '' } }],
    [
      'key',
      { counterAnimationPreset: { presetId: 'a', applyPresetId: false } },
    ],
    ['key', { counterAnimationPreset: { presetId: 'a', extra: true } }],
    ['key', { counterAnimationPreset: { presetId: 'a', bezier: [0, 0, 0] } }],
    [
      'key',
      { counterAnimationPreset: { presetId: 'a', bezier: [-0.1, 0, 0, 1] } },
    ],
    [
      'key',
      { counterAnimationPreset: { presetId: 'a', bezier: [0, 2.1, 0, 1] } },
    ],
    ['key', { counterAnimationPreset: { presetId: 'a', scale: Number.NaN } }],
    ['key', { counterAnimationPreset: { presetId: 'a', durationMs: 0 } }],
    ['key', { counterAnimationPreset: { presetId: 'a', durationMs: 5001 } }],
    [
      'key',
      {
        counterAnimationPreset: { presetId: 'a' },
        fontItalic: true,
      },
    ],
    ['key', { useInlineStyles: 1 }],
    ['key', { fontWeight: -1 }],
    ['key', { fontWeight: 4_294_967_296 }],
    ['stat', { fontWeight: 1.5 }],
    ['graph', { fontItalic: 1 }],
    ['knob', { fontUnderline: 'yes' }],
    ['key', { fontStrikethrough: true, fontItalic: false }],
    ['stat', { noteEffectEnabled: true }],
    ['key', { noteAutoYCorrection: 1 }],
    ['key', { noteGlowEnabled: 'yes' }],
    ['key', { noteAlignment: 'top' }],
    ['key', { noteBorderSide: 'left' }],
    ['key', { noteEffectEnabled: true, noteGlowEnabled: true }],
  ] as const)(
    'patchElement %s runtime leaf %j의 잘못된 wire를 거절한다',
    (elementType, patch) => {
      expect(() =>
        assertEditorOpsV1([
          {
            kind: 'patchElement',
            elementType,
            id: '00000000-0000-4000-8000-000000000044',
            patch,
          } as never,
        ]),
      ).toThrow(EditorProtocolError);
    },
  );

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
