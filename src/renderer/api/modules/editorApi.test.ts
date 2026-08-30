import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: runtime.invoke }));

import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import {
  EDITOR_OPS_VERSION,
  EditorProtocolError,
  assertEditorCommittedEvent,
  assertEditorOpsV1,
} from '@src/types/editor';
import { editorApi, editorCommitRaw } from './editorApi';

import type { EditorCommittedV1, EditorDocumentV1 } from '@src/types/editor';

const canonicalDocument = (): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: { '4key': ['A'] },
  keyPositions: {
    '4key': [
      {
        ...createDefaultKeyPosition(),
        id: '00000000-0000-4000-8000-000000000001',
      },
    ],
  },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  spritePositions: {},
  layerGroups: {},
});

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
      opsVersion: EDITOR_OPS_VERSION,
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
        opsVersion: EDITOR_OPS_VERSION,
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
          patch: { property: 'fontFamily', value: '  Raw Family  ' },
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'stat',
          id: '00000000-0000-4000-8000-000000000010',
          patch: { property: 'fontFamily', value: null },
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
          patch: { property: 'graphColor', value: 'raw color' },
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'knob',
          id: '00000000-0000-4000-8000-00000000000e',
          patch: { property: 'graphColor', value: '#fff' },
        } as never,
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'graph',
          id: '00000000-0000-4000-8000-00000000000b',
          patch: { property: 'graphType', value: 'bar' },
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'stat',
          id: '00000000-0000-4000-8000-00000000000c',
          patch: { property: 'graphType', value: 'bar' },
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

  it('group structural ops는 exact sole payload와 native UUID targets만 수용한다', () => {
    const set = {
      kind: 'setElementGroups' as const,
      mode: '4key',
      targets: [
        {
          elementType: 'key' as const,
          id: '00000000-0000-4000-8000-000000000031',
        },
      ],
      targetGroup: { kind: 'create' as const, id: 'group-a', name: 'Group A' },
    };
    const rename = {
      kind: 'renameLayerGroup' as const,
      mode: '4key',
      groupId: 'group-a',
      name: 'After',
    };
    expect(() => assertEditorOpsV1([set])).not.toThrow();
    expect(() => assertEditorOpsV1([rename])).not.toThrow();
    // plugin-only 그룹 편집은 native 대상 없이 def 생성·정리만 운반한다.
    // 백엔드(editor.rs validate)와 생성부(mixedElementGroups)가 모두 허용하므로
    // 프론트 검증도 빈 targets를 통과시켜야 한다
    expect(() => assertEditorOpsV1([{ ...set, targets: [] }])).not.toThrow();
    expect(() =>
      assertEditorOpsV1([{ ...set, targets: [], targetGroup: null }]),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        set,
        {
          kind: 'deleteElement',
          elementType: 'key',
          id: set.targets[0].id,
        },
      ]),
    ).toThrow(EditorProtocolError);
    for (const invalid of [
      { ...set, targets: [{ elementType: 'key', id: 'key-0' }] },
      { ...set, targets: [...set.targets, set.targets[0]] },
      {
        ...set,
        targetGroup: { kind: 'existing', id: 'group-a', name: 'extra' },
      },
      { ...rename, name: '' },
      { ...rename, extra: true },
    ]) {
      expect(() => assertEditorOpsV1([invalid as never])).toThrow(
        EditorProtocolError,
      );
    }
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
          patch: { property: 'hidden', value: true },
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
    // 태그 형식에 추가 키가 섞이면 exact 2키 검사로 거부 (다키 거부 불변식)
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'key',
          id,
          patch: { property: 'hidden', value: true, hidden: true },
        } as never,
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'key',
          id,
          patch: { property: 'hidden', value: true, extra: 1 },
        } as never,
      ]),
    ).toThrow(EditorProtocolError);
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'patchElement',
          elementType: 'graph',
          id,
          patch: { property: 'layerName', value: null },
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
    ['graph', { property: 'showAvgLine', value: true }],
    ['graph', { property: 'graphAnimationEnabled', value: false }],
    ['graph', { property: 'graphSpeed', value: 4_294_967_295 }],
    ['knob', { property: 'reverse', value: true }],
    ['knob', { property: 'sensitivity', value: -0.5 }],
    ['knob', { property: 'axisId', value: '  HIDA:raw  ' }],
    ['knob', { property: 'axisId', value: '' }],
    ['key', { property: 'soundPath', value: '  sounds/raw.wav  ' }],
    ['key', { property: 'soundPath', value: '' }],
    ['key', { property: 'inactiveImage', value: '  /tmp/raw.png  ' }],
    ['stat', { property: 'inactiveImage', value: '' }],
    ['graph', { property: 'inactiveImage', value: 'graph.png' }],
    ['knob', { property: 'inactiveImage', value: 'knob.png' }],
    ['key', { property: 'activeImage', value: '  /tmp/raw active.png  ' }],
    ['knob', { property: 'activeImage', value: '' }],
    ['key', { property: 'idleTransparent', value: true }],
    ['stat', { property: 'idleTransparent', value: false }],
    ['graph', { property: 'idleTransparent', value: true }],
    ['knob', { property: 'idleTransparent', value: false }],
    ['key', { property: 'activeTransparent', value: true }],
    ['knob', { property: 'activeTransparent', value: false }],
    ['key', { property: 'idleImageFit', value: 'cover' }],
    ['stat', { property: 'idleImageFit', value: 'contain' }],
    ['graph', { property: 'idleImageFit', value: 'fill' }],
    ['knob', { property: 'idleImageFit', value: 'none' }],
    ['key', { property: 'activeImageFit', value: 'contain' }],
    ['knob', { property: 'activeImageFit', value: 'fill' }],
    ['key', { property: 'soundEnabled', value: true }],
    ['key', { property: 'soundVolume', value: 0 }],
    ['key', { property: 'soundVolume', value: 200 }],
    ['key', { property: 'counterEnabled', value: true }],
    ['stat', { property: 'counterAnimationEnabled', value: false }],
    ['key', { property: 'counterPlacement', value: 'outside' }],
    ['stat', { property: 'counterAlign', value: 'left' }],
    ['key', { property: 'counterAlignMode', value: 'between' }],
    ['stat', { property: 'counterGap', value: 4_294_967_295 }],
    ['key', { property: 'counterFontSize', value: 8 }],
    ['stat', { property: 'counterFontSize', value: 72 }],
    ['key', { property: 'counterFontWeight', value: 100 }],
    ['stat', { property: 'counterFontWeight', value: 900 }],
    ['key', { property: 'counterFontItalic', value: true }],
    ['stat', { property: 'counterFontUnderline', value: false }],
    ['key', { property: 'counterFontStrikethrough', value: true }],
    ['key', { property: 'counterFontFamily', value: '' }],
    [
      'stat',
      { property: 'counterFontFamily', value: '  Raw Counter Family  ' },
    ],
    [
      'stat',
      {
        property: 'fontPaint',
        value: { color: '  Raw Idle Font  ', gradient: null },
      },
    ],
    [
      'key',
      {
        property: 'activeFontPaint',
        value: {
          color: '#FF0080',
          gradient: {
            angle: 90,
            stops: [
              { color: '#FF0080', pos: 0 },
              { color: '#001122', pos: 1 },
            ],
          },
        },
      },
    ],
    ['stat', { property: 'counterFillIdle', value: { color: ' raw solid ' } }],
    [
      'key',
      {
        property: 'counterFillActive',
        value: {
          color: 'rgba(17,34,51,1)',
          gradient: {
            angle: 45,
            stops: [
              { color: '#112233', pos: 0 },
              { color: '#445566', pos: 1 },
            ],
          },
        },
      },
    ],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'builtin-ease-out' },
      },
    ],
    [
      'stat',
      {
        property: 'counterAnimationPreset',
        value: {
          presetId: 'preset-a',
          applyPresetId: true,
          bezier: [0.25, 0.1, 0.25, 1],
          scale: 1.2,
          durationMs: 500,
        },
      },
    ],
    ['key', { property: 'useInlineStyles', value: false }],
    ['stat', { property: 'useInlineStyles', value: true }],
    ['graph', { property: 'useInlineStyles', value: false }],
    ['knob', { property: 'useInlineStyles', value: true }],
    ['key', { property: 'displayText', value: '' }],
    ['stat', { property: 'displayText', value: '  Raw label  ' }],
    ['graph', { property: 'displayText', value: 'Graph' }],
    ['knob', { property: 'displayText', value: 'Knob' }],
    ['key', { property: 'className', value: '' }],
    ['stat', { property: 'className', value: '  Raw class  ' }],
    ['graph', { property: 'className', value: 'graph-class' }],
    ['knob', { property: 'className', value: 'knob-class' }],
    ['key', { property: 'borderWidth', value: 0 }],
    ['stat', { property: 'borderWidth', value: 20 }],
    ['graph', { property: 'borderRadius', value: 100 }],
    ['knob', { property: 'borderRadius', value: 999 }],
    [
      'key',
      { property: 'shadow', value: { leaf: 'color', value: '  raw shadow  ' } },
    ],
    ['stat', { property: 'shadow', value: { leaf: 'offsetX', value: -100 } }],
    [
      'knob',
      { property: 'activeShadow', value: { leaf: 'offsetY', value: 100 } },
    ],
    ['key', { property: 'activeShadow', value: { leaf: 'blur', value: 100 } }],
    ['stat', { property: 'shadowEnabled', value: false }],
    ['key', { property: 'fontSize', value: 8 }],
    ['knob', { property: 'fontSize', value: 72 }],
    ['key', { property: 'noteGlowSize', value: 0 }],
    ['key', { property: 'noteGlowSize', value: 20.5 }],
    ['key', { property: 'noteGlowSize', value: 50 }],
    ['key', { property: 'noteOffsetX', value: null }],
    ['key', { property: 'noteOffsetX', value: -500 }],
    ['key', { property: 'noteOffsetX', value: 0 }],
    ['key', { property: 'noteOffsetY', value: 500 }],
    ['key', { property: 'noteWidth', value: null }],
    ['key', { property: 'noteWidth', value: 0.1 }],
    ['key', { property: 'noteBorderWidth', value: 0 }],
    ['key', { property: 'noteBorderWidth', value: 20 }],
    ['key', { property: 'noteBorderRadius', value: 0 }],
    ['key', { property: 'noteBorderRadius', value: 100 }],
    ['key', { property: 'notePaint', value: { color: '' } }],
    [
      'key',
      {
        property: 'noteGlowPaint',
        value: { color: { type: 'gradient', top: ' raw top ', bottom: '' } },
      },
    ],
    ['key', { property: 'notePaint', value: { opacity: 0 } }],
    [
      'key',
      {
        property: 'noteGlowPaint',
        value: { opacity: 90, opacityTop: 80, opacityBottom: 70 },
      },
    ],
    [
      'key',
      {
        property: 'noteBorderPaint',
        value: { color: '#A0b1C2', opacity: 100 },
      },
    ],
    [
      'key',
      {
        property: 'backgroundPaint',
        value: { color: ' raw ', gradient: null },
      },
    ],
    [
      'knob',
      {
        property: 'activeBorderPaint',
        value: {
          color: '#first',
          gradient: {
            angle: 45,
            stops: [
              { color: '#first', pos: 0 },
              { color: '#last', pos: 1 },
            ],
          },
        },
      },
    ],
    ['key', { property: 'fontWeight', value: 4_294_967_295 }],
    ['stat', { property: 'fontItalic', value: false }],
    ['graph', { property: 'fontUnderline', value: true }],
    ['knob', { property: 'fontStrikethrough', value: false }],
    ['key', { property: 'noteEffectEnabled', value: false }],
    ['key', { property: 'noteAutoYCorrection', value: true }],
    ['key', { property: 'noteGlowEnabled', value: false }],
    ['key', { property: 'noteAlignment', value: 'right' }],
    ['key', { property: 'noteBorderSide', value: 'horizontal' }],
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
    ['stat', { property: 'showAvgLine', value: true }],
    ['knob', { property: 'graphAnimationEnabled', value: true }],
    ['graph', { property: 'graphSpeed', value: -1 }],
    ['graph', { property: 'graphSpeed', value: 4_294_967_296 }],
    ['graph', { property: 'graphSpeed', value: 1.5 }],
    ['graph', { property: 'reverse', value: true }],
    ['knob', { property: 'sensitivity', value: Number.POSITIVE_INFINITY }],
    ['knob', { reverse: true, sensitivity: 1 }],
    ['key', { property: 'axisId', value: 'HIDA:test' }],
    ['knob', { property: 'axisId', value: 1 }],
    ['knob', { axisId: 'HIDA:test', reverse: false }],
    ['stat', { property: 'soundPath', value: 'sounds/stat.wav' }],
    ['graph', { property: 'soundPath', value: 'sounds/graph.wav' }],
    ['knob', { property: 'soundPath', value: 'sounds/knob.wav' }],
    ['stat', { property: 'soundEnabled', value: true }],
    ['key', { property: 'soundEnabled', value: 1 }],
    ['key', { soundEnabled: true, soundPath: 'sounds/key.wav' }],
    ['stat', { property: 'soundVolume', value: 100 }],
    ['key', { property: 'soundVolume', value: -0.1 }],
    ['key', { property: 'soundVolume', value: 200.1 }],
    ['key', { property: 'soundVolume', value: Number.POSITIVE_INFINITY }],
    ['key', { soundVolume: 100, soundEnabled: true }],
    ['key', { property: 'soundPath', value: 1 }],
    ['key', { soundPath: 'sounds/key.wav', soundEnabled: true }],
    ['key', { property: 'inactiveImage', value: 1 }],
    ['stat', { property: 'inactiveImage', value: null }],
    ['graph', { inactiveImage: 'graph.png', activeImage: 'active.png' }],
    ['stat', { property: 'activeImage', value: 'active.png' }],
    ['graph', { property: 'activeImage', value: 'active.png' }],
    ['key', { property: 'activeImage', value: 1 }],
    ['knob', { activeImage: 'active.png', inactiveImage: 'idle.png' }],
    ['key', { property: 'idleTransparent', value: 1 }],
    ['graph', { idleTransparent: true, activeTransparent: false }],
    ['stat', { property: 'activeTransparent', value: true }],
    ['graph', { property: 'activeTransparent', value: false }],
    ['key', { property: 'activeTransparent', value: 'true' }],
    ['knob', { activeTransparent: true, idleTransparent: false }],
    ['key', { property: 'idleImageFit', value: 'stretch' }],
    ['graph', { idleImageFit: 'cover', activeImageFit: 'contain' }],
    ['stat', { property: 'activeImageFit', value: 'cover' }],
    ['graph', { property: 'activeImageFit', value: 'none' }],
    ['key', { property: 'activeImageFit', value: null }],
    ['key', { property: 'displayText', value: 1 }],
    ['stat', { displayText: 'Stat', fontItalic: true }],
    ['key', { property: 'className', value: 1 }],
    ['graph', { className: 'graph-class', displayText: 'Graph' }],
    ['key', { property: 'borderWidth', value: -0.1 }],
    ['stat', { property: 'borderWidth', value: 20.1 }],
    ['graph', { property: 'borderWidth', value: Number.POSITIVE_INFINITY }],
    ['key', { property: 'borderRadius', value: -0.1 }],
    ['graph', { property: 'borderRadius', value: 100.1 }],
    ['knob', { property: 'borderRadius', value: 999.1 }],
    ['key', { property: 'fontSize', value: 7.9 }],
    ['stat', { property: 'fontSize', value: 72.1 }],
    ['graph', { property: 'fontSize', value: '14' }],
    ['knob', { borderWidth: 1, borderRadius: 2 }],
    ['graph', { property: 'shadow', value: { leaf: 'blur', value: 10 } }],
    ['stat', { property: 'activeShadow', value: { leaf: 'blur', value: 10 } }],
    ['key', { property: 'shadow', value: { leaf: 'color', value: '' } }],
    ['key', { property: 'shadow', value: { leaf: 'offsetX', value: -100.1 } }],
    [
      'knob',
      { property: 'activeShadow', value: { leaf: 'offsetY', value: Infinity } },
    ],
    ['key', { property: 'shadow', value: { leaf: 'blur', value: 100.1 } }],
    ['key', { property: 'shadow', value: { blur: 10, color: '#000' } }],
    ['key', { property: 'shadowEnabled', value: 1 }],
    ['key', { shadowEnabled: true, shadow: { blur: 10 } }],
    ['stat', { property: 'noteGlowSize', value: 20 }],
    ['graph', { property: 'noteGlowSize', value: 20 }],
    ['knob', { property: 'noteGlowSize', value: 20 }],
    ['key', { property: 'noteGlowSize', value: -0.1 }],
    ['key', { property: 'noteGlowSize', value: 50.1 }],
    ['key', { property: 'noteGlowSize', value: Number.POSITIVE_INFINITY }],
    ['key', { property: 'noteGlowSize', value: '20' }],
    ['key', { noteGlowSize: 20, noteGlowEnabled: true }],
    ['stat', { property: 'noteOffsetX', value: 0 }],
    ['graph', { property: 'noteWidth', value: null }],
    ['knob', { property: 'noteBorderWidth', value: 2 }],
    ['key', { property: 'noteOffsetX', value: -500.1 }],
    ['key', { property: 'noteOffsetY', value: 500.1 }],
    ['key', { property: 'noteOffsetX', value: Number.NaN }],
    ['key', { property: 'noteWidth', value: 0 }],
    ['key', { property: 'noteWidth', value: Number.POSITIVE_INFINITY }],
    ['key', { property: 'noteBorderWidth', value: -0.1 }],
    ['key', { property: 'noteBorderWidth', value: 20.1 }],
    ['key', { property: 'noteBorderRadius', value: -0.1 }],
    ['key', { property: 'noteBorderRadius', value: 100.1 }],
    ['key', { property: 'noteBorderRadius', value: null }],
    ['key', { noteOffsetX: 0, noteOffsetY: 0 }],
    ['stat', { property: 'notePaint', value: { color: '#fff' } }],
    [
      'key',
      {
        property: 'notePaint',
        value: { color: { type: 'gradient', top: '#fff' } },
      },
    ],
    [
      'key',
      {
        property: 'notePaint',
        value: {
          color: { type: 'gradient', top: '#fff', bottom: '#000', extra: true },
        },
      },
    ],
    ['key', { property: 'notePaint', value: { opacity: 101 } }],
    ['key', { property: 'notePaint', value: { opacity: 50, opacityTop: 40 } }],
    [
      'key',
      {
        property: 'notePaint',
        value: { opacity: 50, opacityTop: 40, opacityBottom: 30.5 },
      },
    ],
    [
      'key',
      { property: 'noteGlowPaint', value: { color: '#fff', opacity: 50 } },
    ],
    [
      'key',
      { property: 'noteBorderPaint', value: { color: '#fff', opacity: 50 } },
    ],
    [
      'key',
      { property: 'noteBorderPaint', value: { color: '#FFFFFF', opacity: -1 } },
    ],
    ['key', { notePaint: { color: '#fff' }, noteGlowSize: 20 }],
    [
      'stat',
      {
        property: 'activeBackgroundPaint',
        value: { color: '#fff', gradient: null },
      },
    ],
    [
      'graph',
      {
        property: 'activeBorderPaint',
        value: { color: '#fff', gradient: null },
      },
    ],
    ['key', { property: 'backgroundPaint', value: { color: '#fff' } }],
    [
      'key',
      {
        property: 'backgroundPaint',
        value: { color: '#fff', gradient: null, extra: true },
      },
    ],
    [
      'key',
      {
        property: 'backgroundPaint',
        value: {
          color: '#first',
          gradient: {
            angle: -0,
            stops: [
              { color: '#first', pos: 0 },
              { color: '#last', pos: 1 },
            ],
          },
        },
      },
    ],
    [
      'key',
      {
        property: 'backgroundPaint',
        value: {
          color: '#first',
          gradient: {
            angle: 45,
            stops: [
              { color: '#first', pos: -0 },
              { color: '#last', pos: 1 },
            ],
          },
        },
      },
    ],
    [
      'key',
      {
        property: 'backgroundPaint',
        value: {
          color: '#mismatch',
          gradient: {
            angle: 45,
            stops: [
              { color: '#first', pos: 0 },
              { color: '#last', pos: 1 },
            ],
          },
        },
      },
    ],
    ['graph', { property: 'counterEnabled', value: true }],
    ['knob', { property: 'counterAnimationEnabled', value: false }],
    ['key', { property: 'counterEnabled', value: 1 }],
    ['stat', { property: 'counterAnimationEnabled', value: 'yes' }],
    ['graph', { property: 'counterPlacement', value: 'inside' }],
    ['key', { property: 'counterPlacement', value: 'middle' }],
    ['stat', { property: 'counterAlign', value: 'center' }],
    ['key', { property: 'counterAlignMode', value: 'ends' }],
    ['key', { property: 'counterGap', value: -1 }],
    ['key', { property: 'counterGap', value: 1.5 }],
    ['key', { property: 'counterGap', value: 4_294_967_296 }],
    ['key', { counterGap: 8, counterAlign: 'top' }],
    ['graph', { property: 'counterFontSize', value: 12 }],
    ['knob', { property: 'counterFontItalic', value: true }],
    ['key', { property: 'counterFontSize', value: 7 }],
    ['stat', { property: 'counterFontSize', value: 73 }],
    ['key', { property: 'counterFontSize', value: 12.5 }],
    ['stat', { property: 'counterFontWeight', value: 99 }],
    ['key', { property: 'counterFontWeight', value: 901 }],
    ['key', { property: 'counterFontWeight', value: 400.5 }],
    ['stat', { property: 'counterFontItalic', value: 1 }],
    ['key', { counterFontUnderline: true, counterFontItalic: false }],
    ['graph', { property: 'counterFontFamily', value: 'Counter Family' }],
    ['knob', { property: 'counterFontFamily', value: '' }],
    ['key', { property: 'counterFontFamily', value: null }],
    ['stat', { counterFontFamily: 'Counter', counterFontItalic: true }],
    ['key', { counterEnabled: true, counterAnimationEnabled: false }],
    [
      'graph',
      { property: 'counterAnimationPreset', value: { presetId: 'preset-a' } },
    ],
    ['key', { property: 'counterAnimationPreset', value: { presetId: '' } }],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'a', applyPresetId: false },
      },
    ],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'a', extra: true },
      },
    ],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'a', bezier: [0, 0, 0] },
      },
    ],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'a', bezier: [-0.1, 0, 0, 1] },
      },
    ],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'a', bezier: [0, 2.1, 0, 1] },
      },
    ],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'a', scale: Number.NaN },
      },
    ],
    ['graph', { property: 'counterFillIdle', value: { color: '#fff' } }],
    ['key', { property: 'fontColor', value: '#fff' }],
    ['key', { property: 'activeFontColor', value: '#fff' }],
    [
      'graph',
      { property: 'fontPaint', value: { color: '#fff', gradient: null } },
    ],
    [
      'knob',
      { property: 'fontPaint', value: { color: '#fff', gradient: null } },
    ],
    [
      'stat',
      { property: 'activeFontPaint', value: { color: '#fff', gradient: null } },
    ],
    ['key', { property: 'fontPaint', value: { color: '#fff' } }],
    ['stat', { property: 'counterFillActive', value: { color: '#fff' } }],
    [
      'key',
      { property: 'counterFillIdle', value: { color: '#fff', gradient: null } },
    ],
    [
      'key',
      {
        property: 'counterFillIdle',
        value: {
          color: '#112233',
          gradient: {
            angle: 45,
            stops: [
              { color: '#112233', pos: 0 },
              { color: '#445566', pos: 1 },
            ],
          },
        },
      },
    ],
    [
      'key',
      { property: 'counterFillIdle', value: { color: '#fff', extra: true } },
    ],
    [
      'key',
      {
        property: 'counterFillActive',
        value: { color: '#fff', gradient: { angle: -0, stops: [] } },
      },
    ],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'a', durationMs: 0 },
      },
    ],
    [
      'key',
      {
        property: 'counterAnimationPreset',
        value: { presetId: 'a', durationMs: 5001 },
      },
    ],
    [
      'key',
      {
        counterAnimationPreset: { presetId: 'a' },
        fontItalic: true,
      },
    ],
    ['key', { property: 'useInlineStyles', value: 1 }],
    ['key', { property: 'fontWeight', value: -1 }],
    ['key', { property: 'fontWeight', value: 4_294_967_296 }],
    ['stat', { property: 'fontWeight', value: 1.5 }],
    ['graph', { property: 'fontItalic', value: 1 }],
    ['knob', { property: 'fontUnderline', value: 'yes' }],
    ['key', { fontStrikethrough: true, fontItalic: false }],
    ['stat', { property: 'noteEffectEnabled', value: true }],
    ['key', { property: 'noteAutoYCorrection', value: 1 }],
    ['key', { property: 'noteGlowEnabled', value: 'yes' }],
    ['key', { property: 'noteAlignment', value: 'top' }],
    ['key', { property: 'noteBorderSide', value: 'left' }],
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
      opsVersion: EDITOR_OPS_VERSION,
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

