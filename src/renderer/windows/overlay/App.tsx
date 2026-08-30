import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import { mergeNoteSettings } from '@src/types/settings/noteSettings';
import { useCustomCssInjection } from '@hooks/app/useCustomCssInjection';
import { useCustomJsInjection } from '@hooks/app/useCustomJsInjection';
import { useBlockBrowserShortcuts } from '@hooks/app/useBlockBrowserShortcuts';
import { useNoteSystem } from '@hooks/overlay/useNoteSystem';
import { useOverlayHitRegions } from '@hooks/overlay/useOverlayHitRegions';
import { useOverlayContextMenuRuntime } from '@hooks/overlay/useOverlayContextMenuRuntime';
import { useTrackReserveTransition } from '@hooks/overlay/useTrackReserveTransition';
import { useOverlayReveal } from '@hooks/overlay/useOverlayReveal';
import { useOverlayKeyStateRuntime } from '@hooks/overlay/useOverlayKeyStateRuntime';
import { useAppBootstrap } from '@hooks/app/useAppBootstrap';
import { overlayApi } from '@api/modules/overlayApi';
import { useBuiltinStatsSubscription } from '@hooks/overlay/useBuiltinStatsSubscription';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import {
  selectPluginLayoutElements,
  pluginLayoutElementsEqual,
} from '@utils/plugin/pluginLayoutElements';
import OverlayScene from '@components/shared/OverlayScene';
import { computeLayout } from '@hooks/shared/useLayoutComputation';

// 슬라이스 부재 시에도 identity 안정 - computeLayout 메모 deps로 사용됨
// 이종 배열 5곳이 같은 인스턴스를 별칭하므로 freeze로 교차 오염 차단
const EMPTY_SLICE: never[] = Object.freeze([]) as never[];

