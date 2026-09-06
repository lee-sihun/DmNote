import { useBatchHandlers } from '../useBatchHandlers';
import type { usePropertiesPanelSelection } from '../../selection/usePropertiesPanelSelection';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import {
  commitBatchGeometryByIds,
  type BatchGeometryDescriptor,
} from '@src/renderer/editor/runtime/operations/elementOps';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { computeBatchGeometryPlan } from '@src/renderer/editor/runtime/geometry/batchGeometryPlan';
import { commitMixedBatchGeometry } from '@src/renderer/editor/runtime/geometry/mixedBatchGeometry';
import { spriteResizePatch } from '@utils/sprite/resizeProjection';
import type { EditorElementTypeV1 } from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';

type PropertiesPanelSelection = ReturnType<typeof usePropertiesPanelSelection>;

type UsePropertiesPanelBatchGeometryProps = Pick<
  PropertiesPanelSelection,
  | 'selectedKeyType'
  | 'positions'
  | 'statItemPositions'
  | 'graphItemPositions'
  | 'knobItemPositions'
  | 'canonicalSpritePositions'
  | 'spriteItemPositions'
  | 'selectedBatchGeometryElements'
  | 'stableBatchGeometryTargets'
  | 'stablePluginGeometryElements'
  | 'stablePluginGeometryTargets'
>;

export const usePropertiesPanelBatchGeometry = ({
  selectedKeyType,
  positions,
  statItemPositions,
  graphItemPositions,
  knobItemPositions,
  canonicalSpritePositions,
  spriteItemPositions,
  selectedBatchGeometryElements,
  stableBatchGeometryTargets,
  stablePluginGeometryElements,
  stablePluginGeometryTargets,
}: UsePropertiesPanelBatchGeometryProps) =>
  useBatchHandlers({
    selectedKeyLikeElements: selectedBatchGeometryElements as {
      type: 'key' | 'stat' | 'graph' | 'knob' | 'sprite';
      id: string;
      index?: number;
    }[],
    keyPositions: positions,
    statPositions: statItemPositions,
    graphPositions: graphItemPositions,
    selectedKeyType,
    knobPositions: knobItemPositions,
    spritePositions: spriteItemPositions,
    pluginLayoutElements: stablePluginGeometryElements,
    onStableGeometryPreview: (operation) => {
      if (!stableBatchGeometryTargets) return;
      if (stablePluginGeometryElements === null) return;
      const targetsByKey = new Map<
        string,
        {
          type: EditorElementTypeV1;
          position: Pick<KeyPosition, 'id' | 'dx' | 'dy' | 'width' | 'height'>;
        }
      >();
      for (const target of stableBatchGeometryTargets) {
        const locator = resolveElementById(target.type, target.id);
        if (!locator || locator.mode !== selectedKeyType) return;
        const record =
          target.type === 'key'
            ? positions
            : target.type === 'stat'
            ? statItemPositions
            : target.type === 'graph'
            ? graphItemPositions
            : target.type === 'knob'
            ? knobItemPositions
            : spriteItemPositions;
        const position = record[selectedKeyType]?.[locator.index];
        if (!position || position.id !== target.id) return;
        targetsByKey.set(`${target.type}:${target.id}`, {
          type: target.type,
          position,
        });
      }
      // 커밋과 같은 기준선을 쓰도록 plan 입력에는 plugin bounds를 합치되,
      // preview 반영은 native 4 domain 전용 - 플러그인은 dial 중 정지,
      // 커밋 시 착지 (v1). resize는 native 전용이라 plugin 미합류
      const pluginPlanInputs =
        operation.kind === 'resize' ? [] : stablePluginGeometryElements;
      const plan = computeBatchGeometryPlan(
        [
          ...[...targetsByKey].map(([key, { position }]) => ({
            key,
            x: position.dx,
            y: position.dy,
            width: position.width,
            height: position.height,
          })),
          ...pluginPlanInputs.map((element) => ({
            key: `plugin:${element.fullId}`,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
          })),
        ],
        operation,
      );
      if (!plan) return;
      // 스프라이트는 bounds와 콘텐츠 스케일이 한 몸이라 커밋이 resizeSprite를 낸다.
      // 미리보기가 원시 bounds만 얹으면 드래그 중엔 활동 영역만 줄다가 놓는 순간
      // 이미지와 자세가 한꺼번에 축소된다 - 커밋과 같은 투영을 여기서도 쓴다.
      // 기준은 canonical: 합성된 spriteItemPositions를 넣으면 이전 프레임의 배율
      // 위에 다시 배율이 얹혀 누적된다
      const spriteBoundsByKey = new Map(
        plan.bounds.map(({ key, bounds }) => [key, bounds] as const),
      );
      const spritePreviewPatch = (
        key: string,
        id: string,
      ): Record<string, unknown> | null => {
        const bounds = spriteBoundsByKey.get(key);
        if (!bounds) return null;
        const canonical = (
          canonicalSpritePositions[selectedKeyType] ?? []
        ).find((position) => position.id === id);
        return canonical
          ? (spriteResizePatch(canonical, bounds) as Record<string, unknown>)
          : null;
      };
      const byType = new Map<
        EditorElementTypeV1,
        Array<{ id: string; patch: Record<string, unknown> }>
      >();
      for (const update of plan.updates) {
        if (update.key.startsWith('plugin:')) continue;
        const target = targetsByKey.get(update.key);
        if (!target) return;
        const entries = byType.get(target.type) ?? [];
        // 이동 계열은 배율 1이라 커밋도 setBounds와 같다 - 원시 patch 유지
        const projected =
          target.type === 'sprite' && operation.kind === 'resize'
            ? spritePreviewPatch(update.key, target.position.id)
            : null;
        entries.push({
          id: target.position.id,
          patch: projected ?? update.patch,
        });
        byType.set(target.type, entries);
      }
      for (const [type, entries] of byType) {
        editGestureController.preview(selectedKeyType, entries, {
          domain:
            type === 'key'
              ? 'keyPosition'
              : type === 'stat'
              ? 'statPosition'
              : type === 'graph'
              ? 'graphPosition'
              : type === 'knob'
              ? 'knobPosition'
              : 'spritePosition',
        });
      }
    },
    onStableGeometryCommit: (operation, options) => {
      if (!stableBatchGeometryTargets) return;
      // plugin 대상 미해결 상태의 커밋은 fail-closed
      if (stablePluginGeometryTargets === null) return;
      const descriptor: BatchGeometryDescriptor = {
        mode: selectedKeyType,
        targets: stableBatchGeometryTargets,
        operation,
      };
      const gestureId =
        options?.gestureId ??
        (operation.kind === 'resize'
          ? editGestureController.activeGestureId() ?? undefined
          : undefined);
      // 크기 일괄은 native 전용 - 플러그인 크기는 content-driven
      const pluginTargets =
        operation.kind === 'resize' ? [] : stablePluginGeometryTargets;
      const commit =
        pluginTargets.length > 0
          ? commitMixedBatchGeometry(descriptor, pluginTargets, {
              ...(gestureId ? { gestureId } : {}),
            })
          : commitBatchGeometryByIds(descriptor, {
              ...(gestureId ? { gestureId } : {}),
            });
      if (operation.kind === 'resize' || operation.kind === 'spacing') {
        editGestureController.settleCommit(commit);
      }
      void commit.catch((error) => {
        console.error('Failed to commit batch geometry', error);
      });
    },
  });