describe('editor canonical ID ingress', () => {
  beforeEach(() => {
    runtime.invoke.mockReset();
    window.__dmn_runtime = 'tauri';
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'key-0'],
    ['nil', '00000000-0000-0000-0000-000000000000'],
  ])('editor_get은 %s native ID를 거절한다', async (_label, id) => {
    const document = canonicalDocument();
    document.keyPositions['4key'][0] = {
      ...document.keyPositions['4key'][0],
      id,
    };
    runtime.invoke.mockResolvedValueOnce({ revision: 0, document });

    await expect(editorApi.get()).rejects.toBeInstanceOf(EditorProtocolError);
    expect(runtime.invoke).toHaveBeenCalledOnce();
  });

  it('editor_get은 collection 전체의 raw ID 중복을 거절한다', async () => {
    const document = canonicalDocument();
    document.statPositions['4key'] = [
      {
        ...createDefaultKeyPosition(),
        id: document.keyPositions['4key'][0].id,
        statType: 'kps',
      },
    ];
    runtime.invoke.mockResolvedValueOnce({ revision: 0, document });

    await expect(editorApi.get()).rejects.toBeInstanceOf(EditorProtocolError);
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'key-0'],
    ['nil', '00000000-0000-0000-0000-000000000000'],
  ])('committed patch는 %s native ID를 거절한다', (_label, id) => {
    const position = { ...createDefaultKeyPosition(), id };
    const event: EditorCommittedV1 = {
      schemaVersion: 1,
      revision: 1,
      mutationId: 'external-invalid-id',
      changedFields: ['keyPositions'],
      patch: {
        schemaVersion: 1,
        keyPositions: { '4key': [position] },
      },
    };

    expect(() => assertEditorCommittedEvent(event)).toThrow(
      EditorProtocolError,
    );
  });

  it('committed patch는 커밋 전용 v2 스키마를 거절한다', () => {
    // 백엔드는 이벤트 patch를 항상 v1로 낸다(patch_for_fields). 커밋 요청과
    // 공용인 assertEditorPatch가 v2를 통과시키므로 이벤트 경계에서 막아야 한다
    const event = {
      schemaVersion: 1,
      revision: 1,
      mutationId: 'external-v2-patch',
      changedFields: ['keyPositions'],
      patch: {
        schemaVersion: 2,
        keyPositions: {
          '4key': [
            {
              ...createDefaultKeyPosition(),
              id: '00000000-0000-4000-8000-000000000009',
            },
          ],
        },
      },
    } as unknown as EditorCommittedV1;

    expect(() => assertEditorCommittedEvent(event)).toThrow(
      EditorProtocolError,
    );
  });

  it('committed patch는 collection 사이 raw ID 중복을 거절한다', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const event: EditorCommittedV1 = {
      schemaVersion: 1,
      revision: 1,
      mutationId: 'external-duplicate-id',
      changedFields: ['keyPositions', 'statPositions'],
      patch: {
        schemaVersion: 1,
        keyPositions: {
          '4key': [{ ...createDefaultKeyPosition(), id }],
        },
        statPositions: {
          '4key': [{ ...createDefaultKeyPosition(), id, statType: 'kps' }],
        },
      },
    };

    expect(() => assertEditorCommittedEvent(event)).toThrow(
      EditorProtocolError,
    );
  });
});

