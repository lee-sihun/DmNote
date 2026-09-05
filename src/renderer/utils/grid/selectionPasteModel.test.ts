import { describe, expect, it } from 'vitest';
import type {
  CanonicalEditorDocumentV1,
  CanonicalKeyPosition,
  CanonicalReactiveSpritePosition,
} from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { createFrozenPasteModel } from './selectionPasteModel';

const EXISTING_ID = '00000000-0000-4000-8000-000000000401';
const PASTED_ID = '00000000-0000-4000-8000-000000000402';
const PASTED_SPRITE_ID = '00000000-0000-4000-8000-000000000403';

const position = (
  id: string,
  dx: number,
  zIndex: number,
): CanonicalKeyPosition =>
  ({ id, dx, dy: 0, width: 60, height: 60, zIndex } as CanonicalKeyPosition);

const emptyView = () => ({
  keys: {} as Record<string, string[]>,
  keyPositions: {} as CanonicalEditorDocumentV1['keyPositions'],
  statPositions: {} as CanonicalEditorDocumentV1['statPositions'],
  graphPositions: {} as CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: {} as CanonicalEditorDocumentV1['knobPositions'],
  spritePositions: {} as CanonicalEditorDocumentV1['spritePositions'],
  layerGroups: {} as Record<string, Array<{ id: string; name: string }>>,
});

describe('createFrozenPasteModel', () => {
  const pastedPosition = position(PASTED_ID, 20, 2);
  const pastedPlugin = {
    id: 'instance',
    fullId: 'plugin::instance',
    pluginId: 'plugin',
    tabId: '4key',
    position: { x: 10, y: 10 },
    zIndex: 1,
  } as PluginDisplayElementInternal;

  const pastedSprite = {
    id: PASTED_SPRITE_ID,
    dx: 40,
    dy: 0,
    width: 200,
    height: 200,
    zIndex: 3,
    poses: [],
  } as unknown as CanonicalReactiveSpritePosition;

  const createModel = (
    spritesToAdd: Array<{ position: CanonicalReactiveSpritePosition }> = [],
  ) =>
    createFrozenPasteModel({
      selectedKeyType: '4key',
      keysToAdd: [{ keyCode: 'KeyB', position: pastedPosition }],
      statsToAdd: [],
      graphsToAdd: [],
      knobsToAdd: [],
      spritesToAdd,
      frozenPluginElements: [pastedPlugin],
      pluginIdsToAdd: ['plugin'],
      frozenNewGroups: [],
      frozenInstanceCaps: [],
      frozenAnchor: null,
    });

  it('동결 payload를 문서와 plugin projection에 멱등 적용한다', () => {
    const model = createModel();
    const base = emptyView();
    const first = model.computePaste(base, []);

    expect(first.appended).toBe(true);
    expect(first.nativeBatchState).toBe('fresh');
    expect(first.keys['4key']).toEqual(['KeyB']);
    expect(first.desiredProjection.map((element) => element.fullId)).toEqual([
      pastedPlugin.fullId,
    ]);

    const realizedView = {
      keys: first.keys,
      keyPositions: first.zPatch.keyPositions,
      statPositions: first.zPatch.statPositions,
      graphPositions: first.zPatch.graphPositions,
      knobPositions: first.zPatch.knobPositions,
      spritePositions: first.zPatch.spritePositions,
      layerGroups: first.layerGroups,
    };
    const second = model.computePaste(realizedView, first.desiredProjection);
    expect(second.appended).toBe(false);
    expect(second.nativeBatchState).toBe('realized');
  });

  it('동일 ID의 payload가 다르면 전체 계획을 중단한다', () => {
    const model = createModel();
    const view = emptyView();
    view.keys['4key'] = ['KeyB'];
    view.keyPositions['4key'] = [position(PASTED_ID, 999, 2)];

    expect(() => model.computePaste(view, [])).toThrow('paste id collision');
  });

  it('최종 z-order를 사용한 frozen insert op를 생성한다', () => {
    const model = createModel();
    const view = emptyView();
    view.keys['4key'] = ['KeyA'];
    view.keyPositions['4key'] = [position(EXISTING_ID, 0, 0)];
    const plan = model.computePaste(view, []);
    const result = model.buildFrozenInsertOp(view, plan);

    expect(result.op?.kind).toBe('insertFrozenElements');
    expect(result.op?.elements).toHaveLength(1);
    expect(result.op?.elements[0]).toMatchObject({
      elementType: 'key',
      slot: 'KeyB',
      position: { id: PASTED_ID, zIndex: 2 },
    });
    expect(result.op?.zUpdates).toEqual([
      { elementType: 'key', id: EXISTING_ID, zIndex: 0 },
    ]);
  });

  it('스프라이트 payload도 같은 계획으로 append하고 insert op에 싣는다', () => {
    const model = createModel([{ position: pastedSprite }]);
    const view = emptyView();
    const plan = model.computePaste(view, []);

    expect(plan.appended).toBe(true);
    expect(plan.zPatch.spritePositions['4key']?.map((p) => p.id)).toEqual([
      PASTED_SPRITE_ID,
    ]);

    const result = model.buildFrozenInsertOp(view, plan);
    expect(result.op?.elements.map((element) => element.elementType)).toEqual([
      'key',
      'sprite',
    ]);

    // 같은 id·같은 payload 재적용은 멱등 skip
    const realizedView = {
      ...view,
      keys: plan.keys,
      keyPositions: plan.zPatch.keyPositions,
      spritePositions: plan.zPatch.spritePositions,
    };
    expect(
      model.computePaste(realizedView, plan.desiredProjection).nativeBatchState,
    ).toBe('realized');
  });
});
