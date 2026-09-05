import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import {
  reportElementOpError,
  reportElementOpSkipped,
  type ElementIntentReceipt,
  type PropertyIntents,
} from '@src/renderer/editor/runtime/elementIntent';
import type { EditorOpV1 } from '@src/types/editor';
import { runMixedElementOpsIntent } from '@src/renderer/editor/runtime/mixedElementIntent';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import {
  applyBoundsIntentsEagerly,
  commitElementBoundsById,
  commitSingleElementBoundsById,
  elementBoundsOp,
} from '@src/renderer/editor/runtime/elementOps';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import {
  isHistoryEditorFlushLocked,
  subscribeHistoryEditorFlushStart,
} from '@src/renderer/editor/runtime/historyEditorFlushLock';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import {
  calculateBounds,
  calculateSnapPoints,
  calculateSizeSnap,
} from '@utils/grid/smartGuides';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import type { ElementBounds } from '@utils/grid/smartGuides';
import {
  exactSizeFor,
  scaleBoundsAnchored,
  settleAspectScale,
  type AspectPrimaryAxis,
  type ScaleRange,
} from '@components/main/Grid/handles/aspectResize';
import type { ResizeBounds as AspectStartBounds } from '@components/main/Grid/handles/resizeLimits';
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
  getOtherElements?: (excludeId: string) => ElementBounds[];
}

/**
 * 그리드에서 키 및 플러그인 요소 리사이즈를 처리하는 훅
 * 드래그 중에는 프리뷰 bounds만 업데이트하고, 드래그 종료 시 실제 크기를 적용하여
 * 시각적 흔들림을 방지합니다.
 */