export default function App() {
  const isBootstrapped = useKeyStore((state) => state.isBootstrapped);
  useCustomCssInjection();
  useCustomJsInjection(isBootstrapped);
  useAppBootstrap();
  useBuiltinStatsSubscription();
  useBlockBrowserShortcuts();
  const { t } = useTranslation();
  const developerModeEnabled = useSettingsStore(
    (state) => state.developerModeEnabled,
  );

  // 개발자 모드 비활성 시 DevTools 단축키 차단
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isDevtoolsCombo =
        ((e.ctrlKey || e.metaKey) &&
          e.shiftKey &&
          e.key.toLowerCase() === 'i') ||
        e.key === 'F12';
      if (!developerModeEnabled && isDevtoolsCombo) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [developerModeEnabled]);

  // 윈도우 타입
  useEffect(() => {
    try {
      window.__dmn_window_type = 'overlay';
    } catch {
      // 무시
    }
    return () => {
      try {
        window.__dmn_window_type = undefined;
      } catch {
        // 무시
      }
    };
  }, []);

  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const positions = useKeyStore((state) => state.positions);
  const statPositions = useStatItemStore((state) => state.positions);
  const graphPositions = useGraphItemStore((state) => state.positions);
  const knobPositions = useKnobItemStore((state) => state.positions);
  // 레이아웃 필드만 투영 구독 - 플러그인 state/html 변경이 App 리렌더로 승격되지 않게
  const pluginElements = useStoreWithEqualityFn(
    usePluginDisplayElementStore,
    selectPluginLayoutElements,
    pluginLayoutElementsEqual,
  );

  const backgroundColor = useSettingsStore((state) => state.backgroundColor);
  const alwaysOnTop = useSettingsStore((state) => state.alwaysOnTop);
  const trayEnabled = useSettingsStore((state) => state.trayEnabled);
  const setAlwaysOnTop = useSettingsStore((state) => state.setAlwaysOnTop);
  const globalNoteSettings = useSettingsStore((state) => state.noteSettings);
  const tabNoteOverrides = useSettingsStore((state) => state.tabNoteOverrides);
  // 현재 탭 override로 deps 한정 - 다른 탭 override 변경이 재병합·재계산으로 번지지 않게
  const currentTabNoteOverride = tabNoteOverrides?.[selectedKeyType];
  const noteSettings = useMemo(
    () => mergeNoteSettings(globalNoteSettings, currentTabNoteOverride),
    [globalNoteSettings, currentTabNoteOverride],
  );
  const noteEffect = useSettingsStore((state) => state.noteEffect);
  const overlayPadding = useSettingsStore(
    (state) => state.gridSettings.overlayPadding ?? 30,
  );
  const overlayAnchor = useSettingsStore((state) => state.overlayResizeAnchor);
  const keyCounterEnabled = useSettingsStore(
    (state) => state.keyCounterEnabled,
  );
  const customTabs = useKeyStore((state) => state.customTabs);
  const setSelectedKeyType = useKeyStore((state) => state.setSelectedKeyType);
  useOverlayContextMenuRuntime({
    alwaysOnTop,
    trayEnabled,
    setAlwaysOnTop,
    selectedKeyType,
    customTabs,
    setSelectedKeyType,
    t,
  });

  const {
    notesRef,
    subscribe,
    handleKeyDown,
    handleKeyUp,
    finalizeAllActive,
    reconcileActiveNotes,
    noteBuffer,
    updateTrackLayouts,
  } = useNoteSystem({
    noteEffect,
    noteSettings,
  });

  // 노트 이펙트 꺼짐 시 트랙 예약 공간 제거 - 창 높이와 키 오프셋이 함께 줄어든다
  const targetTrackReserve = noteEffect
    ? noteSettings?.trackHeight ?? DEFAULT_NOTE_SETTINGS.trackHeight
    : 0;
  // 토글 전환은 창 페이드로 감싸 리사이즈 순간의 덜컥거림을 가린다
  // 하이드레이션 전 초기값 반영은 전환 없이 즉시 채택
  const { trackHeight, contentFade } = useTrackReserveTransition(
    targetTrackReserve,
    isBootstrapped,
  );

  // 키 딜레이 설정
  const keyDisplayDelayMs = Number(noteSettings?.keyDisplayDelayMs ?? 0);
  const currentSlots = keyMappings[selectedKeyType] ?? EMPTY_SLICE;
  const { currentKeys, currentKeyLabels } = useOverlayKeyStateRuntime({
    noteEffect,
    keyDisplayDelayMs,
    keyMappings,
    currentSlots,
    positions,
    selectedKeyType,
    handleKeyDown,
    handleKeyUp,
    finalizeAllActive,
    reconcileActiveNotes,
  });

  const currentPositions = positions[selectedKeyType] ?? EMPTY_SLICE;
  const currentStatPositions = statPositions[selectedKeyType] ?? EMPTY_SLICE;
  const currentGraphPositions = graphPositions[selectedKeyType] ?? EMPTY_SLICE;
  const currentKnobPositions = knobPositions[selectedKeyType] ?? EMPTY_SLICE;

  // 레이아웃 입력이 실제로 바뀔 때만 재계산 - webglTracks identity가 안정되어
  // updateTrackLayouts effect·WebGL uniform effect가 무관한 리렌더에 재실행되지 않음
  const layout = useMemo(
    () =>
      computeLayout({
        currentKeys,
        currentPositions,
        currentStatPositions,
        currentGraphPositions,
        currentKnobPositions,
        trackHeight,
        noteSettings,
        selectedKeyType,
        pluginElements,
        overlayPadding,
      }),
    [
      currentKeys,
      currentPositions,
      currentStatPositions,
      currentGraphPositions,
      currentKnobPositions,
      trackHeight,
      noteSettings,
      selectedKeyType,
      pluginElements,
      overlayPadding,
    ],
  );
  const {
    bounds,
    displayPositions,
    displayStatPositions,
    displayGraphPositions,
    displayKnobPositions,
    positionOffset,
    topOffset,
    webglTracks,
  } = layout;

  // 레이아웃이 DOM에 반영된 뒤 키 rect를 실측해 네이티브 히트 창과 동기화
  useOverlayHitRegions(layout);

  // 창 크기와 배경 박스가 같은 공식을 공유 (창 == 콘텐츠 박스 불변식)
  // 높이는 computeLayout의 topOffset을 그대로 재사용 - 공식이 한 곳에만 있다
  const contentSize = useMemo(
    () =>
      bounds
        ? {
            width: bounds.maxX - bounds.minX + overlayPadding * 2,
            height: bounds.maxY - bounds.minY + overlayPadding + topOffset,
          }
        : undefined,
    [bounds, overlayPadding, topOffset],
  );

  // updateTrackLayouts는 useNoteSystem이 마운트 1회 고정 참조를 보장하므로
  // deps 포함이 재실행을 유발하지 않으며, 훅이 updater를 교체하는 미래 변경에도 안전
  useEffect(() => {
    updateTrackLayouts(webglTracks);
  }, [webglTracks, updateTrackLayouts]);

  // 응답 대기 중인 resize 수 - 초기 리빌이 창 리사이즈보다 먼저 일어나지 않게 한다
  const [resizeInFlight, setResizeInFlight] = useState(0);

  // 이전 resize 값을 추적하여 실제로 변경되었을 때만 resize 호출
  const lastResizeParams = useRef<{
    width: number;
    height: number;
    anchor: string;
    contentTopOffset: number;
    minX: number;
    minY: number;
  } | null>(null);

  useEffect(() => {
    if (!bounds || !contentSize) return;
    // OBS 오버레이에는 네이티브 창이 없다 - allowlist 밖이라 호출이 항상 거부되고,
    // 기준선을 지우는 실패 처리와 맞물려 레이아웃이 바뀔 때마다 헛호출이 반복된다
    if (window.__dmn_runtime === 'obs') return;

    const totalWidth = contentSize.width;
    const totalHeight = contentSize.height;
    // computeLayout이 계산한 값을 그대로 - 같은 공식을 여기서 또 쓰지 않는다
    const contentTopOffset = topOffset;
    const currentMinX = bounds.minX;
    const currentMinY = bounds.minY;

    // 이전 값과 비교하여 실제로 변경되었을 때만 resize 호출
    const lastParams = lastResizeParams.current;
    const fixedPositionAnchor = overlayAnchor === 'fixed-position';
    const fixedPositionDeltaX =
      fixedPositionAnchor && lastParams?.anchor === 'fixed-position'
        ? currentMinX - lastParams.minX
        : 0;
    const fixedPositionDeltaY =
      fixedPositionAnchor && lastParams?.anchor === 'fixed-position'
        ? currentMinY - lastParams.minY
        : 0;
    if (
      lastParams &&
      Math.abs(lastParams.width - totalWidth) < 0.5 &&
      Math.abs(lastParams.height - totalHeight) < 0.5 &&
      lastParams.anchor === overlayAnchor &&
      Math.abs(lastParams.contentTopOffset - contentTopOffset) < 0.5 &&
      (!fixedPositionAnchor ||
        (Math.abs(lastParams.minX - currentMinX) < 0.5 &&
          Math.abs(lastParams.minY - currentMinY) < 0.5))
    ) {
      return; // 변경사항 없음, resize 건너뛰기
    }

    lastResizeParams.current = {
      width: totalWidth,
      height: totalHeight,
      anchor: overlayAnchor,
      contentTopOffset,
      minX: currentMinX,
      minY: currentMinY,
    };

    setResizeInFlight((count) => count + 1);
    overlayApi
      .resize({
        width: totalWidth,
        height: totalHeight,
        anchor: overlayAnchor,
        contentTopOffset,
        fixedPositionDeltaX: fixedPositionAnchor
          ? fixedPositionDeltaX
          : undefined,
        fixedPositionDeltaY: fixedPositionAnchor
          ? fixedPositionDeltaY
          : undefined,
      })
      .catch((error) => {
        console.error('Failed to resize overlay window', error);
        // 실패한 요청이 기준선으로 남으면 같은 크기 재시도가 영구히 차단된다
        lastResizeParams.current = null;
      })
      .finally(() => {
        setResizeInFlight((count) => Math.max(0, count - 1));
      });
  }, [bounds, contentSize, topOffset, overlayAnchor, overlayPadding]);

  // 모든 요소가 자리 잡은 뒤 한 번에 공개 - 플러그인 요소가 늦게 뜨며 생기던 덜컥거림 제거
  const revealed = useOverlayReveal(isBootstrapped, resizeInFlight > 0);

  return (
    <OverlayScene
      currentKeys={currentKeys}
      currentKeyLabels={currentKeyLabels}
      displayPositions={displayPositions}
      currentPositions={currentPositions}
      displayStatPositions={displayStatPositions}
      displayGraphPositions={displayGraphPositions}
      displayKnobPositions={displayKnobPositions}
      selectedKeyType={selectedKeyType}
      noteEffect={noteEffect}
      contentSize={contentSize}
      contentFade={contentFade}
      revealed={revealed}
      noteSettings={noteSettings}
      webglTracks={webglTracks}
      notesRef={notesRef}
      subscribe={subscribe}
      noteBuffer={noteBuffer}
      backgroundColor={backgroundColor}
      keyCounterEnabled={keyCounterEnabled}
      positionOffset={positionOffset}
      showPluginElements={true}
    />
  );
}
