import { useEffect, useRef, useState } from 'react';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  calculateBounds,
  calculateSnapPoints,
  calculateSizeSnap,
} from '@utils/grid/smartGuides';
import { selectionElementId } from '@stores/grid/useGridSelectionStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type { KeyPositions } from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';
import type { ElementBounds } from '@utils/grid/smartGuides';
import {
  beginPluginInstancesEditSession,
  endPluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';

interface ResizeHandle {
  id: string;
  dx: number;
  dy: number;
}

interface ResizeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 그룹 리사이즈용 요소 bounds
interface GroupElementBounds {
  element: SelectedElement;
  bounds: ResizeBounds;
}

// 그룹 리사이즈 결과
interface GroupResizeResult {
  groupBounds: ResizeBounds;
  elementBounds: GroupElementBounds[];
  handle: ResizeHandle;
}

interface UseGridResizeOptions {
  selectedElements: SelectedElement[];
  selectedKeyType: string;
  onResizeEnd?: (gestureId?: string) => void;
  getOtherElements?: (excludeId: string) => ElementBounds[];
}

/**
 * 그리드에서 키 및 플러그인 요소 리사이즈를 처리하는 훅
 * 드래그 중에는 프리뷰 bounds만 업데이트하고, 드래그 종료 시 실제 크기를 적용하여
 * 시각적 흔들림을 방지합니다.
 */
export function useGridResize({
  selectedElements,
  selectedKeyType,
  onResizeEnd,
  getOtherElements,
}: UseGridResizeOptions) {
  const resizeStartRef = useRef(false);
  const pluginResizeTokensRef = useRef(new Map<string, string>());
  const resizeGestureIdRef = useRef<string | null>(null);
  // 드래그 중 프리뷰 bounds (드래그 중일 때만 값이 있음)
  const [previewBounds, setPreviewBounds] = useState<ResizeBounds | null>(null);
  // 최종 적용할 bounds를 저장 (드래그 종료 시 사용)
  const finalBoundsRef = useRef<ResizeBounds | null>(null);

  // 그룹 리사이즈용 상태
  const [previewGroupBounds, setPreviewGroupBounds] =
    useState<ResizeBounds | null>(null);
  const [previewElementBounds, setPreviewElementBounds] = useState<
    GroupElementBounds[] | null
  >(null);
  const finalGroupBoundsRef = useRef<{
    groupBounds: ResizeBounds;
    elementBounds: GroupElementBounds[];
  } | null>(null);

  const beginPluginResizeSessions = (gestureId: string) => {
    const pluginElementIds = new Set(
      selectedElements
        .filter((element) => element.type === 'plugin')
        .map((element) => element.id),
    );
    usePluginDisplayElementStore
      .getState()
      .elements.filter((element) => pluginElementIds.has(element.fullId))
      .forEach((element) => {
        if (!pluginResizeTokensRef.current.has(element.pluginId)) {
          pluginResizeTokensRef.current.set(
            element.pluginId,
            beginPluginInstancesEditSession(element.pluginId, gestureId),
          );
        }
      });
  };

  const endPluginResizeSessions = () => {
    const tokens = pluginResizeTokensRef.current;
    pluginResizeTokensRef.current = new Map();
    tokens.forEach((token, pluginId) => {
      endPluginInstancesEditSession(pluginId, token);
    });
    // 완료 경로가 혼합 커밋을 타지 않은 경우의 staged 잔존 정산
    const gestureId = resizeGestureIdRef.current;
    if (gestureId) cancelUncommittedMixedGestureTransaction(gestureId);
    resizeGestureIdRef.current = null;
  };

  useEffect(
    () => () => {
      const gestureId = resizeGestureIdRef.current;
      endPluginResizeSessions();
      if (gestureId) cancelUncommittedMixedGestureTransaction(gestureId);
    },
    [],
  );

  const handleResizeStart = (_handle?: ResizeHandle) => {
    if (resizeStartRef.current) return;
    resizeStartRef.current = true;
    const gestureId = crypto.randomUUID();
    resizeGestureIdRef.current = gestureId;
    beginPluginResizeSessions(gestureId);
    if (
      pluginResizeTokensRef.current.size > 0 &&
      selectedElements.some((element) => element.type !== 'plugin')
    ) {
      beginMixedGestureTransaction(gestureId, [
        ...pluginResizeTokensRef.current.keys(),
      ]);
    }

    // 기존 스마트 가이드 클리어
    useSmartGuidesStore.getState().clearGuides();

    // 리사이즈 시작 시 애니메이션 비활성화
    useGridSelectionStore.getState().setDraggingOrResizing(true);
  };

  // 공용 리사이즈 프리뷰 처리 (스마트 가이드 포함)
  const handleElementResizePreview = (
    elementId: string,
    newBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      handle?: ResizeHandle;
    },
  ) => {
    const smartGuidesStore = useSmartGuidesStore.getState();
    const gridSettings = useSettingsStore.getState().gridSettings;
    const alignmentGuidesEnabled = gridSettings?.alignmentGuides !== false;
    const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;
    const sizeMatchGuidesEnabled = gridSettings?.sizeMatchGuides !== false;

    let finalX = newBounds.x;
    let finalY = newBounds.y;
    let finalWidth = newBounds.width;
    let finalHeight = newBounds.height;

    // 스마트 가이드 계산 (getOtherElements가 제공된 경우, 정렬 가이드가 활성화된 경우)
    if (getOtherElements && alignmentGuidesEnabled) {
      const otherElements = getOtherElements(elementId);

      // 리사이즈 중인 요소의 bounds 계산
      const draggedBounds = calculateBounds(
        newBounds.x,
        newBounds.y,
        newBounds.width,
        newBounds.height,
        elementId,
      );

      const snapResult = calculateSnapPoints(
        draggedBounds,
        otherElements,
        undefined,
        {
          disableSpacing: !spacingGuidesEnabled,
        },
      );
      const handle = newBounds.handle;

      if (handle) {
        // X축 스냅 (간격 스냅인 경우 spacingGuidesEnabled 확인)
        if (
          handle.dx !== 0 &&
          snapResult.didSnapX &&
          !(snapResult.didSpacingSnapX && !spacingGuidesEnabled)
        ) {
          if (handle.dx === -1) {
            // 왼쪽 핸들: 왼쪽 가장자리 스냅
            const widthDiff = finalX - snapResult.snappedX;
            finalX = snapResult.snappedX;
            finalWidth = finalWidth + widthDiff;
          } else if (handle.dx === 1) {
            // 오른쪽 핸들: 오른쪽 가장자리 스냅
            const snappedRight = snapResult.snappedX + draggedBounds.width;
            finalWidth = snappedRight - finalX;
          } else if (handle.dx === 0) {
            // 수직 핸들 (상/하): 중앙 정렬 스냅
            finalX = snapResult.snappedX;
          }
        }

        // Y축 스냅 (간격 스냅인 경우 spacingGuidesEnabled 확인)
        if (
          handle.dy !== 0 &&
          snapResult.didSnapY &&
          !(snapResult.didSpacingSnapY && !spacingGuidesEnabled)
        ) {
          if (handle.dy === -1) {
            // 위쪽 핸들: 위쪽 가장자리 스냅
            const heightDiff = finalY - snapResult.snappedY;
            finalY = snapResult.snappedY;
            finalHeight = finalHeight + heightDiff;
          } else if (handle.dy === 1) {
            // 아래쪽 핸들: 아래쪽 가장자리 스냅
            const snappedBottom = snapResult.snappedY + draggedBounds.height;
            finalHeight = snappedBottom - finalY;
          } else if (handle.dy === 0) {
            // 수평 핸들 (좌/우): 중앙 정렬 스냅
            finalY = snapResult.snappedY;
          }
        }

        // Size Matching: 다른 요소와 동일한 크기로 스냅 (sizeMatchGuidesEnabled 확인)
        if (sizeMatchGuidesEnabled) {
          const sizeSnapResult = calculateSizeSnap(
            finalWidth,
            finalHeight,
            otherElements,
            elementId,
          );

          if (sizeSnapResult.didSnapWidth) {
            // 핸들 방향에 따라 크기 조정
            if (handle.dx === -1) {
              // 왼쪽 핸들: 왼쪽 가장자리를 조정
              finalX = finalX - (sizeSnapResult.snappedWidth - finalWidth);
            }
            finalWidth = sizeSnapResult.snappedWidth;
          }

          if (sizeSnapResult.didSnapHeight) {
            if (handle.dy === -1) {
              // 위쪽 핸들: 위쪽 가장자리를 조정
              finalY = finalY - (sizeSnapResult.snappedHeight - finalHeight);
            }
            finalHeight = sizeSnapResult.snappedHeight;
          }

          // 스냅 후 bounds로 가이드라인 업데이트
          const hasAlignSnap =
            (handle.dx !== 0 &&
              snapResult.didSnapX &&
              !(snapResult.didSpacingSnapX && !spacingGuidesEnabled)) ||
            (handle.dy !== 0 &&
              snapResult.didSnapY &&
              !(snapResult.didSpacingSnapY && !spacingGuidesEnabled));
          const hasSizeSnap =
            sizeSnapResult.didSnapWidth || sizeSnapResult.didSnapHeight;

          if (hasAlignSnap || hasSizeSnap) {
            const snappedBounds = calculateBounds(
              finalX,
              finalY,
              finalWidth,
              finalHeight,
              elementId,
            );
            smartGuidesStore.setDraggedBounds(snappedBounds);

            // 정렬 가이드 업데이트
            if (hasAlignSnap) {
              smartGuidesStore.setActiveGuides(snapResult.guides);
              // 간격 가이드 업데이트 (spacingGuidesEnabled가 true인 경우에만)
              if (
                spacingGuidesEnabled &&
                snapResult.spacingGuides &&
                snapResult.spacingGuides.length > 0
              ) {
                // 핸들 방향에 따라 간격 가이드 필터링
                const filteredSpacingGuides = snapResult.spacingGuides.filter(
                  (guide) => {
                    // 수평 방향 간격 가이드 (좌우 간격)
                    if (guide.direction === 'horizontal') {
                      // 좌우 핸들이 아니면 표시 안 함
                      if (handle.dx === 0) return false;

                      // 드래그 중인 요소와 관련된 가이드만 표시
                      const isDraggedElement =
                        guide.fromElementId === elementId ||
                        guide.toElementId === elementId;

                      if (!isDraggedElement) return false;

                      // 왼쪽 핸들(dx: -1): 왼쪽 간격만 표시
                      if (handle.dx === -1) {
                        return guide.toElementId === elementId;
                      }
                      // 오른쪽 핸들(dx: 1): 오른쪽 간격만 표시
                      if (handle.dx === 1) {
                        return guide.fromElementId === elementId;
                      }
                    }

                    // 수직 방향 간격 가이드 (상하 간격)
                    if (guide.direction === 'vertical') {
                      // 상하 핸들이 아니면 표시 안 함
                      if (handle.dy === 0) return false;

                      // 드래그 중인 요소와 관련된 가이드만 표시
                      const isDraggedElement =
                        guide.fromElementId === elementId ||
                        guide.toElementId === elementId;

                      if (!isDraggedElement) return false;

                      // 위쪽 핸들(dy: -1): 위쪽 간격만 표시
                      if (handle.dy === -1) {
                        return guide.toElementId === elementId;
                      }
                      // 아래쪽 핸들(dy: 1): 아래쪽 간격만 표시
                      if (handle.dy === 1) {
                        return guide.fromElementId === elementId;
                      }
                    }

                    return false;
                  },
                );
                smartGuidesStore.setSpacingGuides(filteredSpacingGuides);
              } else {
                smartGuidesStore.setSpacingGuides([]);
              }
            } else {
              smartGuidesStore.setActiveGuides([]);
              smartGuidesStore.setSpacingGuides([]);
            }

            // Size Match 가이드 업데이트 (정렬 스냅과 별개로 항상 표시)
            if (hasSizeSnap) {
              smartGuidesStore.setSizeMatchGuides(
                sizeSnapResult.sizeMatchGuides,
              );
            } else {
              smartGuidesStore.setSizeMatchGuides([]);
            }
          } else {
            smartGuidesStore.clearGuides();
          }
        } else {
          // sizeMatchGuides가 비활성화된 경우 기존 정렬 스냅만 처리
          const hasAlignSnap =
            (handle.dx !== 0 &&
              snapResult.didSnapX &&
              !(snapResult.didSpacingSnapX && !spacingGuidesEnabled)) ||
            (handle.dy !== 0 &&
              snapResult.didSnapY &&
              !(snapResult.didSpacingSnapY && !spacingGuidesEnabled));
          if (hasAlignSnap) {
            const snappedBounds = calculateBounds(
              finalX,
              finalY,
              finalWidth,
              finalHeight,
              elementId,
            );
            smartGuidesStore.setDraggedBounds(snappedBounds);
            smartGuidesStore.setActiveGuides(snapResult.guides);
            if (spacingGuidesEnabled && snapResult.spacingGuides?.length > 0) {
              // 핸들 방향에 따라 간격 가이드 필터링
              const filteredSpacingGuides = snapResult.spacingGuides.filter(
                (guide) => {
                  // 수평 방향 간격 가이드 (좌우 간격)
                  if (guide.direction === 'horizontal') {
                    // 좌우 핸들이 아니면 표시 안 함
                    if (handle.dx === 0) return false;

                    // 드래그 중인 요소와 관련된 가이드만 표시
                    const isDraggedElement =
                      guide.fromElementId === elementId ||
                      guide.toElementId === elementId;

                    if (!isDraggedElement) return false;

                    // 왼쪽 핸들(dx: -1): 왼쪽 간격만 표시
                    if (handle.dx === -1) {
                      return guide.toElementId === elementId;
                    }
                    // 오른쪽 핸들(dx: 1): 오른쪽 간격만 표시
                    if (handle.dx === 1) {
                      return guide.fromElementId === elementId;
                    }
                  }

                  // 수직 방향 간격 가이드 (상하 간격)
                  if (guide.direction === 'vertical') {
                    // 상하 핸들이 아니면 표시 안 함
                    if (handle.dy === 0) return false;

                    // 드래그 중인 요소와 관련된 가이드만 표시
                    const isDraggedElement =
                      guide.fromElementId === elementId ||
                      guide.toElementId === elementId;

                    if (!isDraggedElement) return false;

                    // 위쪽 핸들(dy: -1): 위쪽 간격만 표시
                    if (handle.dy === -1) {
                      return guide.toElementId === elementId;
                    }
                    // 아래쪽 핸들(dy: 1): 아래쪽 간격만 표시
                    if (handle.dy === 1) {
                      return guide.fromElementId === elementId;
                    }
                  }

                  return false;
                },
              );
              smartGuidesStore.setSpacingGuides(filteredSpacingGuides);
            } else {
              smartGuidesStore.setSpacingGuides([]);
            }
            smartGuidesStore.setSizeMatchGuides([]);
          } else {
            smartGuidesStore.clearGuides();
          }
        }
      }
    }

    // 프리뷰 bounds 업데이트 (실제 요소는 업데이트하지 않음)
    const previewData = {
      x: finalX,
      y: finalY,
      width: finalWidth,
      height: finalHeight,
    };
    setPreviewBounds(previewData);
    finalBoundsRef.current = previewData;
  };

  const handleKeyResizePreview = (
    index: number,
    newBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      handle?: ResizeHandle;
    },
  ) => {
    handleElementResizePreview(
      selectionElementId(
        'key',
        useKeyStore.getState().canonicalPositions[selectedKeyType]?.[index],
        index,
      ),
      newBounds,
    );
  };

  const handleStatResizePreview = (
    index: number,
    newBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      handle?: ResizeHandle;
    },
  ) => {
    handleElementResizePreview(
      selectionElementId(
        'stat',
        useStatItemStore.getState().positions[selectedKeyType]?.[index],
        index,
      ),
      newBounds,
    );
  };

  const handleGraphResizePreview = (
    index: number,
    newBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      handle?: ResizeHandle;
    },
  ) => {
    handleElementResizePreview(
      selectionElementId(
        'graph',
        useGraphItemStore.getState().positions[selectedKeyType]?.[index],
        index,
      ),
      newBounds,
    );
  };

  const handleKnobResizePreview = (
    index: number,
    newBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      handle?: ResizeHandle;
    },
  ) => {
    handleElementResizePreview(
      selectionElementId(
        'knob',
        useKnobItemStore.getState().positions[selectedKeyType]?.[index],
        index,
      ),
      newBounds,
    );
  };

  // 플러그인 요소 리사이즈 처리 (스마트 가이드 포함) - 프리뷰 모드
  const handlePluginResizePreview = (
    fullId: string,
    newBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      handle?: ResizeHandle;
    },
  ) => {
    const smartGuidesStore = useSmartGuidesStore.getState();
    const gridSettings = useSettingsStore.getState().gridSettings;
    const alignmentGuidesEnabled = gridSettings?.alignmentGuides !== false;
    const spacingGuidesEnabled = gridSettings?.spacingGuides !== false;
    const sizeMatchGuidesEnabled = gridSettings?.sizeMatchGuides !== false;

    let finalX = newBounds.x;
    let finalY = newBounds.y;
    let finalWidth = newBounds.width;
    let finalHeight = newBounds.height;

    // 스마트 가이드 계산 (getOtherElements가 제공된 경우, 정렬 가이드가 활성화된 경우)
    if (getOtherElements && alignmentGuidesEnabled) {
      const otherElements = getOtherElements(fullId);

      // 리사이즈 중인 요소의 bounds 계산
      const draggedBounds = calculateBounds(
        newBounds.x,
        newBounds.y,
        newBounds.width,
        newBounds.height,
        fullId,
      );

      const snapResult = calculateSnapPoints(
        draggedBounds,
        otherElements,
        undefined,
        {
          disableSpacing: !spacingGuidesEnabled,
        },
      );
      const handle = newBounds.handle;

      if (handle) {
        // X축 스냅 (간격 스냅인 경우 spacingGuidesEnabled 확인)
        if (
          handle.dx !== 0 &&
          snapResult.didSnapX &&
          !(snapResult.didSpacingSnapX && !spacingGuidesEnabled)
        ) {
          if (handle.dx === -1) {
            const widthDiff = finalX - snapResult.snappedX;
            finalX = snapResult.snappedX;
            finalWidth = finalWidth + widthDiff;
          } else if (handle.dx === 1) {
            const snappedRight = snapResult.snappedX + draggedBounds.width;
            finalWidth = snappedRight - finalX;
          } else if (handle.dx === 0) {
            finalX = snapResult.snappedX;
          }
        }

        // Y축 스냅 (간격 스냅인 경우 spacingGuidesEnabled 확인)
        if (
          handle.dy !== 0 &&
          snapResult.didSnapY &&
          !(snapResult.didSpacingSnapY && !spacingGuidesEnabled)
        ) {
          if (handle.dy === -1) {
            const heightDiff = finalY - snapResult.snappedY;
            finalY = snapResult.snappedY;
            finalHeight = finalHeight + heightDiff;
          } else if (handle.dy === 1) {
            const snappedBottom = snapResult.snappedY + draggedBounds.height;
            finalHeight = snappedBottom - finalY;
          } else if (handle.dy === 0) {
            finalY = snapResult.snappedY;
          }
        }

        // Size Matching: 다른 요소와 동일한 크기로 스냅 (sizeMatchGuidesEnabled 확인)
        if (sizeMatchGuidesEnabled) {
          const sizeSnapResult = calculateSizeSnap(
            finalWidth,
            finalHeight,
            otherElements,
            fullId,
          );

          if (sizeSnapResult.didSnapWidth) {
            if (handle.dx === -1) {
              finalX = finalX - (sizeSnapResult.snappedWidth - finalWidth);
            }
            finalWidth = sizeSnapResult.snappedWidth;
          }

          if (sizeSnapResult.didSnapHeight) {
            if (handle.dy === -1) {
              finalY = finalY - (sizeSnapResult.snappedHeight - finalHeight);
            }
            finalHeight = sizeSnapResult.snappedHeight;
          }

          // 스냅 후 가이드라인 업데이트
          const hasAlignSnap =
            (handle.dx !== 0 &&
              snapResult.didSnapX &&
              !(snapResult.didSpacingSnapX && !spacingGuidesEnabled)) ||
            (handle.dy !== 0 &&
              snapResult.didSnapY &&
              !(snapResult.didSpacingSnapY && !spacingGuidesEnabled));
          const hasSizeSnap =
            sizeSnapResult.didSnapWidth || sizeSnapResult.didSnapHeight;

          if (hasAlignSnap || hasSizeSnap) {
            const snappedBounds = calculateBounds(
              finalX,
              finalY,
              finalWidth,
              finalHeight,
              fullId,
            );
            smartGuidesStore.setDraggedBounds(snappedBounds);

            // 정렬 가이드 업데이트
            if (hasAlignSnap) {
              smartGuidesStore.setActiveGuides(snapResult.guides);
              if (
                spacingGuidesEnabled &&
                snapResult.spacingGuides &&
                snapResult.spacingGuides.length > 0
              ) {
                // 핸들 방향에 따라 간격 가이드 필터링
                const filteredSpacingGuides = snapResult.spacingGuides.filter(
                  (guide) => {
                    // 수평 방향 간격 가이드 (좌우 간격)
                    if (guide.direction === 'horizontal') {
                      // 좌우 핸들이 아니면 표시 안 함
                      if (handle.dx === 0) return false;

                      // 드래그 중인 요소와 관련된 가이드만 표시
                      const isDraggedElement =
                        guide.fromElementId === fullId ||
                        guide.toElementId === fullId;

                      if (!isDraggedElement) return false;

                      // 왼쪽 핸들(dx: -1): 왼쪽 간격만 표시
                      if (handle.dx === -1) {
                        return guide.toElementId === fullId;
                      }
                      // 오른쪽 핸들(dx: 1): 오른쪽 간격만 표시
                      if (handle.dx === 1) {
                        return guide.fromElementId === fullId;
                      }
                    }

                    // 수직 방향 간격 가이드 (상하 간격)
                    if (guide.direction === 'vertical') {
                      // 상하 핸들이 아니면 표시 안 함
                      if (handle.dy === 0) return false;

                      // 드래그 중인 요소와 관련된 가이드만 표시
                      const isDraggedElement =
                        guide.fromElementId === fullId ||
                        guide.toElementId === fullId;

                      if (!isDraggedElement) return false;

                      // 위쪽 핸들(dy: -1): 위쪽 간격만 표시
                      if (handle.dy === -1) {
                        return guide.toElementId === fullId;
                      }
                      // 아래쪽 핸들(dy: 1): 아래쪽 간격만 표시
                      if (handle.dy === 1) {
                        return guide.fromElementId === fullId;
                      }
                    }

                    return false;
                  },
                );
                smartGuidesStore.setSpacingGuides(filteredSpacingGuides);
              } else {
                smartGuidesStore.setSpacingGuides([]);
              }
            } else {
              smartGuidesStore.setActiveGuides([]);
              smartGuidesStore.setSpacingGuides([]);
            }

            // Size Match 가이드 업데이트
            if (hasSizeSnap) {
              smartGuidesStore.setSizeMatchGuides(
                sizeSnapResult.sizeMatchGuides,
              );
            } else {
              smartGuidesStore.setSizeMatchGuides([]);
            }
          } else {
            smartGuidesStore.clearGuides();
          }
        } else {
          // sizeMatchGuides가 비활성화된 경우 기존 정렬 스냅만 처리
          const hasAlignSnap =
            (handle.dx !== 0 &&
              snapResult.didSnapX &&
              !(snapResult.didSpacingSnapX && !spacingGuidesEnabled)) ||
            (handle.dy !== 0 &&
              snapResult.didSnapY &&
              !(snapResult.didSpacingSnapY && !spacingGuidesEnabled));
          if (hasAlignSnap) {
            const snappedBounds = calculateBounds(
              finalX,
              finalY,
              finalWidth,
              finalHeight,
              fullId,
            );
            smartGuidesStore.setDraggedBounds(snappedBounds);
            smartGuidesStore.setActiveGuides(snapResult.guides);
            if (spacingGuidesEnabled && snapResult.spacingGuides?.length > 0) {
              // 핸들 방향에 따라 간격 가이드 필터링
              const filteredSpacingGuides = snapResult.spacingGuides.filter(
                (guide) => {
                  // 수평 방향 간격 가이드 (좌우 간격)
                  if (guide.direction === 'horizontal') {
                    // 좌우 핸들이 아니면 표시 안 함
                    if (handle.dx === 0) return false;

                    // 드래그 중인 요소와 관련된 가이드만 필터링
                    const isDraggedElement =
                      guide.fromElementId === fullId ||
                      guide.toElementId === fullId;

                    if (isDraggedElement) {
                      // 왼쪽 핸들(dx: -1): 왼쪽 간격만 표시
                      if (handle.dx === -1) {
                        return guide.toElementId === fullId;
                      }
                      // 오른쪽 핸들(dx: 1): 오른쪽 간격만 표시
                      if (handle.dx === 1) {
                        return guide.fromElementId === fullId;
                      }
                    }
                    // 다른 요소들 사이의 참조 간격은 항상 표시
                    return !isDraggedElement;
                  }

                  // 수직 방향 간격 가이드 (상하 간격)
                  if (guide.direction === 'vertical') {
                    // 상하 핸들이 아니면 표시 안 함
                    if (handle.dy === 0) return false;

                    // 드래그 중인 요소와 관련된 가이드만 표시
                    const isDraggedElement =
                      guide.fromElementId === fullId ||
                      guide.toElementId === fullId;

                    if (!isDraggedElement) return false;

                    // 위쪽 핸들(dy: -1): 위쪽 간격만 표시
                    if (handle.dy === -1) {
                      return guide.toElementId === fullId;
                    }
                    // 아래쪽 핸들(dy: 1): 아래쪽 간격만 표시
                    if (handle.dy === 1) {
                      return guide.fromElementId === fullId;
                    }
                  }

                  return false;
                },
              );
              smartGuidesStore.setSpacingGuides(filteredSpacingGuides);
            } else {
              smartGuidesStore.setSpacingGuides([]);
            }
            smartGuidesStore.setSizeMatchGuides([]);
          } else {
            smartGuidesStore.clearGuides();
          }
        }
      }
    }

    // 프리뷰 bounds 업데이트 (실제 요소는 업데이트하지 않음)
    const previewData = {
      x: finalX,
      y: finalY,
      width: finalWidth,
      height: finalHeight,
    };
    setPreviewBounds(previewData);
    finalBoundsRef.current = previewData;
  };

  // 통합 리사이즈 핸들러 (키 및 플러그인 요소 지원) - 프리뷰 모드
  const handleResize = (newBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    handle?: ResizeHandle;
  }) => {
    if (selectedElements.length !== 1) return;

    const element = selectedElements[0];
    if (element.type === 'key' && element.index !== undefined) {
      handleKeyResizePreview(element.index, newBounds);
    } else if (element.type === 'stat' && element.index !== undefined) {
      handleStatResizePreview(element.index, newBounds);
    } else if (element.type === 'graph' && element.index !== undefined) {
      handleGraphResizePreview(element.index, newBounds);
    } else if (element.type === 'knob' && element.index !== undefined) {
      handleKnobResizePreview(element.index, newBounds);
    } else if (element.type === 'plugin') {
      handlePluginResizePreview(element.id, newBounds);
    }
  };

  // 리사이즈 종료 처리 - 실제 요소에 최종 bounds 적용
  const handleResizeComplete = () => {
    resizeStartRef.current = false;

    // 스마트 가이드 클리어
    useSmartGuidesStore.getState().clearGuides();

    // 리사이즈 종료 시 애니메이션 복원
    useGridSelectionStore.getState().setDraggingOrResizing(false);

    // 최종 bounds를 실제 요소에 적용
    const finalBounds = finalBoundsRef.current;
    if (finalBounds && selectedElements.length === 1) {
      const element = selectedElements[0];

      if (element.type === 'key' && element.index !== undefined) {
        // 키 요소에 최종 크기 적용 - 커밋 base는 canonical
        const positions = useKeyStore.getState().canonicalPositions;
        const setPositions = useKeyStore.getState().setPositions;
        const current = positions[selectedKeyType] || [];
        const nextPositions: KeyPositions = {
          ...positions,
          [selectedKeyType]: current.map((pos, i) =>
            i === element.index
              ? {
                  ...pos,
                  dx: finalBounds.x,
                  dy: finalBounds.y,
                  width: finalBounds.width,
                  height: finalBounds.height,
                }
              : pos,
          ),
        };
        setPositions(nextPositions);

        // 백엔드에 저장
        window.api.keys.updatePositions(nextPositions).catch((error) => {
          console.error('Failed to update key positions after resize', error);
        });
      } else if (element.type === 'stat' && element.index !== undefined) {
        const statStore = useStatItemStore.getState();
        const statPositions = statStore.positions;
        const current = statPositions[selectedKeyType] || [];
        const nextPositions: StatItemPositions = {
          ...statPositions,
          [selectedKeyType]: current.map((pos, i) =>
            i === element.index
              ? {
                  ...pos,
                  dx: finalBounds.x,
                  dy: finalBounds.y,
                  width: finalBounds.width,
                  height: finalBounds.height,
                }
              : pos,
          ),
        };
        statStore.setPositions(nextPositions);
        window.api.statItems.updatePositions(nextPositions).catch((error) => {
          console.error('Failed to update stat positions after resize', error);
        });
      } else if (element.type === 'graph' && element.index !== undefined) {
        const graphStore = useGraphItemStore.getState();
        const graphPositions = graphStore.positions;
        const current = graphPositions[selectedKeyType] || [];
        const nextPositions: GraphItemPositions = {
          ...graphPositions,
          [selectedKeyType]: current.map((pos, i) =>
            i === element.index
              ? {
                  ...pos,
                  dx: finalBounds.x,
                  dy: finalBounds.y,
                  width: finalBounds.width,
                  height: finalBounds.height,
                }
              : pos,
          ),
        };
        graphStore.setPositions(nextPositions);
        window.api.graphItems.updatePositions(nextPositions).catch((error) => {
          console.error('Failed to update graph positions after resize', error);
        });
      } else if (element.type === 'knob' && element.index !== undefined) {
        const knobStore = useKnobItemStore.getState();
        const knobPositions = knobStore.positions;
        const current = knobPositions[selectedKeyType] || [];
        const nextPositions: KnobItemPositions = {
          ...knobPositions,
          [selectedKeyType]: current.map((pos, i) =>
            i === element.index
              ? {
                  ...pos,
                  dx: finalBounds.x,
                  dy: finalBounds.y,
                  width: finalBounds.width,
                  height: finalBounds.height,
                }
              : pos,
          ),
        };
        knobStore.setPositions(nextPositions);
        window.api.knobItems.updatePositions(nextPositions).catch((error) => {
          console.error('Failed to update knob positions after resize', error);
        });
      } else if (element.type === 'plugin') {
        // 플러그인 요소에 최종 크기 적용
        const pluginStore = usePluginDisplayElementStore.getState();
        pluginStore.updateElement(element.id, {
          position: { x: finalBounds.x, y: finalBounds.y },
          measuredSize: {
            width: finalBounds.width,
            height: finalBounds.height,
          },
        });
      }
    }

    // 프리뷰 상태 클리어
    setPreviewBounds(null);
    finalBoundsRef.current = null;

    try {
      onResizeEnd?.(resizeGestureIdRef.current ?? undefined);
    } finally {
      endPluginResizeSessions();
    }
  };

  // 그룹 리사이즈 핸들러 - 프리뷰 모드
  const handleGroupResize = (result: GroupResizeResult) => {
    setPreviewGroupBounds(result.groupBounds);
    setPreviewElementBounds(result.elementBounds);
    finalGroupBoundsRef.current = {
      groupBounds: result.groupBounds,
      elementBounds: result.elementBounds,
    };
  };

  // 그룹 리사이즈 완료 처리 - 실제 요소들에 최종 bounds 적용
  const handleGroupResizeComplete = () => {
    resizeStartRef.current = false;

    // 스마트 가이드 클리어
    useSmartGuidesStore.getState().clearGuides();

    // 리사이즈 종료 시 애니메이션 복원
    useGridSelectionStore.getState().setDraggingOrResizing(false);

    const finalData = finalGroupBoundsRef.current;
    if (finalData && finalData.elementBounds.length > 0) {
      // 커밋 base는 canonical - rendered에는 다른 세션의 미커밋 프리뷰가 섞일 수 있음
      const positions = useKeyStore.getState().canonicalPositions;
      const setPositions = useKeyStore.getState().setPositions;
      const current = positions[selectedKeyType] || [];
      const pluginStore = usePluginDisplayElementStore.getState();
      const statStore = useStatItemStore.getState();
      const statPositions = statStore.positions;
      const currentStats = statPositions[selectedKeyType] || [];
      const graphStore = useGraphItemStore.getState();
      const graphPositions = graphStore.positions;
      const currentGraphs = graphPositions[selectedKeyType] || [];
      const knobStore = useKnobItemStore.getState();
      const knobPositions = knobStore.positions;
      const currentKnobs = knobPositions[selectedKeyType] || [];
      // 프리뷰 값을 그대로 사용 (스냅은 이미 드래그 중에 적용됨)
      // 추가 스냅 적용 시 프리뷰와 최종 위치가 달라지는 문제 발생

      // 키 요소들 업데이트
      const keyUpdates = finalData.elementBounds.filter(
        ({ element }) => element.type === 'key' && element.index !== undefined,
      );

      if (keyUpdates.length > 0) {
        const nextPositions: KeyPositions = {
          ...positions,
          [selectedKeyType]: current.map((pos, i) => {
            const update = keyUpdates.find(
              ({ element }) => element.index === i,
            );
            if (update) {
              return {
                ...pos,
                dx: update.bounds.x,
                dy: update.bounds.y,
                width: update.bounds.width,
                height: update.bounds.height,
              };
            }
            return pos;
          }),
        };
        setPositions(nextPositions);
      }

      // 통계 요소들 업데이트
      const statUpdates = finalData.elementBounds.filter(
        ({ element }) => element.type === 'stat' && element.index !== undefined,
      );

      if (statUpdates.length > 0) {
        const nextStatPositions: StatItemPositions = {
          ...statPositions,
          [selectedKeyType]: currentStats.map((pos, i) => {
            const update = statUpdates.find(
              ({ element }) => element.index === i,
            );
            if (update) {
              return {
                ...pos,
                dx: update.bounds.x,
                dy: update.bounds.y,
                width: update.bounds.width,
                height: update.bounds.height,
              };
            }
            return pos;
          }),
        };

        statStore.setPositions(nextStatPositions);
      }

      // 그래프 요소들 업데이트
      const graphUpdates = finalData.elementBounds.filter(
        ({ element }) =>
          element.type === 'graph' && element.index !== undefined,
      );

      if (graphUpdates.length > 0) {
        const nextGraphPositions: GraphItemPositions = {
          ...graphPositions,
          [selectedKeyType]: currentGraphs.map((pos, i) => {
            const update = graphUpdates.find(
              ({ element }) => element.index === i,
            );
            if (update) {
              return {
                ...pos,
                dx: update.bounds.x,
                dy: update.bounds.y,
                width: update.bounds.width,
                height: update.bounds.height,
              };
            }
            return pos;
          }),
        };

        graphStore.setPositions(nextGraphPositions);
      }

      // 노브 요소들 업데이트
      const knobUpdates = finalData.elementBounds.filter(
        ({ element }) => element.type === 'knob' && element.index !== undefined,
      );

      if (knobUpdates.length > 0) {
        const nextKnobPositions: KnobItemPositions = {
          ...knobPositions,
          [selectedKeyType]: currentKnobs.map((pos, i) => {
            const update = knobUpdates.find(
              ({ element }) => element.index === i,
            );
            if (update) {
              return {
                ...pos,
                dx: update.bounds.x,
                dy: update.bounds.y,
                width: update.bounds.width,
                height: update.bounds.height,
              };
            }
            return pos;
          }),
        };

        knobStore.setPositions(nextKnobPositions);
      }

      // 플러그인 요소들 업데이트
      const pluginUpdates = finalData.elementBounds.filter(
        ({ element }) => element.type === 'plugin',
      );

      for (const { element, bounds } of pluginUpdates) {
        pluginStore.updateElement(element.id, {
          position: { x: bounds.x, y: bounds.y },
          measuredSize: {
            width: bounds.width,
            height: bounds.height,
          },
        });
      }
    }

    // 프리뷰 상태 클리어
    setPreviewGroupBounds(null);
    setPreviewElementBounds(null);
    finalGroupBoundsRef.current = null;

    try {
      onResizeEnd?.(resizeGestureIdRef.current ?? undefined);
    } finally {
      endPluginResizeSessions();
    }
  };

  return {
    handleResizeStart,
    handleResize,
    handleResizeComplete,
    previewBounds,
    // 그룹 리사이즈 관련
    handleGroupResize,
    handleGroupResizeComplete,
    previewGroupBounds,
    previewElementBounds,
  };
}