// 백엔드는 이 세 필드도 UUID로 거절한다(editor.rs의 is_valid_element_id).
// 프론트가 길이만 보면 낙관 적용까지 끝난 뒤 백엔드가 거절해 문서가 갈리고
// 편집이 조용히 사라진다. 두 검증의 기준을 같게 유지하는 계약
describe('요소 ID 검증이 백엔드와 같은 기준을 쓴다', () => {
  const VALID = '00000000-0000-4000-8000-0000000000aa';
  const INVALID = ['key-0', '00000000-0000-0000-0000-000000000000', 'x'];

  const opsOf = (op: unknown) => ({
    opsVersion: EDITOR_OPS_VERSION,
    ops: [op],
  });

  it('네이티브 형식 id는 통과한다 - 과잉 거절이면 정상 편집이 막힌다', () => {
    expect(() =>
      assertEditorOpsV1(
        opsOf({ kind: 'setKeySlot', id: VALID, slot: 'A' }).ops,
      ),
    ).not.toThrow();
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'reorderElements',
          mode: '4key',
          zUpdates: [{ elementType: 'key', id: VALID, zIndex: 1 }],
          groupUpdates: [],
          completeModeOrder: false,
        },
      ]),
    ).not.toThrow();
  });

  it.each(INVALID)('setKeySlot.id에서 %s를 거절한다', (id) => {
    expect(() =>
      assertEditorOpsV1(opsOf({ kind: 'setKeySlot', id, slot: 'A' }).ops),
    ).toThrow(EditorProtocolError);
  });

  it.each(INVALID)('reorderElements의 zUpdates id에서 %s를 거절한다', (id) => {
    expect(() =>
      assertEditorOpsV1([
        {
          kind: 'reorderElements',
          mode: '4key',
          zUpdates: [{ elementType: 'key', id, zIndex: 1 }],
          groupUpdates: [],
          // 필수 키를 채워야 exact-keys 검사가 아니라 id 검증에서 거절된다
          completeModeOrder: false,
        },
      ]),
    ).toThrow(/zUpdates\[0\] target is invalid/);
  });
});
