import React, { Suspense, lazy } from 'react';
import { Key } from '@components/shared/Key';
import { isMac } from '@utils/core/platform';
import KeyCounterLayer from '@components/overlay/counters/KeyCounterLayer';
import StatItem from '@components/overlay/counters/StatItem';
import StatCounterLayer from '@components/overlay/counters/StatCounterLayer';
import OverlayGraphItem from '@components/overlay/counters/OverlayGraphItem';
import OverlayKnobItem from '@components/overlay/counters/OverlayKnobItem';
import { PluginElementsRenderer } from '@components/shared/PluginElementsRenderer';
import { getKeyInfoByGlobalKey } from '@utils/input/KeyMaps';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import type { NoteBuffer } from '@stores/signals/noteBuffer';
import { resolveZIndexFallback } from '@utils/element/zIndexFallback';

// Tracks 레이지 로딩
const Tracks = lazy(async () => {
  const mod = await import('@components/overlay/WebGLTracksOGL.jsx');
  return {
    default: mod.WebGLTracksOGL as unknown as React.ComponentType<
      Record<string, unknown>
    >,
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NoteSubscriber = (event: any) => void;

interface OverlaySceneProps {
  // 키/위치 데이터 (currentKeys = canonical 문자열)
  currentKeys: string[];
  // 인덱스 정렬된 표시 라벨 (멀티 슬롯 합성 라벨용)
  currentKeyLabels: string[];
  displayPositions: CanonicalEditorDocumentV1['keyPositions'][string];
  currentPositions: CanonicalEditorDocumentV1['keyPositions'][string];
  displayStatPositions: CanonicalEditorDocumentV1['statPositions'][string];
  displayGraphPositions: CanonicalEditorDocumentV1['graphPositions'][string];
  displayKnobPositions: CanonicalEditorDocumentV1['knobPositions'][string];
  selectedKeyType: string;

  // 노트 이펙트
  noteEffect: boolean;
  noteSettings: NoteSettings;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webglTracks: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notesRef: React.RefObject<any>;
  subscribe: (cb: NoteSubscriber) => () => void;
  noteBuffer: NoteBuffer | null;

  // 설정
  backgroundColor: string;
  keyCounterEnabled: boolean;

  // 선택적
  // 배경 박스 크기 - 미지정 시 뷰포트 전체
  // 데스크톱 창은 콘텐츠 박스와 크기가 같아 동일하고, OBS 소스에서는 남는 영역이 투명으로 남는다
  contentSize?: { width: number; height: number };
  // 전환 중 콘텐츠 페이드 - 네이티브 창 알파 미지원 환경에서 리사이즈 아티팩트를 가린다
  contentFade?: { opacity: number; durationMs: number } | null;
  // 초기 리빌 게이트 - false면 모든 요소가 자리 잡을 때까지 화면을 감춘다
  revealed?: boolean;
  positionOffset?: { x: number; y: number };
  /** PluginElementsRenderer 표시 여부 (Tauri 컨텍스트에서만 true) */
  showPluginElements?: boolean;
}

const OverlayScene = ({
  currentKeys,
  currentKeyLabels,
  displayPositions,
  currentPositions,
  displayStatPositions,
  displayGraphPositions,
  displayKnobPositions,
  selectedKeyType,
  noteEffect,
  noteSettings,
  webglTracks,
  notesRef,
  subscribe,
  noteBuffer,
  backgroundColor,
  keyCounterEnabled,
  contentSize,
  contentFade,
  revealed = true,
  positionOffset,
  showPluginElements = true,
}: OverlaySceneProps) => {
  const macOS = isMac();

  return (
    <div
      className="relative w-full h-screen m-0 overflow-hidden"
      style={{
        // 리빌 전에는 게이트가 우선 - visibility라 레이아웃·측정은 그대로 진행되고,
        // 리빌 후에는 인라인 스타일이 사라져 유저 CSS가 다시 최우선이 된다
        ...(revealed ? null : { visibility: 'hidden' as const }),
        ...(contentFade && {
          opacity: contentFade.opacity,
          transition: `opacity ${contentFade.durationMs}ms linear`,
        }),
        ...(macOS
          ? { willChange: 'background-color' }
          : {
              willChange: 'contents',
              contain: 'layout style paint',
            }),
      }}
    >
      {/* 배경은 콘텐츠 박스에만 - 데스크톱은 창==콘텐츠라 동일하고 OBS 소스에서는 남는 영역이 투명 */}
      <div
        aria-hidden
        className="dmn-overlay-background pointer-events-none absolute left-0 top-0"
        style={{
          width: contentSize?.width ?? '100%',
          height: contentSize?.height ?? '100%',
          zIndex: 0,
          backgroundColor:
            backgroundColor === 'transparent' ? 'transparent' : backgroundColor,
        }}
      />
      {noteEffect && (
        <Suspense fallback={null}>
          <Tracks
            tracks={webglTracks}
            notesRef={notesRef}
            subscribe={subscribe}
            noteSettings={noteSettings}
            noteBuffer={noteBuffer}
          />
        </Suspense>
      )}

      {currentKeys.map((key, index) => {
        // 멀티 슬롯은 합성 라벨, 라벨 배열이 짧으면 단일 키 displayName 폴백
        const displayName =
          currentKeyLabels[index] ?? getKeyInfoByGlobalKey(key).displayName;
        const basePosition = displayPositions[index] ?? currentPositions[index];
        if (!basePosition) return null;

        const position = resolveZIndexFallback(basePosition, index);

        return (
          <Key
            key={position.id}
            keyName={displayName}
            globalKey={key}
            position={position}
            mode={selectedKeyType}
            counterEnabled={keyCounterEnabled}
          />
        );
      })}
      {displayStatPositions.map((pos, index) => {
        if (!pos || pos.hidden) return null;

        const statType = pos.statType ?? 'kps';
        const defaultLabel =
          statType === 'kpsAvg'
            ? 'AVG'
            : statType === 'kpsMax'
            ? 'MAX'
            : statType === 'total'
            ? 'Total'
            : 'KPS';
        const label = (pos.displayText || '').trim() || defaultLabel;
        const position = {
          ...pos,
          zIndex: pos.zIndex ?? index,
        };

        return (
          <StatItem
            key={pos.id}
            statType={statType}
            label={label}
            position={position}
            counterEnabled={true}
          />
        );
      })}
      {displayGraphPositions.map((pos, index) => {
        if (!pos || pos.hidden) return null;
        const graphPosition = {
          ...pos,
          zIndex: pos.zIndex ?? index,
        };
        return (
          <OverlayGraphItem
            key={pos.id}
            index={index}
            position={graphPosition}
          />
        );
      })}
      {displayKnobPositions.map((pos, index) => {
        if (!pos || pos.hidden) return null;
        const knobPosition = {
          ...pos,
          zIndex: pos.zIndex ?? index,
        };
        return (
          <OverlayKnobItem key={pos.id} index={index} position={knobPosition} />
        );
      })}
      {keyCounterEnabled ? (
        <KeyCounterLayer
          keys={currentKeys}
          positions={
            displayPositions.length ? displayPositions : currentPositions
          }
          mode={selectedKeyType}
        />
      ) : null}
      <StatCounterLayer positions={displayStatPositions} />
      {showPluginElements && positionOffset && (
        <PluginElementsRenderer
          windowType="overlay"
          positionOffset={positionOffset}
        />
      )}
    </div>
  );
};

export default OverlayScene;
export type { OverlaySceneProps };
