import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';
import { enqueueEditorCompatibilityWrite } from '@src/renderer/editor/runtime/editorCompatibilityQueue';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';

import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';
import type { ReactiveSpritePosition } from '@src/types/key/sprites';
import { toSpriteWireShape } from '@utils/sprite/spriteWireShape';
import type { LayerGroups } from '@src/types/layerGroups';

// 커밋 성사 여부를 호출자가 판별하는 typed 결과. targetMissing은 무커밋
type SpritePatchCommitResult = 'committed' | 'targetMissing' | 'skipped';
type SpritePatchGenerator = (
  current: ReactiveSpritePosition,
) => Partial<ReactiveSpritePosition> | null;

export const statItemsApi = {
  getPositions: () => invoke<StatItemPositions>('stat_positions_get'),
  updatePositions: (positions: StatItemPositions) =>
    enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitPatch({
          schemaVersion: 1,
          statPositions: positions,
        }),
      () => structuredClone(positions),
    ),
  onPositionsChanged: (listener: (positions: StatItemPositions) => void) =>
    subscribe<StatItemPositions>('statPositions:changed', listener),
};

export const graphItemsApi = {
  getPositions: () => invoke<GraphItemPositions>('graph_positions_get'),
  updatePositions: (positions: GraphItemPositions) =>
    enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitPatch({
          schemaVersion: 1,
          graphPositions: positions,
        }),
      () => structuredClone(positions),
    ),
  onPositionsChanged: (listener: (positions: GraphItemPositions) => void) =>
    subscribe<GraphItemPositions>('graphPositions:changed', listener),
};

export const knobItemsApi = {
  getPositions: () => invoke<KnobItemPositions>('knob_positions_get'),
  updatePositions: (positions: KnobItemPositions) =>
    enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitPatch({
          schemaVersion: 1,
          knobPositions: positions,
        }),
      () => structuredClone(positions),
    ),
  onPositionsChanged: (listener: (positions: KnobItemPositions) => void) =>
    subscribe<KnobItemPositions>('knobPositions:changed', listener),
};

export const spriteItemsApi = {
  // 스프라이트 전용 필드는 ops patchElement가 거부하므로 전체 필드 패치로 커밋.
  // 호출 시점 캡처 전체 레코드는 동결 소유권 검사에 걸려 낙관 적용이 빠지므로
  // 직렬 슬롯 안 최신 base에서 대상 스프라이트만 패치해 생성한다. 대상 소실이면
  // 무커밋 targetMissing. gestureId는 숫자 스크럽 preview 게스처 정산용
  patchPosition: (
    mode: string,
    id: string,
    patch: Partial<ReactiveSpritePosition>,
    gestureId?: string,
    generatePatch?: SpritePatchGenerator,
  ): Promise<SpritePatchCommitResult> => {
    let outcome: SpritePatchCommitResult = 'targetMissing';
    return enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitGeneratedPatch(
          (base) => {
            const modePositions = base.spritePositions[mode] ?? [];
            const index = modePositions.findIndex((sprite) => sprite.id === id);
            if (index < 0) return null;
            outcome = 'skipped';
            const current = modePositions[index];
            const latestPatch = generatePatch ? generatePatch(current) : patch;
            if (!latestPatch) return null;
            outcome = 'committed';
            const nextMode = [...modePositions];
            // patch가 명시 null layerName·groupId를 실어 와도 wire 형태 유지
            nextMode[index] = toSpriteWireShape({
              ...current,
              ...latestPatch,
              id,
            });
            return {
              schemaVersion: 1,
              spritePositions: { ...base.spritePositions, [mode]: nextMode },
            };
          },
          gestureId ? { gestureId } : undefined,
        ),
      () => outcome,
    );
  },
};

export const layerGroupsApi = {
  get: () => invoke<LayerGroups>('layer_groups_get'),
  update: (groups: LayerGroups) =>
    enqueueEditorCompatibilityWrite(
      () =>
        editorCoordinator.commitPatch({
          schemaVersion: 1,
          layerGroups: groups,
        }),
      () => structuredClone(groups),
    ),
  onChanged: (listener: (groups: LayerGroups) => void) =>
    subscribe<LayerGroups>('layerGroups:changed', listener),
};
