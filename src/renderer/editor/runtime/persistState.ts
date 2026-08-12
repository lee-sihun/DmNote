/**
 * 편집 상태를 Tauri 백엔드에 동기화하는 유틸리티
 */

import type { KeyMappings, KeyPositions } from '@src/types/key/keys';
import {
  updateMappingsAndPositionsWithGesture,
  updatePositionsWithGesture,
} from '@api/modules/keysApi';

/**
 * positions 변경을 로컬 스토어 + 백엔드에 반영
 * z-order 이동 등에서 공통 사용
 */
export async function persistPositionsWithSync(
  updatedPositions: KeyPositions,
  setPositions: (positions: KeyPositions) => void,
  setLocalUpdateInProgress: (value: boolean) => void,
): Promise<void> {
  setLocalUpdateInProgress(true);
  setPositions(updatedPositions);

  try {
    await updatePositionsWithGesture(updatedPositions);
  } catch (error) {
    console.error('Failed to persist positions', error);
  } finally {
    setLocalUpdateInProgress(false);
  }
}

/**
 * mappings + positions 변경을 단일 트랜잭션으로 백엔드에 반영
 * 분리 저장은 한쪽만 커밋된 채 강제 종료되면 배열 불일치가 디스크에 남음
 * 반환 promise로 게스처 정산이 커밋 성패를 추적
 */
export function persistMappingsAndPositions(
  mappings: KeyMappings,
  positions: KeyPositions,
  gestureId?: string,
): Promise<unknown> {
  const persisted = updateMappingsAndPositionsWithGesture(
    mappings,
    positions,
    gestureId,
  );
  persisted.catch((error) => {
    console.error('Failed to persist key data', error);
  });
  return persisted;
}

/**
 * positions만 백엔드에 반영
 */
export function persistPositions(
  positions: KeyPositions,
  gestureId?: string,
): Promise<unknown> {
  const persisted = updatePositionsWithGesture(positions, gestureId);
  persisted.catch((error) => {
    console.error('Failed to persist positions', error);
  });
  return persisted;
}

/**
 * positions 변경을 로컬 업데이트 플래그와 함께 반영
 */
export function persistPositionsWithFlag(
  positions: KeyPositions,
  setPositions: (positions: KeyPositions) => void,
  setLocalUpdateInProgress: (value: boolean) => void,
  gestureId?: string,
): Promise<unknown> {
  setLocalUpdateInProgress(true);
  setPositions(positions);
  const persisted = updatePositionsWithGesture(positions, gestureId);
  persisted
    .catch((error) => {
      console.error('Failed to persist positions', error);
    })
    .finally(() => {
      setLocalUpdateInProgress(false);
    });
  return persisted;
}
