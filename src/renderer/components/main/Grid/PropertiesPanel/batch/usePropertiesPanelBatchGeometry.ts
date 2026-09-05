import { useBatchHandlers } from './useBatchHandlers';
import type { usePropertiesPanelSelection } from '../selection/usePropertiesPanelSelection';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import {
  commitBatchGeometryByIds,
  type BatchGeometryDescriptor,
} from '@src/renderer/editor/runtime/operations/elementOps';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { computeBatchGeometryPlan } from '@src/renderer/editor/runtime/geometry/batchGeometryPlan';
import { commitMixedBatchGeometry } from '@src/renderer/editor/runtime/geometry/mixedBatchGeometry';
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
  | 'selectedBatchStyleElements'
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
  selectedBatchStyleElements,
  stableBatchGeometryTargets,
  stablePluginGeometryElements,
  stablePluginGeometryTargets,
}: UsePropertiesPanelBatchGeometryProps) =>
  useBatchHandlers({
    selectedKeyLikeElements: selectedBatchStyleElements as {
      type: 'key' | 'stat' | 'graph' | 'knob';
      id: string;
      index?: number;
    }[],
    keyPositions: positions,
    statPositions: statItemPositions,
    graphPositions: graphItemPositions,
    selectedKeyType,
    knobPositions: knobItemPositions,
    pluginLayoutElements: stablePluginGeometryElements,
    onStableGeometryPreview: (operation) => {
      if (!stableBatchGeometryTargets) return;
      if (stablePluginGeometryElements === null) return;
      const targetsByKey = new Map<
        string,
        {
          type: EditorElementTypeV1;
          position: KeyPosition;
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
            : knobItemPositions;
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
      const byType = new Map<
        EditorElementTypeV1,
        Array<{ id: string; patch: Record<string, unknown> }>
      >();
      for (const update of plan.updates) {
        if (update.key.startsWith('plugin:')) continue;
        const target = targetsByKey.get(update.key);
        if (!target) return;
        const entries = byType.get(target.type) ?? [];
        entries.push({
          id: target.position.id,
          patch: update.patch,
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
              : 'knobPosition',
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
