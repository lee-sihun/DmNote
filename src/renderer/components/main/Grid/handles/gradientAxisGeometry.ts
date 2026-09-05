import { supportsActiveVisualState } from '@stores/grid/useGradientEditStore';
import type {
  GradientAnchorBounds,
  GradientEditSession,
} from '@stores/grid/useGradientEditStore';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KeyPosition } from '@src/types/key/keys';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { StatItemPosition } from '@src/types/key/statItems';

export interface GradientAxisBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GradientAxisGeometry {
  cx: number;
  cy: number;
  halfLine: number;
  dirX: number;
  dirY: number;
  magnetAngles: number[];
  worldW: number;
  worldH: number;
  zoom: number;
  endX: number;
  endY: number;
}

interface RegisteredGradientAnchorBounds {
  sessionKey: string;
  bounds: GradientAnchorBounds;
  origin: { x: number; y: number } | null;
}

interface ResolveGradientAxisBoundsOptions {
  session: GradientEditSession | null;
  registeredAnchorBounds: RegisteredGradientAnchorBounds | null;
  positions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  graphPositions?: Record<string, GraphItemPosition[] | undefined>;
  knobPositions?: Record<string, KnobItemPosition[] | undefined>;
  selectedElements: SelectedElement[];
  selectedKeyType: string;
}

export type GradientAxisEnd = 'start' | 'end';

export const normalizeGradientAxisAngle = (deg: number): number =>
  ((deg % 360) + 360) % 360;

const circularDistance = (a: number, b: number): number => {
  const diff = Math.abs(
    normalizeGradientAxisAngle(a) - normalizeGradientAxisAngle(b),
  );
  return Math.min(diff, 360 - diff);
};

// 변 중앙 4방향 + 모서리 4방향 (요소 종횡비 반영)
export const buildGradientAxisMagnetAngles = (
  width: number,
  height: number,
): number[] => {
  const corner = normalizeGradientAxisAngle(
    (Math.atan2(width / 2, height / 2) * 180) / Math.PI,
  );
  return [
    0,
    90,
    180,
    270,
    corner,
    normalizeGradientAxisAngle(180 - corner),
    normalizeGradientAxisAngle(180 + corner),
    normalizeGradientAxisAngle(360 - corner),
  ];
};

export const resolveGradientAxisBounds = ({
  session,
  registeredAnchorBounds,
  positions,
  statPositions,
  graphPositions,
  knobPositions,
  selectedElements,
  selectedKeyType,
}: ResolveGradientAxisBoundsOptions): GradientAxisBounds | null => {
  if (!session) return null;
  // 표면 소유 레이어가 실측 박스를 등록했으면 우선 사용 - 카운터 표면은
  // 요소(키) 박스가 아니라 실제 카운터 텍스트 박스가 축의 기준
  if (registeredAnchorBounds?.sessionKey === session.sessionKey) {
    const { bounds, origin } = registeredAnchorBounds;
    const anchor = session.anchor;
    // 등록 후 요소가 이동하면 저장 좌표 델타로 실측 박스를 추종
    if (origin && anchor.kind !== 'batch') {
      const collection =
        anchor.kind === 'key'
          ? positions[selectedKeyType]
          : anchor.kind === 'stat'
          ? statPositions[selectedKeyType]
          : anchor.kind === 'graph'
          ? graphPositions?.[selectedKeyType]
          : knobPositions?.[selectedKeyType];
      const pos = collection?.find((position) => position.id === anchor.id);
      if (pos && (pos.dx !== origin.x || pos.dy !== origin.y)) {
        return {
          ...bounds,
          x: bounds.x + (pos.dx - origin.x),
          y: bounds.y + (pos.dy - origin.y),
        };
      }
    }
    return bounds;
  }
  const { anchor } = session;
  if (anchor.kind === 'batch') {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const element of selectedElements) {
      if (
        session.stateMode === 'active' &&
        !supportsActiveVisualState(element.type)
      ) {
        continue;
      }
      const collection =
        element.type === 'key'
          ? positions[selectedKeyType]
          : element.type === 'stat'
          ? statPositions[selectedKeyType]
          : element.type === 'graph'
          ? graphPositions?.[selectedKeyType]
          : element.type === 'knob'
          ? knobPositions?.[selectedKeyType]
          : undefined;
      const pos = collection?.find((position) => position.id === element.id);
      if (!pos) continue;
      const width = pos.width || (element.type === 'graph' ? 200 : 60);
      const height = pos.height || (element.type === 'graph' ? 100 : 60);
      minX = Math.min(minX, pos.dx);
      minY = Math.min(minY, pos.dy);
      maxX = Math.max(maxX, pos.dx + width);
      maxY = Math.max(maxY, pos.dy + height);
    }
    if (!Number.isFinite(minX)) return null;
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  const collection =
    anchor.kind === 'key'
      ? positions[selectedKeyType]
      : anchor.kind === 'stat'
      ? statPositions[selectedKeyType]
      : anchor.kind === 'graph'
      ? graphPositions?.[selectedKeyType]
      : knobPositions?.[selectedKeyType];
  const pos = collection?.find((position) => position.id === anchor.id);
  if (!pos) return null;
  return {
    x: pos.dx,
    y: pos.dy,
    width: pos.width || (anchor.kind === 'graph' ? 200 : 60),
    height: pos.height || (anchor.kind === 'graph' ? 100 : 60),
  };
};

