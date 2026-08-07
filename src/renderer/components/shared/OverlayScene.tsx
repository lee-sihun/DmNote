import React, { Suspense, lazy } from 'react';
import { Key } from '@components/shared/Key';
import { isMac } from '@utils/core/platform';
import KeyCounterLayer from '@components/overlay/counters/KeyCounterLayer';
import StatItem from '@components/overlay/counters/StatItem';
import StatCounterLayer from '@components/overlay/counters/StatCounterLayer';
import OverlayGraphItemBase from '@components/overlay/counters/OverlayGraphItem';
import OverlayKnobItemBase from '@components/overlay/counters/OverlayKnobItem';
import { PluginElementsRenderer } from '@components/shared/PluginElementsRenderer';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import {
  createDefaultCounterSettings,
  type KeyPosition,
} from '@src/types/key/keys';
import type { NoteSettings } from '@src/types/settings/noteSettings';
import type { NoteBuffer } from '@stores/signals/noteBuffer';

const FALLBACK_POSITION: KeyPosition = {
  dx: 0,
  dy: 0,
  width: 60,
  height: 60,
  hidden: false,
  activeImage: '',
  inactiveImage: '',
  activeTransparent: false,
  idleTransparent: false,
  count: 0,
  noteColor: '#FFFFFF',
  noteOpacity: 80,
  noteAlignment: 'center',
  noteEffectEnabled: true,
  noteGlowEnabled: false,
  noteGlowSize: 20,
  noteGlowOpacity: 70,
  noteGlowColor: '#FFFFFF',
  noteAutoYCorrection: true,
  className: '',
  counter: createDefaultCounterSettings(),
};

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

interface OverlaySceneProps {
  // 키/위치 데이터 (currentKeys = canonical 문자열)
  currentKeys: string[];
  // 인덱스 정렬된 표시 라벨 (멀티 슬롯 합성 라벨용)
  currentKeyLabels: string[];
  displayPositions: KeyPosition[];
  currentPositions: KeyPosition[];
  displayStatPositions: Record<string, unknown>[];
  displayGraphPositions: Record<string, unknown>[];
  displayKnobPositions: Record<string, unknown>[];
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
  positionOffset?: { x: number; y: number };
  onMouseDownCapture?: (e: React.MouseEvent<HTMLDivElement>) => void;
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
  positionOffset,
  onMouseDownCapture,
  showPluginElements = true,
}: OverlaySceneProps) => {
  const macOS = isMac();

  return (
    <div
      className="relative w-full h-screen m-0 overflow-hidden"
      style={{
        backgroundColor:
          backgroundColor === 'transparent' ? 'transparent' : backgroundColor,
        ...(macOS
          ? { willChange: 'background-color' }
          : {
              willChange: 'contents',
              contain: 'layout style paint',
            }),
      }}
      onMouseDownCapture={onMouseDownCapture}
    >
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
        const basePosition =
          displayPositions[index] ??
          currentPositions[index] ??
          FALLBACK_POSITION;

        const position = {
          ...basePosition,
          zIndex: basePosition.zIndex ?? index,
        };

        return (
          <OverlayKey
            key={`${selectedKeyType}-${index}`}
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
            key={`stat-${selectedKeyType}-${index}`}
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
            key={`graph-${selectedKeyType}-${index}`}
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
          <OverlayKnobItem
            key={`knob-${selectedKeyType}-${index}`}
            index={index}
            position={knobPosition}
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
export { FALLBACK_POSITION };
export type { OverlaySceneProps };