export function useGridResize({
  selectedElements,
  getOtherElements,
}: UseGridResizeOptions) {
  const resizeStartRef = useRef(false);
  const pluginResizeTokensRef = useRef(new Map<string, string>());
  const resizeGestureIdRef = useRef<string | null>(null);
  // 드래그 중 프리뷰 bounds (드래그 중일 때만 값이 있음)
  const [previewBounds, setPreviewBounds] = useState<ResizeBounds | null>(null);
  // 최종 적용할 bounds를 저장 (드래그 종료 시 사용)
  const finalBoundsRef = useRef<ResizeBounds | null>(null);
  const frozenResizeTargetsRef = useRef<Array<{ type: string; id: string }>>(
    [],
  );

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

  // plugin-only·혼합 완료의 오버레이 동기화 - editor 커밋과 분리
  const syncPluginElementsToOverlay = () => {
    sendBridgeMessageBestEffort('overlay', 'plugin:displayElements:sync', {
      elements: usePluginDisplayElementStore.getState().elements,
    });
  };

  const endPluginResizeSessions = useCallback(() => {
    const tokens = pluginResizeTokensRef.current;
    pluginResizeTokensRef.current = new Map();
    tokens.forEach((token, pluginId) => {
      endPluginInstancesEditSession(pluginId, token);
    });
    // 완료 경로가 혼합 커밋을 타지 않은 경우의 staged 잔존 정산
    const gestureId = resizeGestureIdRef.current;
    if (gestureId) cancelUncommittedMixedGestureTransaction(gestureId);
    resizeGestureIdRef.current = null;
  }, []);

  const cancelResize = useCallback(() => {
    resizeStartRef.current = false;
    frozenResizeTargetsRef.current = [];
    finalBoundsRef.current = null;
    finalGroupBoundsRef.current = null;
    setPreviewBounds(null);
    setPreviewGroupBounds(null);
    setPreviewElementBounds(null);
    useGridSelectionStore.getState().setResizing(false);
    useSmartGuidesStore.getState().clearGuides();
    endPluginResizeSessions();
  }, [endPluginResizeSessions]);

  useEffect(
    () =>
      useCommittedApplyStore.subscribe((state, previous) => {
        if (
          state.historyTick === previous.historyTick ||
          !resizeStartRef.current
        )
          return;
        cancelResize();
      }),
    [cancelResize],
  );

  useEffect(
    () =>
      subscribeHistoryEditorFlushStart(() => {
        if (resizeStartRef.current) cancelResize();
      }),
    [cancelResize],
  );

  useEffect(
    () => () => {
      const gestureId = resizeGestureIdRef.current;
      if (resizeStartRef.current) {
        resizeStartRef.current = false;
        useGridSelectionStore.getState().setResizing(false);
      }
      endPluginResizeSessions();
      if (gestureId) cancelUncommittedMixedGestureTransaction(gestureId);
    },
    [endPluginResizeSessions],
  );

  const handleResizeStart = (_handle?: ResizeHandle) => {
    if (resizeStartRef.current || isHistoryEditorFlushLocked()) return;
    resizeStartRef.current = true;
    const gestureId = crypto.randomUUID();
    resizeGestureIdRef.current = gestureId;
    // 시작 대상 동결 - 완료 시 live 선택을 다시 읽으면 리사이즈 중 같은
    // 개수의 다른 선택으로 바뀐 경우 남의 요소에 bounds가 적용된다
    frozenResizeTargetsRef.current = selectedElements.map((element) => ({
      type: element.type,
      id: element.id,
    }));
    beginPluginResizeSessions(gestureId);
    if (pluginResizeTokensRef.current.size > 0) {
      beginMixedGestureTransaction(gestureId, [
        ...pluginResizeTokensRef.current.keys(),
      ]);
    }

    // 기존 스마트 가이드 클리어
    useSmartGuidesStore.getState().clearGuides();

    // 리사이즈 시작 시 애니메이션 비활성화
    useGridSelectionStore.getState().setResizing(true);
  };

  // 공용 리사이즈 프리뷰 처리 (스마트 가이드 포함) - native·플러그인 단일 리사이즈가 함께 쓴다
  const handleElementResizePreview = (
    elementId: string,
    newBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      handle?: ResizeHandle;
      suppressSmartSnap?: boolean;
      /** 비율 고정 - 기준 축만 스냅하고 반대 축은 같은 배율로 다시 구한다 */
      aspect?: {
        start: AspectStartBounds;
        primary: AspectPrimaryAxis;
        range: ScaleRange;
      };
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

    // 스마트 가이드 계산 - modifier 유지 중에는 일시 해제하고 그리드 스냅만 남긴다
    if (newBounds.suppressSmartSnap) {
      useSmartGuidesStore.getState().clearGuides();
    } else if (getOtherElements && alignmentGuidesEnabled) {
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
          gridSnapSize: gridSettings?.gridSnapSize ?? 5,
        },
      );
      const handle = newBounds.handle;
      const aspect = newBounds.aspect;

      if (handle) {
        // 비율 고정 중에는 기준 축의 스냅만 받는다 - 반대 축은 같은 배율로 다시 구한다
        const snapWidthAllowed = !aspect || aspect.primary === 'width';
        const snapHeightAllowed = !aspect || aspect.primary === 'height';

        // 반영한 축만 가이드를 그린다 - 비율 고정이 무시한 반대 축과 clamp에 잘린 스냅 제외
        // (잡지 않은 축은 정렬 후보가 있어도 위치를 안 옮긴다)
        let appliedSnapX = false;
        let appliedSnapY = false;

        // X축 스냅 (간격 스냅인 경우 spacingGuidesEnabled 확인)
        const alignSnapX =
          handle.dx !== 0 &&
          snapWidthAllowed &&
          snapResult.didSnapX &&
          !(snapResult.didSpacingSnapX && !spacingGuidesEnabled);
        if (alignSnapX) {
          appliedSnapX = true;
          if (handle.dx === -1) {
            // 왼쪽 핸들: 왼쪽 가장자리 스냅
            const widthDiff = finalX - snapResult.snappedX;
            finalX = snapResult.snappedX;
            finalWidth = finalWidth + widthDiff;
          } else if (handle.dx === 1) {
            // 오른쪽 핸들: 오른쪽 가장자리 스냅
            const snappedRight = snapResult.snappedX + draggedBounds.width;
            finalWidth = snappedRight - finalX;
          }
        }

        // Y축 스냅 (간격 스냅인 경우 spacingGuidesEnabled 확인)
        const alignSnapY =
          handle.dy !== 0 &&
          snapHeightAllowed &&
          snapResult.didSnapY &&
          !(snapResult.didSpacingSnapY && !spacingGuidesEnabled);
        if (alignSnapY) {
          appliedSnapY = true;
          if (handle.dy === -1) {
            // 위쪽 핸들: 위쪽 가장자리 스냅
            const heightDiff = finalY - snapResult.snappedY;
            finalY = snapResult.snappedY;
            finalHeight = finalHeight + heightDiff;
          } else if (handle.dy === 1) {
            // 아래쪽 핸들: 아래쪽 가장자리 스냅
            const snappedBottom = snapResult.snappedY + draggedBounds.height;
            finalHeight = snappedBottom - finalY;
          }
        }

        // 크기 일치 스냅 - 잡은 핸들이 움직이는 축만 (가로 핸들은 높이를 안 바꾼다)
        const sizeSnapResult = sizeMatchGuidesEnabled
          ? calculateSizeSnap(
              finalWidth,
              finalHeight,
              otherElements,
              elementId,
              {
                matchWidth: handle.dx !== 0 && snapWidthAllowed,
                matchHeight: handle.dy !== 0 && snapHeightAllowed,
              },
            )
          : null;
        if (sizeSnapResult?.didSnapWidth) {
          // 핸들 방향에 따라 크기 조정
          if (handle.dx === -1) {
            // 왼쪽 핸들: 왼쪽 가장자리를 조정
            finalX = finalX - (sizeSnapResult.snappedWidth - finalWidth);
          }
          finalWidth = sizeSnapResult.snappedWidth;
        }
        if (sizeSnapResult?.didSnapHeight) {
          if (handle.dy === -1) {
            // 위쪽 핸들: 위쪽 가장자리를 조정
            finalY = finalY - (sizeSnapResult.snappedHeight - finalHeight);
          }
          finalHeight = sizeSnapResult.snappedHeight;
        }

        // 비율 고정 - 스냅된 기준 축 크기로 배율을 다시 구해 두 축을 함께 놓는다
        // (배율이 범위에 잘리면 그 스냅은 화면에 없으니 가이드도 뺀다)
        let aspectSnapDropped = false;
        if (aspect) {
          const axisHandle = {
            dx: Math.sign(handle.dx) as -1 | 0 | 1,
            dy: Math.sign(handle.dy) as -1 | 0 | 1,
          };
          const startSize =
            aspect.primary === 'width'
              ? aspect.start.width
              : aspect.start.height;
          const requestedSize =
            aspect.primary === 'width' ? finalWidth : finalHeight;
          const requested = requestedSize / startSize;
          const exact = { axis: aspect.primary, size: requestedSize };
          const scale = settleAspectScale(
            aspect.start,
            requested,
            axisHandle,
            aspect.range,
            exact,
          );
          aspectSnapDropped = scale !== requested;
          const scaled = scaleBoundsAnchored(
            aspect.start,
            scale,
            axisHandle,
            exactSizeFor(aspect.start, scale, requested, exact),
          );
          finalX = scaled.x;
          finalY = scaled.y;
          finalWidth = scaled.width;
          finalHeight = scaled.height;
        }

        if (aspectSnapDropped) {
          appliedSnapX = false;
          appliedSnapY = false;
        }
        const hasAlignSnap = (alignSnapX || alignSnapY) && !aspectSnapDropped;
        const hasSizeSnap =
          (sizeSnapResult?.didSnapWidth === true ||
            sizeSnapResult?.didSnapHeight === true) &&
          !aspectSnapDropped;

        if (hasAlignSnap || hasSizeSnap) {
          // 스냅 후 bounds로 가이드라인 업데이트
          const snappedBounds = calculateBounds(
            finalX,
            finalY,
            finalWidth,
            finalHeight,
            elementId,
          );
          smartGuidesStore.setDraggedBounds(snappedBounds);

          // 정렬 가이드 업데이트 - 적용된 축의 가이드만
          if (hasAlignSnap) {
            smartGuidesStore.setActiveGuides(
              snapResult.guides.filter((guide) =>
                guide.type === 'vertical' ? appliedSnapX : appliedSnapY,
              ),
            );
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
                    // 좌우 핸들이 아니거나 그 축 스냅을 안 썼으면 표시 안 함
                    if (handle.dx === 0 || !appliedSnapX) return false;

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
                    // 상하 핸들이 아니거나 그 축 스냅을 안 썼으면 표시 안 함
                    if (handle.dy === 0 || !appliedSnapY) return false;

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
          smartGuidesStore.setSizeMatchGuides(
            hasSizeSnap && sizeSnapResult ? sizeSnapResult.sizeMatchGuides : [],
          );
        } else {
          smartGuidesStore.clearGuides();
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
    suppressSmartSnap?: boolean;
    aspect?: {
      start: AspectStartBounds;
      primary: AspectPrimaryAxis;
      range: ScaleRange;
    };
  }) => {
    if (!resizeStartRef.current || selectedElements.length !== 1) return;

    const frozenTarget = frozenResizeTargetsRef.current[0];
    if (
      frozenResizeTargetsRef.current.length === 1 &&
      frozenTarget &&
      frozenTarget.type !== 'plugin' &&
      isNativeElementId(frozenTarget.id)
    ) {
      handleElementResizePreview(frozenTarget.id, newBounds);
      return;
    }
    if (frozenTarget?.type === 'plugin') {
      // 플러그인도 같은 스냅·비율 재유도 경로 - 프리뷰 계산은 요소 종류와 무관하다
      handleElementResizePreview(frozenTarget.id, newBounds);
    }
  };

  // 리사이즈 종료 처리 - 실제 요소에 최종 bounds 적용
  const handleResizeComplete = () => {
    if (!resizeStartRef.current) return;
    if (isHistoryEditorFlushLocked()) {
      cancelResize();
      return;
    }
    resizeStartRef.current = false;

    // 스마트 가이드 클리어
    useSmartGuidesStore.getState().clearGuides();

    // 리사이즈 종료 시 애니메이션 복원
    useGridSelectionStore.getState().setResizing(false);

    // 최종 bounds를 실제 요소에 적용
    const finalBounds = finalBoundsRef.current;
    const frozenTargets = frozenResizeTargetsRef.current;
    frozenResizeTargetsRef.current = [];
    // 단일 native 정산의 무커밋 사유를 상호배타로 판정해 정확히 1회만 보고한다.
    // 그룹 정산은 handleGroupResizeComplete 소관이라 여기서 보고하지 않는다
    const singleNative =
      frozenTargets.length === 1 && frozenTargets[0].type !== 'plugin'
        ? frozenTargets[0]
        : null;
    if (singleNative && !isNativeElementId(singleNative.id)) {
      // 합성 id는 시작 fingerprint 배관이 없어 fail-closed 무커밋.
      // handleResize도 같은 이유로 프리뷰를 만들지 않아 finalBounds가 없다
      reportElementOpSkipped('resize settlement (invalid native id)');
    } else if (singleNative && !finalBounds) {
      // 프리뷰가 한 번도 계산되지 않아 적용할 bounds가 없다
      reportElementOpSkipped('resize settlement (no preview bounds)');
    }
    if (finalBounds && frozenTargets.length === 1) {
      const element = frozenTargets[0] as {
        type: 'key' | 'stat' | 'graph' | 'knob' | 'sprite' | 'plugin';
        id: string;
        index?: number;
      };

      if (element.type !== 'plugin' && isNativeElementId(element.id)) {
        // 시작 시 동결한 안정 id에 최종 bounds를 하나의 의도로 커밋 -
        // eager·wire·receipt를 같은 의도가 소유한다 (live 선택 재조회 금지)
        void commitSingleElementBoundsById(
          element.type,
          element.id,
          {
            dx: finalBounds.x,
            dy: finalBounds.y,
            width: finalBounds.width,
            height: finalBounds.height,
          },
          resizeGestureIdRef.current ?? undefined,
        ).catch(reportElementOpError);
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

    // 정산은 시작 시 동결한 구성으로 여기서 완결 - 완료 시점 live 선택을
    // 읽는 외부 콜백 금지. plugin이 움직였으면 오버레이만 동기화
    // (plugin-only는 editor 무커밋 계약)
    if (frozenTargets.some((target) => target.type === 'plugin')) {
      syncPluginElementsToOverlay();
    }
    endPluginResizeSessions();
  };

  // 그룹 리사이즈 핸들러 - 프리뷰 모드
  const handleGroupResize = (result: GroupResizeResult) => {
    if (!resizeStartRef.current) return;
    setPreviewGroupBounds(result.groupBounds);
    setPreviewElementBounds(result.elementBounds);
    finalGroupBoundsRef.current = {
      groupBounds: result.groupBounds,
      elementBounds: result.elementBounds,
    };
  };

  // 그룹 리사이즈 완료 처리 - 실제 요소들에 최종 bounds 적용
  const handleGroupResizeComplete = () => {
    if (!resizeStartRef.current) return;
    if (isHistoryEditorFlushLocked()) {
      cancelResize();
      return;
    }
    resizeStartRef.current = false;
    let groupHandledNatively = false;
    let groupPluginInvolved = false;
    let groupHasNative = false;
    let groupSettlement:
      | {
          kind: 'intents';
          stableIntents: PropertyIntents;
          receipt: ElementIntentReceipt | null;
        }
      | { kind: 'failClosed' }
      | null = null;
    frozenResizeTargetsRef.current = [];

    // 스마트 가이드 클리어
    useSmartGuidesStore.getState().clearGuides();

    // 리사이즈 종료 시 애니메이션 복원
    useGridSelectionStore.getState().setResizing(false);

    const finalData = finalGroupBoundsRef.current;
    if (finalData && finalData.elementBounds.length > 0) {
      const pluginStore = usePluginDisplayElementStore.getState();
      // 프리뷰 값을 그대로 사용 (스냅은 이미 드래그 중에 적용됨)
      // 추가 스냅 적용 시 프리뷰와 최종 위치가 달라지는 문제 발생

      // 시작 시 동결된 entries(elementBounds)의 안정 id에 최종 bounds 의도
      // 구성. native-only는 전용 의도 커밋이 eager와 wire를 함께 소유하고,
      // plugin 혼합은 eager receipt와 슬롯 generator가 각 경계를 소유한다
      const stableBoundsIntents = new Map<
        'key' | 'stat' | 'graph' | 'knob' | 'sprite',
        Map<string, Record<string, number>>
      >();
      const isStableEntry = (element: { type: string; id: string }): boolean =>
        element.type !== 'plugin' && isNativeElementId(element.id);
      for (const { element, bounds } of finalData.elementBounds) {
        if (!isStableEntry(element)) continue;
        const type = element.type as
          | 'key'
          | 'stat'
          | 'graph'
          | 'knob'
          | 'sprite';
        const byId = stableBoundsIntents.get(type) ?? new Map();
        byId.set(element.id, {
          dx: bounds.x,
          dy: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        stableBoundsIntents.set(type, byId);
      }
      const pluginInvolved = finalData.elementBounds.some(
        ({ element }) => element.type === 'plugin',
      );
      const hasInvalidNative = finalData.elementBounds.some(
        ({ element }) =>
          element.type !== 'plugin' && !isNativeElementId(element.id),
      );
      const allStable = finalData.elementBounds.every(({ element }) =>
        element.type === 'plugin' ? true : isStableEntry(element),
      );
      groupPluginInvolved = pluginInvolved && !hasInvalidNative;
      groupHasNative = finalData.elementBounds.some(
        ({ element }) => element.type !== 'plugin',
      );

      if (hasInvalidNative) {
        groupSettlement = { kind: 'failClosed' };
      } else if (!pluginInvolved && allStable && stableBoundsIntents.size > 0) {
        groupHandledNatively = true;
        void commitElementBoundsById(
          stableBoundsIntents,
          resizeGestureIdRef.current ?? undefined,
        ).catch(reportElementOpError);
      } else {
        groupSettlement = {
          kind: 'intents',
          stableIntents: stableBoundsIntents,
          // 스프라이트는 projection이 콘텐츠 스케일까지 eager·receipt에 싣는다
          receipt: applyBoundsIntentsEagerly(stableBoundsIntents),
        };
      }

      // 플러그인 요소들 업데이트
      const pluginUpdates = finalData.elementBounds.filter(
        ({ element }) => element.type === 'plugin',
      );

      if (!hasInvalidNative) {
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
    }

    // 프리뷰 상태 클리어
    setPreviewGroupBounds(null);
    setPreviewElementBounds(null);
    finalGroupBoundsRef.current = null;

    // 정산 완결 - 완료 시점 live 선택 금지. wire patch는 coordinator 직렬
    // 슬롯 안에서 시작 동결 의도(안정 id + fingerprint 증명된 index)를 최신
    // base에 재생성한다 - 호출 시점 full-record 캡처는 대기 중 정산된 격리
    // plugin 쓰기의 다른 필드를 되돌린다. 혼합은 시작 plugin ID 집합과 mixed
    // 트랜잭션으로 / plugin-only: editor 무커밋 + 오버레이 동기화
    const settlementGestureId = resizeGestureIdRef.current ?? undefined;
    if (
      !groupHandledNatively &&
      groupHasNative &&
      groupSettlement &&
      groupSettlement.kind === 'failClosed'
    ) {
      // native ID 검증 실패 - 편집 전체 무커밋
      reportElementOpSkipped('group resize settlement');
    } else if (
      !groupHandledNatively &&
      groupHasNative &&
      groupSettlement &&
      groupSettlement.kind === 'intents'
    ) {
      const settlement = groupSettlement;
      if (groupPluginInvolved && settlementGestureId) {
        const frozenPluginIds = [...pluginResizeTokensRef.current.keys()];
        const ops: EditorOpV1[] = [];
        for (const [elementType, byId] of settlement.stableIntents) {
          for (const [id, bounds] of byId) {
            ops.push(
              elementBoundsOp(elementType, id, {
                dx: bounds.dx as number,
                dy: bounds.dy as number,
                width: bounds.width as number,
                height: bounds.height as number,
              }),
            );
          }
        }
        void runMixedElementOpsIntent({
          gestureId: settlementGestureId,
          pluginIds: frozenPluginIds,
          ops,
          receipt: settlement.receipt,
        }).catch(reportElementOpError);
      }
    } else if (
      !groupHandledNatively &&
      !groupHasNative &&
      groupPluginInvolved &&
      groupSettlement?.kind === 'intents' &&
      settlementGestureId
    ) {
      void runMixedElementOpsIntent({
        gestureId: settlementGestureId,
        pluginIds: [...pluginResizeTokensRef.current.keys()],
        ops: [],
        receipt: groupSettlement.receipt,
      }).catch(reportElementOpError);
    }
    if (groupPluginInvolved) {
      syncPluginElementsToOverlay();
    }
    endPluginResizeSessions();
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
