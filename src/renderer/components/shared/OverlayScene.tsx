import React, { Suspense, lazy } from 'react';
import { Key } from '@components/shared/Key';
import { isMac } from '@utils/core/platform';
import KeyCounterLayer from '@components/overlay/counters/KeyCounterLayer';
import StatItem from '@components/overlay/counters/StatItem';
import StatCounterLayer from '@components/overlay/counters/StatCounterLayer';
import OverlayGraphItemBase from '@components/overlay/counters/OverlayGraphItem';
import OverlayKnobItemBase from '@components/overlay/counters/OverlayKnobItem';
import OverlaySpriteItem from '@components/overlay/counters/OverlaySpriteItem';
import { PluginElementsRenderer } from '@components/shared/PluginElementsRenderer';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import { type KeyPosition } from '@src/types/key/keys';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import type { NoteBuffer } from '@stores/signals/noteBuffer';
import { resolveZIndexFallback } from '@utils/core/zIndexFallback';

// 타입 별칭 (공용)
interface OverlayKeyProps {
  keyName: string;
  globalKey: string;
  position: KeyPosition;
  mode?: string;
  counterEnabled?: boolean;
}

interface OverlayStatItemProps {
  statType: string;
  label?: string;
  position: Record<string, unknown>;
  counterEnabled?: boolean;
}

interface OverlayStatCounterLayerProps {
  positions: Record<string, unknown>[];
}

interface OverlayGraphItemProps {
  index?: number;
  position: Record<string, unknown>;
}

interface OverlayKnobItemProps {
  index?: number;
  position: Record<string, unknown>;
}

const OverlayKey = Key as React.ComponentType<OverlayKeyProps>;
const OverlayStatItem =
  StatItem as unknown as React.ComponentType<OverlayStatItemProps>;
const OverlayStatCounterLayer =
  StatCounterLayer as unknown as React.ComponentType<OverlayStatCounterLayerProps>;
const OverlayGraphItem =
  OverlayGraphItemBase as React.ComponentType<OverlayGraphItemProps>;
const OverlayKnobItem =
  OverlayKnobItemBase as React.ComponentType<OverlayKnobItemProps>;

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

// 미지정 시 identity 안정 기본값
const EMPTY_SPRITE_POSITIONS: CanonicalEditorDocumentV1['spritePositions'][string] =
  Object.freeze(
    [],
  ) as unknown as CanonicalEditorDocumentV1['spritePositions'][string];
const EMPTY_SPRITE_KEY_MAP: ReadonlyMap<string, string> = new Map();

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
  displaySpritePositions?: CanonicalEditorDocumentV1['spritePositions'][string];
  // 스프라이트 트리거(키 요소 id) -> canonical 키 문자열
  spriteKeyCanonicalMap?: ReadonlyMap<string, string>;
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
  // 배경 박스 - 미지정 시 뷰포트 전체.
  // x·y는 스프라이트 이미지 도달 여유로 창 원점이 밀린 만큼의 배경 위치 보정이고,
  // 배경 밖 여유 영역과 OBS 소스의 남는 영역은 투명으로 남는다
  contentSize?: { x?: number; y?: number; width: number; height: number };
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
  displaySpritePositions = EMPTY_SPRITE_POSITIONS,
  spriteKeyCanonicalMap = EMPTY_SPRITE_KEY_MAP,
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
      {/* 배경은 콘텐츠 박스에만 - 스프라이트 도달 여유와 OBS 소스의 남는 영역은 투명 */}
      <div
        aria-hidden
        className="dmn-overlay-background pointer-events-none absolute left-0 top-0"
        style={{
          ...(contentSize && (contentSize.x || contentSize.y)
            ? { left: contentSize.x ?? 0, top: contentSize.y ?? 0 }
            : null),
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
          <OverlayKey
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
        if (!pos || (pos as { hidden?: boolean }).hidden) return null;

        const statType = (pos as { statType?: string }).statType ?? 'kps';
        const defaultLabel =
          statType === 'kpsAvg'
            ? 'AVG'
            : statType === 'kpsMax'
            ? 'MAX'
            : statType === 'total'
            ? 'Total'
            : 'KPS';
        const label =
          (
            ((pos as { displayText?: string }).displayText || '') as string
          ).trim() || defaultLabel;
        const position = {
          ...pos,
          zIndex: (pos as { zIndex?: number }).zIndex ?? index,
        };

        return (
          <OverlayStatItem
            key={pos.id}
            statType={statType}
            label={label}
            position={position}
            counterEnabled={true}
          />
        );
      })}
      {displayGraphPositions.map((pos, index) => {
        if (!pos || (pos as { hidden?: boolean }).hidden) return null;
        const graphPosition = {
          ...pos,
          zIndex: (pos as { zIndex?: number }).zIndex ?? index,
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
        if (!pos || (pos as { hidden?: boolean }).hidden) return null;
        const knobPosition = {
          ...pos,
          zIndex: (pos as { zIndex?: number }).zIndex ?? index,
        };
        return (
          <OverlayKnobItem key={pos.id} index={index} position={knobPosition} />
        );
      })}
      {displaySpritePositions.map((pos, index) => {
        if (!pos || pos.hidden) return null;
        // 전개 금지 - 원본 identity를 보존해야 잎의 React.memo가 유지된다
        const position = resolveZIndexFallback(pos, index);
        return (
          <OverlaySpriteItem
            key={pos.id}
            position={position}
            keyCanonicalMap={spriteKeyCanonicalMap}
          />
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
      <OverlayStatCounterLayer positions={displayStatPositions} />
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
