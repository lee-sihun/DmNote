'use no memo';
// 프리뷰 오버레이(모듈 상태)를 previewVersion으로 다시 읽어야 해서 컴파일러 메모 제외
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSelectionRotationStore } from '@stores/grid/useSelectionRotationStore';
import {
  composePreviewPositions,
  getPreviewOverlayVersion,
  subscribePreviewOverlay,
} from '@src/renderer/editor/runtime/gesture/previewOverlay';
import { createSelectionRotationSnapshot } from '@utils/element/selectionRotation';
import {
  pointsAabb,
  rotatePointAround,
  wrapDegrees,
} from '@utils/element/rotation';

const ORIGIN = Object.freeze({ x: 0, y: 0 });

export const useSelectionRotationFrame = () => {
  const mode = useKeyStore((state) => state.selectedKeyType);
  const selected = useGridSelectionStore((state) => state.selectedElements);
  const keys = useKeyStore((state) => state.canonicalPositions);
  const stats = useStatItemStore((state) => state.positions);
  const graphs = useGraphItemStore((state) => state.positions);
  const knobs = useKnobItemStore((state) => state.positions);
  const sprites = useSpriteStore((state) => state.positions);
  const previewVersion = useSyncExternalStore(
    subscribePreviewOverlay,
    getPreviewOverlayVersion,
    getPreviewOverlayVersion,
  );
  const referenceKey = useSelectionRotationStore((state) => state.selectionKey);
  const referenceRotation = useSelectionRotationStore(
    (state) => state.referenceRotation,
  );
  const selectionKey =
    selected.length > 1
      ? `${mode}:${selected
          .map(({ type, id }) => `${type}:${id}`)
          .sort()
          .join(',')}`
      : null;
  const snapshot = useMemo(() => {
    if (!selectionKey) return null;
    return createSelectionRotationSnapshot(
      {
        keyPositions: composePreviewPositions('keyPosition', keys),
        statPositions: composePreviewPositions('statPosition', stats),
        graphPositions: composePreviewPositions('graphPosition', graphs),
        knobPositions: composePreviewPositions('knobPosition', knobs),
        spritePositions: composePreviewPositions('spritePosition', sprites),
      },
      selected,
      mode,
    );
    // canonical 밖 프리뷰 패치가 바뀔 때도 다시 합성
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectionKey,
    selected,
    mode,
    keys,
    stats,
    graphs,
    knobs,
    sprites,
    previewVersion,
  ]);
  const currentReference = snapshot?.referenceRotation ?? 0;
  useLayoutEffect(() => {
    useSelectionRotationStore
      .getState()
      .setReference(selectionKey, currentReference);
  }, [selectionKey, currentReference]);

  if (!snapshot || !selectionKey) return null;
  const rotation = wrapDegrees(
    currentReference -
      (referenceKey === selectionKey ? referenceRotation : currentReference),
  );
  // 꼭짓점을 틀의 로컬 축으로 되돌려 감싼 상자가 회전 틀, 그 중심을 다시 세계 좌표로
  const local = pointsAabb(
    snapshot.corners.map((point) =>
      rotatePointAround(point, ORIGIN, -rotation),
    ),
  );
  const width = local.maxX - local.minX;
  const height = local.maxY - local.minY;
  const center = rotatePointAround(
    { x: (local.minX + local.maxX) / 2, y: (local.minY + local.maxY) / 2 },
    ORIGIN,
    rotation,
  );
  return {
    snapshot,
    selectionKey,
    rotation,
    bounds: {
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
    },
  };
};
