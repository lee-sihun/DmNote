import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type {
  ElementResizeAnchor,
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';
import { measureConnectedPluginElement } from '@utils/plugin/pluginElementMeasurement';
import { calculatePluginAnchorOffset } from '@utils/plugin/pluginElementLayout';
import { attachPluginDomInteractions } from '@utils/plugin/pluginDomInteractions';

interface UsePluginElementMeasurementRuntimeOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  shadowRoot: ShadowRoot | null;
  renderedContent: unknown;
  element: PluginDisplayElementInternal;
  definition: PluginDefinitionInternal | undefined;
  windowType: 'main' | 'overlay';
  zoom: number;
  updateElement: (
    fullId: string,
    updates: Partial<PluginDisplayElementInternal>,
    options?: { skipSync?: boolean },
  ) => void;
}

export const usePluginElementMeasurementRuntime = ({
  containerRef,
  shadowRoot,
  renderedContent,
  element,
  definition,
  windowType,
  zoom,
  updateElement,
}: UsePluginElementMeasurementRuntimeOptions): void => {
  // 이전 크기를 추적하여 리사이즈 앵커 기반 위치 보정에 사용
  // 초기값으로 element.measuredSize를 사용하여 리로드 후에도 올바르게 동작
  const prevMeasuredSizeRef = useRef<{ width: number; height: number } | null>(
    element.measuredSize ? { ...element.measuredSize } : null,
  );

  // 이전 앵커를 추적하여 앵커 변경 시 prevMeasuredSizeRef 리셋
  const prevAnchorRef = useRef<string | undefined>(
    element.resizeAnchor || definition?.resizeAnchor || 'top-left',
  );

  // 이전 줌 값을 추적하여 줌 변경 시 위치 보정을 스킵
  const prevZoomRef = useRef<number>(zoom);

  // Settings 변경 시 measuredSize 리셋 (main 윈도우, resizable 요소만)
  // 설정 변경으로 UI가 변할 수 있으므로 새로 측정하도록 함
  const prevSettingsForResizeRef = useRef<Record<string, unknown> | null>(null);
  // 설정 변경으로 재측정이 필요한 상태인지 플래그
  const needsRemeasureRef = useRef(false);
  // 사용자가 설정한(또는 초기 측정된) preserveAxis 축의 크기
  // 이 값은 리사이즈나 초기 측정 시에만 업데이트되고, 설정 변경 시에는 유지됨
  const userPreservedSizeRef = useRef<{
    width: number;
    height: number;
  } | null>(null);
  // 설정별 크기 히스토리 (설정 JSON -> 크기 매핑)
  const settingsSizeHistoryRef = useRef<
    Map<string, { width: number; height: number }>
  >(new Map());

  // 앵커가 변경되면 prevMeasuredSizeRef를 현재 크기로 리셋
  // 이렇게 하면 앵커 변경 직후의 크기 변화에서 불필요한 위치 보정이 발생하지 않음
  useEffect(() => {
    const currentAnchor =
      element.resizeAnchor || definition?.resizeAnchor || 'top-left';
    if (prevAnchorRef.current !== currentAnchor) {
      // 앵커가 변경됨 - 현재 측정된 크기로 리셋
      if (element.measuredSize) {
        prevMeasuredSizeRef.current = { ...element.measuredSize };
      }
      prevAnchorRef.current = currentAnchor;
    }
  }, [element.resizeAnchor, definition?.resizeAnchor, element.measuredSize]);

  // element.measuredSize가 외부에서 변경될 때(리사이즈 등) userPreservedSizeRef 업데이트
  // 단, needsRemeasure 상태가 아닐 때만 (설정 변경으로 인한 재측정 중에는 스킵)
  useEffect(() => {
    if (
      windowType === 'main' &&
      definition?.resizable &&
      element.measuredSize &&
      !needsRemeasureRef.current
    ) {
      userPreservedSizeRef.current = { ...element.measuredSize };
    }
  }, [windowType, definition?.resizable, element.measuredSize]);

  useEffect(() => {
    if (windowType !== 'main') return;
    if (!definition?.resizable) return;

    const currentSettings = element.settings || {};
    const prevSettings = prevSettingsForResizeRef.current;

    // 최초 마운트 시에는 이전 설정 저장만
    if (prevSettings === null) {
      prevSettingsForResizeRef.current = { ...currentSettings };
      // 초기 설정에 대한 크기 저장
      if (element.measuredSize) {
        const settingsKey = JSON.stringify(currentSettings);
        settingsSizeHistoryRef.current.set(settingsKey, {
          ...element.measuredSize,
        });
      }
      return;
    }

    // 설정이 실제로 변경되었는지 확인 (JSON 문자열 비교)
    const currentStr = JSON.stringify(currentSettings);
    const prevStr = JSON.stringify(prevSettings);
    const hasChanged = currentStr !== prevStr;

    if (hasChanged) {
      // 이전 설정에 대한 현재 크기 저장 (나중에 복원용)
      if (element.measuredSize) {
        settingsSizeHistoryRef.current.set(prevStr, {
          ...element.measuredSize,
        });
      }

      // 현재 설정에 대해 저장된 크기가 있으면 복원, 없으면 재측정
      const savedSize = settingsSizeHistoryRef.current.get(currentStr);
      if (savedSize) {
        // 저장된 크기로 즉시 복원 (width, height도 함께 업데이트)
        const currentSize = element.measuredSize;
        const resizeAnchor: ElementResizeAnchor =
          element.resizeAnchor || definition?.resizeAnchor || 'top-left';

        // 앵커 기반 위치 보정 계산
        let newPosition = element.position;
        if (currentSize && resizeAnchor !== 'top-left') {
          const { dx, dy } = calculatePluginAnchorOffset(
            resizeAnchor,
            currentSize,
            savedSize,
          );
          if (dx !== 0 || dy !== 0) {
            newPosition = {
              x: element.position.x + dx,
              y: element.position.y + dy,
            };
          }
        }

        updateElement(element.fullId, {
          measuredSize: savedSize,
          width: savedSize.width,
          height: savedSize.height,
          position: newPosition,
        });
        prevMeasuredSizeRef.current = savedSize;
      } else {
        // 재측정 필요 플래그 설정
        needsRemeasureRef.current = true;
      }

      // 이전 설정 업데이트
      prevSettingsForResizeRef.current = { ...currentSettings };
    }
  }, [
    windowType,
    definition?.resizable,
    definition?.resizeAnchor,
    element.settings,
    element.fullId,
    element.measuredSize,
    element.position,
    element.resizeAnchor,
    updateElement,
  ]);

  // 이벤트 위임 (메인 윈도우에서만)
  useEffect(() => {
    const target = element.scoped ? shadowRoot : containerRef.current;
    if (!target) return;

    let measurementFrame: number | null = null;

    // 메인 윈도우에서만 실제 크기 측정 후 store 업데이트
    // resizable인 경우: 이미 measuredSize가 있고 재측정이 필요하지 않으면 스킵
    const isResizableWithSize =
      definition?.resizable &&
      element.measuredSize &&
      !needsRemeasureRef.current;

    if (windowType === 'main' && containerRef.current && !isResizableWithSize) {
      const measurementTarget = containerRef.current;
      measurementFrame = requestAnimationFrame(() => {
        measurementFrame = null;
        if (containerRef.current === measurementTarget) {
          // 재측정이 필요한 경우, 일시적으로 크기 제약을 풀어 자연스러운 콘텐츠 크기 측정
          const needsRemeasure =
            needsRemeasureRef.current && definition?.resizable;
          const preserveAxis = definition?.preserveAxis || 'both';

          let originalWidth = '';
          let originalHeight = '';

          if (needsRemeasure) {
            originalWidth = containerRef.current.style.width;
            originalHeight = containerRef.current.style.height;

            // preserveAxis에 따라 해제할 축 결정
            if (preserveAxis !== 'width' && preserveAxis !== 'both') {
              containerRef.current.style.width = 'auto';
            }
            if (preserveAxis !== 'height' && preserveAxis !== 'both') {
              containerRef.current.style.height = 'auto';
            }
          }

          const measuredSize = measureConnectedPluginElement(
            measurementTarget,
            zoom,
          );

          // 스타일 복원
          if (needsRemeasure) {
            containerRef.current.style.width = originalWidth;
            containerRef.current.style.height = originalHeight;
          }

          if (!measuredSize) return;

          const measuredWidth = measuredSize.width;
          const measuredHeight = measuredSize.height;

          // 설정 변경으로 인한 재측정인 경우, preserveAxis에 해당하는 축은 유지
          let finalWidth = measuredWidth;
          let finalHeight = measuredHeight;
          const userPreservedSize = userPreservedSizeRef.current;

          if (definition?.resizable && needsRemeasureRef.current) {
            // preserveAxis에 따라 각 축 유지 여부 결정
            const shouldPreserveWidth =
              preserveAxis === 'width' || preserveAxis === 'both';
            const shouldPreserveHeight =
              preserveAxis === 'height' || preserveAxis === 'both';

            // 가로: 유지 설정이고 저장된 값이 있으면 그 값 사용
            if (shouldPreserveWidth && userPreservedSize) {
              finalWidth = userPreservedSize.width;
            }
            // 세로: 유지 설정이고 저장된 값이 있으면 그 값 사용
            if (shouldPreserveHeight && userPreservedSize) {
              finalHeight = userPreservedSize.height;
            }
            needsRemeasureRef.current = false;
          }

          // 초기 측정 시 또는 콘텐츠가 커진 경우 userPreservedSizeRef 업데이트
          if (!userPreservedSize) {
            userPreservedSizeRef.current = {
              width: finalWidth,
              height: finalHeight,
            };
          }

          const newSize = { width: finalWidth, height: finalHeight };

          // 줌이 변경되었는지 확인
          const zoomChanged = prevZoomRef.current !== zoom;
          prevZoomRef.current = zoom;

          // 현재 크기와 이전 크기 비교
          const prevSize = prevMeasuredSizeRef.current;
          const sizeChanged =
            !element.measuredSize ||
            element.measuredSize.width !== finalWidth ||
            element.measuredSize.height !== finalHeight;

          if (sizeChanged) {
            // 리사이즈 앵커 결정 (우선순위: element > definition > default)
            const resizeAnchor: ElementResizeAnchor =
              element.resizeAnchor || definition?.resizeAnchor || 'top-left';

            // 줌 변경으로 인한 크기 측정 차이는 위치 보정하지 않음
            // 실제 콘텐츠 변화에 의한 크기 변경만 위치 보정
            const shouldAdjustPosition =
              prevSize && resizeAnchor !== 'top-left' && !zoomChanged;

            if (shouldAdjustPosition) {
              const { dx, dy } = calculatePluginAnchorOffset(
                resizeAnchor,
                prevSize,
                newSize,
              );

              if (dx !== 0 || dy !== 0) {
                // 위치와 크기를 함께 업데이트
                updateElement(element.fullId, {
                  position: {
                    x: element.position.x + dx,
                    y: element.position.y + dy,
                  },
                  measuredSize: newSize,
                });
              } else {
                updateElement(element.fullId, {
                  measuredSize: newSize,
                });
              }
            } else {
              // 첫 측정이거나 top-left 앵커이거나 줌 변경인 경우 크기만 업데이트
              updateElement(element.fullId, {
                measuredSize: newSize,
              });
            }

            // 이전 크기 저장
            prevMeasuredSizeRef.current = newSize;
          }
        }
      });
    }

    // data-plugin-handler 이벤트 위임 (메인 윈도우에서만)
    if (windowType === 'main') {
      const detachInteractions = attachPluginDomInteractions(target);

      return () => {
        if (measurementFrame !== null) {
          cancelAnimationFrame(measurementFrame);
        }
        detachInteractions();
      };
    }

    return undefined;
    // 전달된 container ref identity는 안정적이며 기존 재등록 경계 유지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    element.scoped,
    element.fullId,
    element.position,
    element.resizeAnchor,
    updateElement,
    windowType,
    shadowRoot,
    renderedContent, // 컨텐츠 변경 시 크기 재측정
    zoom,
    definition?.preserveAxis,
    definition?.resizable,
    definition?.resizeAnchor,
    element.measuredSize,
  ]);
};