export const buildGradientAxisGeometry = (
  bounds: GradientAxisBounds,
  angle: number,
  zoom: number,
  panX: number,
  panY: number,
): GradientAxisGeometry => {
  const cx = (bounds.x + bounds.width / 2) * zoom + panX;
  const cy = (bounds.y + bounds.height / 2) * zoom + panY;
  const magnetAngles = buildGradientAxisMagnetAngles(
    bounds.width,
    bounds.height,
  );
  const rad = (angle * Math.PI) / 180;
  // CSS linear-gradient: 0deg = 위, 시계 방향 - 화면 좌표(y 아래)로 변환
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  // CSS 그라데이션 라인 절반 길이 - pos 0/1이 이 지점에 해당
  const halfLine =
    ((Math.abs(bounds.width * Math.sin(rad)) +
      Math.abs(bounds.height * Math.cos(rad))) /
      2) *
    zoom;
  return {
    cx,
    cy,
    halfLine,
    dirX,
    dirY,
    magnetAngles,
    worldW: bounds.width,
    worldH: bounds.height,
    zoom,
    endX: cx + dirX * halfLine,
    endY: cy + dirY * halfLine,
  };
};

export const gradientAxisStopPoint = (
  geometry: GradientAxisGeometry,
  pos: number,
): { x: number; y: number } => ({
  x: geometry.cx + geometry.dirX * (pos - 0.5) * 2 * geometry.halfLine,
  y: geometry.cy + geometry.dirY * (pos - 0.5) * 2 * geometry.halfLine,
});

export const gradientAxisClientOrigin = (
  geometry: GradientAxisGeometry | null,
  hostRect: Pick<DOMRect, 'left' | 'top'> | null,
): { x: number; y: number } => ({
  x: (hostRect?.left ?? 0) + (geometry?.cx ?? 0),
  y: (hostRect?.top ?? 0) + (geometry?.cy ?? 0),
});

export const gradientAxisPointerAngle = (
  clientX: number,
  clientY: number,
  end: GradientAxisEnd,
  origin: { x: number; y: number },
): number => {
  const raw =
    (Math.atan2(clientX - origin.x, origin.y - clientY) * 180) / Math.PI;
  // 시작점 쪽을 잡으면 축 반대 방향이 그라데이션 진행 방향
  return normalizeGradientAxisAngle(end === 'start' ? raw + 180 : raw);
};

export const applyGradientAxisMagnet = (
  angle: number,
  magnetAngles: readonly number[],
  magnetDisabled: boolean,
  thresholdDeg: number,
): number => {
  let next = normalizeGradientAxisAngle(Math.round(angle));
  if (!magnetDisabled) {
    for (const magnet of magnetAngles) {
      if (circularDistance(next, magnet) <= thresholdDeg) {
        next = magnet;
        break;
      }
    }
  }
  return normalizeGradientAxisAngle(Math.round(next));
};

export const projectClientToGradientAxis = (
  clientX: number,
  clientY: number,
  geometry: GradientAxisGeometry | null,
  origin: { x: number; y: number },
): number => {
  if (!geometry || geometry.halfLine === 0) return 0.5;
  const dx = clientX - origin.x;
  const dy = clientY - origin.y;
  return (
    (dx * geometry.dirX + dy * geometry.dirY) / (2 * geometry.halfLine) + 0.5
  );
};

export const clampGradientAxisPosition = (pos: number): number =>
  Math.min(1, Math.max(0, pos));
