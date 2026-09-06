import {
  DEFAULT_NOTE_BORDER_RADIUS,
  DEFAULT_NOTE_SETTINGS,
} from '@constants/overlayDefaults';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { NoteSettings } from '@src/types/settings/noteSettings';
// 레이아웃이 읽을 수 있는 플러그인 필드는 투영 타입으로 제한 —
// 필드 추가 시 selectPluginLayoutElements·pluginLayoutElementsEqual 동반 수정 필요
import type { PluginLayoutElement } from '@utils/plugin/pluginLayoutElements';
import {
  computeSpriteReachAabb,
  spriteReachEnumerationCost,
} from '@utils/sprite/spriteReach';
import { buildSpriteKeyCanonicalMap } from '@utils/sprite/spriteKeyBinding';
import { DEFAULT_SPRITE_SIZE } from '@src/types/key/sprites';
import { rotatedRectAabb } from '@utils/core/rotation';
import {
  computeTrackGeometry,
  groupSameFlowAngles,
  sameFlowStartShift,
  translateTrackGeometry,
} from '@utils/layout/trackGeometry';

interface LayoutInput {
  // canonical 슬롯 식별자 배열 (slotCanonical 결과, 원본 KeySlot 아님)
  currentKeys: string[];
  currentPositions: CanonicalEditorDocumentV1['keyPositions'][string];
  currentStatPositions: CanonicalEditorDocumentV1['statPositions'][string];
  currentGraphPositions: CanonicalEditorDocumentV1['graphPositions'][string];
  currentKnobPositions: CanonicalEditorDocumentV1['knobPositions'][string];
  currentSpritePositions: CanonicalEditorDocumentV1['spritePositions'][string];
  trackHeight: number;
  noteSettings: NoteSettings;
  selectedKeyType?: string;
  pluginElements?: PluginLayoutElement[];
  overlayPadding?: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// 오프셋 적용 결과 캐시. 키가 원본 위치 객체라 원본이 사라지면 함께 회수된다
const offsetCache = new WeakMap<
  object,
  { x: number; y: number; result: unknown }
>();

export function computeLayout(input: LayoutInput) {
  const {
    currentKeys,
    currentPositions,
    currentStatPositions,
    currentGraphPositions,
    currentKnobPositions,
    currentSpritePositions,
    trackHeight,
    noteSettings,
    selectedKeyType,
    pluginElements,
    overlayPadding: PADDING = 30,
  } = input;

  // 콘텐츠 바운즈 계산 - 배경 박스가 덮는 영역의 기준
  const contentBounds: Bounds | null = (() => {
    const hasContent =
      currentPositions.length > 0 ||
      currentStatPositions.length > 0 ||
      currentGraphPositions.length > 0 ||
      currentKnobPositions.length > 0 ||
      currentSpritePositions.length > 0 ||
      (pluginElements && pluginElements.length > 0);
    if (!hasContent) return null;

    const xs: number[] = [];
    const ys: number[] = [];
    const widths: number[] = [];
    const heights: number[] = [];

    currentPositions.forEach((pos) => {
      if (pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + pos.width);
      heights.push(pos.dy + pos.height);

      // 노트 오프셋에 의한 트랙 영역 확장 반영. 회전 키도 회전 전 오프셋 영역으로
      // 확장해 회전 각도가 콘텐츠 기준점(창 원점·히트라인)을 바꾸지 않게 한다.
      // 회전한 트랙의 실제 AABB는 창·배경 계산에 따로 합산된다
      const userOffsetX = pos.noteOffsetX ?? 0;
      const userOffsetY = pos.noteOffsetY ?? 0;
      if (userOffsetX !== 0) {
        const keyWidth = pos.width;
        const desiredNoteWidth =
          typeof pos.noteWidth === 'number' && Number.isFinite(pos.noteWidth)
            ? Math.max(1, pos.noteWidth)
            : keyWidth;
        const noteAlign = pos.noteAlignment ?? 'center';
        const alignOff =
          noteAlign === 'left'
            ? 0
            : noteAlign === 'right'
            ? keyWidth - desiredNoteWidth
            : (keyWidth - desiredNoteWidth) / 2;
        const noteLeft = pos.dx + alignOff + userOffsetX;
        const noteRight = noteLeft + desiredNoteWidth;
        xs.push(noteLeft);
        widths.push(noteRight);
      }
      if (userOffsetY > 0) {
        heights.push(pos.dy + pos.height + userOffsetY);
      } else if (userOffsetY < 0) {
        ys.push(pos.dy + userOffsetY);
      }
    });

    currentStatPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 60));
      heights.push(pos.dy + (pos.height ?? 60));
    });

    currentGraphPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 200));
      heights.push(pos.dy + (pos.height ?? 100));
    });

    currentKnobPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 60));
      heights.push(pos.dy + (pos.height ?? 60));
    });

    // 스프라이트 요소 상자(기본 이미지 상자)를 콘텐츠 바운즈에 포함
    currentSpritePositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? DEFAULT_SPRITE_SIZE));
      heights.push(pos.dy + (pos.height ?? DEFAULT_SPRITE_SIZE));
    });

    // 플러그인 요소 위치 (앵커 기반 계산 포함)
    if (pluginElements && selectedKeyType) {
      pluginElements
        .filter(
          (el) => !el.hidden && (!el.tabId || el.tabId === selectedKeyType),
        )
        .forEach((element) => {
          let x = element.position.x;
          let y = element.position.y;

          if (element.anchor?.keyCode) {
            const keyIndex = currentKeys.findIndex(
              (key) => key === element.anchor?.keyCode,
            );
            if (keyIndex >= 0 && currentPositions[keyIndex]) {
              const keyPosition = currentPositions[keyIndex];
              const offsetX = element.anchor.offset?.x ?? 0;
              const offsetY = element.anchor.offset?.y ?? 0;
              x = keyPosition.dx + offsetX;
              y = keyPosition.dy + offsetY;
            }
          }

          const width =
            element.measuredSize?.width ?? element.estimatedSize?.width ?? 200;
          const height =
            element.measuredSize?.height ??
            element.estimatedSize?.height ??
            150;

          xs.push(x);
          ys.push(y);
          widths.push(x + width);
          heights.push(y + height);
        });
    }

    if (xs.length === 0) return null;

    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...widths),
      maxY: Math.max(...heights),
    };
  })();

  const unionBounds = (a: Bounds, b: Bounds): Bounds => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  });

  // 회전한 얼굴은 논리 상자를 벗어난다. 창·배경은 회전 AABB까지 감싸되
  // 논리 콘텐츠 바운즈(히트라인·창 원점 기준)는 그대로 둔다
  const rotatedFaceBounds: Bounds | null = (() => {
    let acc: Bounds | null = null;
    const collect = (
      pos:
        | {
            dx: number;
            dy: number;
            width?: number;
            height?: number;
            rotation?: number;
            hidden?: boolean;
          }
        | null
        | undefined,
      defaultWidth: number,
      defaultHeight: number,
    ) => {
      if (!pos || pos.hidden) return;
      const rotation = pos.rotation ?? 0;
      if (rotation === 0) return;
      const aabb = rotatedRectAabb(
        pos.dx,
        pos.dy,
        pos.width ?? defaultWidth,
        pos.height ?? defaultHeight,
        rotation,
      );
      acc = acc ? unionBounds(acc, aabb) : aabb;
    };
    currentPositions.forEach((pos) => collect(pos, 60, 60));
    currentStatPositions.forEach((pos) => collect(pos, 60, 60));
    currentGraphPositions.forEach((pos) => collect(pos, 200, 100));
    currentKnobPositions.forEach((pos) => collect(pos, 60, 60));
    currentSpritePositions.forEach((pos) => collect(pos, 200, 200));
    return acc;
  })();

  // 창 바운즈 계산 - 스프라이트는 클리핑하지 않으므로 이미지 도달 범위
  // (모든 자세의 회전·확대·오프셋 AABB 합집합, 전환 오버슈트 여유 포함)가
  // 요소 상자를 넘으면 그만큼 창을 넓혀 네이티브 창 가장자리 잘림을 막는다.
  // 회전한 얼굴 AABB도 같은 자격이다. 배경 박스는 콘텐츠 바운즈 기준을 유지한다
  const bounds: Bounds | null = (() => {
    if (!contentBounds) return null;
    let { minX, minY, maxX, maxY } = contentBounds;
    // 재생 매핑과 같은 기준의 생존 키 - 요소가 남아 있어도 슬롯이 비면 누를 수
    // 없다. 오버레이 잎이 쓰는 바로 그 결합을 그대로 재사용한다
    const canonicalByKeyId = buildSpriteKeyCanonicalMap(
      currentKeys,
      currentPositions,
    );
    // 상태 열거는 정밀하지만 문서 상한(스프라이트 512 x 자세 64 x 트리거 512)에서는
    // 수백 ms가 나온다. 전체 예상량을 먼저 재고 예산을 넘으면 모든 스프라이트를 함께
    // 과대 근사로 돌린다 - 일부만 열거하면 스프라이트 순서에 창 크기가 딸려간다.
    // 예산은 실측 기준(약 33만 단위에서 19ms)에서 30ms 언저리로 잡았다
    const REACH_ENUMERATION_BUDGET = 500_000;
    let enumerationCost = 0;
    for (const pos of currentSpritePositions) {
      if (!pos || pos.hidden) continue;
      enumerationCost += spriteReachEnumerationCost(pos, canonicalByKeyId);
      if (enumerationCost > REACH_ENUMERATION_BUDGET) break;
    }
    const enumerate = enumerationCost <= REACH_ENUMERATION_BUDGET;
    currentSpritePositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      const reach = computeSpriteReachAabb(pos, canonicalByKeyId, {
        enumerate,
      });
      if (!reach) return;
      minX = Math.min(minX, pos.dx + reach.minX);
      minY = Math.min(minY, pos.dy + reach.minY);
      maxX = Math.max(maxX, pos.dx + reach.maxX);
      maxY = Math.max(maxY, pos.dy + reach.maxY);
    });
    if (rotatedFaceBounds) {
      minX = Math.min(minX, rotatedFaceBounds.minX);
      minY = Math.min(minY, rotatedFaceBounds.minY);
      maxX = Math.max(maxX, rotatedFaceBounds.maxX);
      maxY = Math.max(maxY, rotatedFaceBounds.maxY);
    }
    if (
      minX === contentBounds.minX &&
      minY === contentBounds.minY &&
      maxX === contentBounds.maxX &&
      maxY === contentBounds.maxY
    ) {
      return contentBounds;
    }
    return { minX, minY, maxX, maxY };
  })();

  // 트랙 예약 - 축 정렬 키의 트랙은 콘텐츠 상단 위 밴드 하나로 예약하고,
  // 회전 키의 트랙은 자기 상변에서 기울어져 흐르므로 회전 AABB를 창·배경에 합산한다
  const trackKeyPositions = currentKeys.map(
    (_key, index) => currentPositions[index],
  );
  const visibleTrackKeys = trackKeyPositions.filter(
    (pos) => pos && !pos.hidden,
  );
  const hasUnrotatedTrackKey = visibleTrackKeys.some(
    (pos) => (pos.rotation ?? 0) === 0,
  );
  const reserveTop =
    hasUnrotatedTrackKey || visibleTrackKeys.length === 0 ? trackHeight : 0;

  // 회전 키의 자동 시작선 보정 - 같은 방향(각도 오차 안)으로 흐르는 키끼리 오프셋 없는
  // 상변을 진행축에 투영해 가장 앞선 선에 맞춘다. 회전 0의 "한 줄에서 시작"을 방향별로
  // 일반화한 것이고, 혼자면 자기 상변. 사용자 노트 오프셋은 보정 뒤 로컬 프레임으로
  // 얹는다(회전 0의 topMostY + offsetY와 같은 순서). 이동량은 평행이동에 불변이라
  // 창 오프셋 전(창 크기)과 후(트랙 배치)에 같은 값을 쓴다
  const trackGeometry = (
    pos: (typeof trackKeyPositions)[number],
    withUserOffset: boolean,
    hitline?: number,
  ) =>
    computeTrackGeometry({
      keyX: pos.dx,
      keyY: pos.dy,
      keyWidth: pos.width,
      keyHeight: pos.height,
      rotation: pos.rotation ?? 0,
      trackHeight,
      noteWidth: pos.noteWidth,
      noteAlignment: pos.noteAlignment,
      noteOffsetX: withUserOffset ? pos.noteOffsetX : undefined,
      noteOffsetY: withUserOffset ? pos.noteOffsetY : undefined,
      hitline,
    });
  const rotatedFlowShiftByIndex = new Map<number, number>();
  (() => {
    // 0° 키도 기준선에 참여한다 - 오차 안의 미세 회전 키가 0° 키의 히트라인과 이어지도록.
    // 0° 키 자신은 기존 히트라인 경로를 타므로 이동량은 회전 키에만 준다
    const candidates: number[] = [];
    let hasRotated = false;
    trackKeyPositions.forEach((pos, index) => {
      if (!pos || pos.hidden) return;
      candidates.push(index);
      if ((pos.rotation ?? 0) !== 0) hasRotated = true;
    });
    if (!hasRotated) return;
    const baseGeometry = candidates.map((index) => {
      const pos = trackKeyPositions[index];
      const onHitline =
        (pos.rotation ?? 0) === 0 && pos.noteAutoYCorrection !== false;
      return trackGeometry(
        pos,
        false,
        onHitline ? contentBounds?.minY : undefined,
      );
    });
    groupSameFlowAngles(
      candidates.map((index) => trackKeyPositions[index].rotation ?? 0),
    ).forEach((group) => {
      const origins = group.map((member) => baseGeometry[member].origin);
      group.forEach((member) => {
        const index = candidates[member];
        const pos = trackKeyPositions[index];
        // 보정을 끈 키도 같은 방향이면 기준선에는 참여한다
        if ((pos.rotation ?? 0) === 0 || pos.noteAutoYCorrection === false)
          return;
        const { origin, direction } = baseGeometry[member];
        rotatedFlowShiftByIndex.set(
          index,
          sameFlowStartShift(origin, direction, origins),
        );
      });
    });
  })();

  // 노트 효과가 꺼져 트랙 높이가 0이면 창을 넓힐 트랙이 없다
  const trackBounds: Bounds | null = (() => {
    if (trackHeight <= 0) return null;
    let acc: Bounds | null = null;
    trackKeyPositions.forEach((pos, index) => {
      if (!pos || pos.hidden) return;
      const onHitline =
        (pos.rotation ?? 0) === 0 && pos.noteAutoYCorrection !== false;
      const { rect } = translateTrackGeometry(
        trackGeometry(pos, true, onHitline ? contentBounds?.minY : undefined),
        rotatedFlowShiftByIndex.get(index) ?? 0,
      );
      acc = acc ? unionBounds(acc, rect) : rect;
    });
    return acc;
  })();

  // 음수 오프셋·키보다 넓은 노트도 회전 여부와 관계없이 실제 트랙 끝까지 예약
  // 창 바운즈 = 콘텐츠·도달 범위 + 위쪽 트랙 밴드 + 트랙 AABB
  const windowBounds: Bounds | null = (() => {
    if (!bounds) return null;
    const banded = { ...bounds, minY: bounds.minY - reserveTop };
    return trackBounds ? unionBounds(banded, trackBounds) : banded;
  })();

  // 오프셋 계산 - 창 바운즈 원점이 PADDING 안쪽에 오도록
  const offsetX = windowBounds ? PADDING - windowBounds.minX : 0;
  const offsetY = windowBounds ? PADDING - windowBounds.minY : 0;

  // 네이티브 창 크기. 회전 0 레이아웃은 기존 공식(바운즈 + 패딩 + 트랙 밴드)과 같다
  const contentSize = windowBounds
    ? {
        width: windowBounds.maxX - windowBounds.minX + PADDING * 2,
        height: windowBounds.maxY - windowBounds.minY + PADDING * 2,
      }
    : null;

  // 배경 박스 - 콘텐츠 바운즈 + 트랙 밴드 + 회전 얼굴·트랙 + 패딩, 창 좌표 기준.
  // 스프라이트 도달 여유로 창 원점이 왼쪽·위로 밀리면 x·y가 그만큼 커져
  // 배경의 화면상 위치·크기는 오버행 유무와 무관하게 동일하다
  const backgroundBox = (() => {
    if (!contentBounds || !windowBounds) return null;
    let area: Bounds = {
      ...contentBounds,
      minY: contentBounds.minY - reserveTop,
    };
    if (rotatedFaceBounds) area = unionBounds(area, rotatedFaceBounds);
    if (trackBounds) area = unionBounds(area, trackBounds);
    return {
      x: area.minX + offsetX - PADDING,
      y: area.minY + offsetY - PADDING,
      width: area.maxX - area.minX + PADDING * 2,
      height: area.maxY - area.minY + PADDING * 2,
    };
  })();

  // 원본 객체와 오프셋이 그대로면 이전 결과를 재사용한다.
  // 매번 새 객체를 만들면 아래쪽 Key의 React.memo가 항상 깨져,
  // 프리뷰로 키 하나만 움직여도 오버레이의 모든 키가 다시 그려진다
  const applyOffset = <T extends { dx: number; dy: number }>(
    items: T[],
  ): T[] => {
    if (!windowBounds || !items.length) return items;
    return items.map((item) => {
      const cached = offsetCache.get(item);
      if (cached && cached.x === offsetX && cached.y === offsetY) {
        return cached.result as T;
      }
      const shifted = {
        ...item,
        dx: item.dx + offsetX,
        dy: item.dy + offsetY,
      };
      offsetCache.set(item, { x: offsetX, y: offsetY, result: shifted });
      return shifted;
    });
  };

  const displayPositions = applyOffset(currentPositions);
  const displayStatPositions = applyOffset(currentStatPositions);
  const displayGraphPositions = applyOffset(currentGraphPositions);
  const displayKnobPositions = applyOffset(currentKnobPositions);
  const displaySpritePositions = applyOffset(currentSpritePositions);

  const positionOffset = windowBounds
    ? { x: offsetX, y: offsetY }
    : { x: 0, y: 0 };

  // 콘텐츠 상단의 창 좌표. 위쪽 오버행이 없으면 트랙 밴드 + PADDING과 같다
  const topMostY = contentBounds ? contentBounds.minY + offsetY : 0;
  // 콘텐츠 왼쪽의 창 좌표. 왼쪽 오버행이 없으면 PADDING과 같다
  const leftMostX = contentBounds ? contentBounds.minX + offsetX : 0;

  // WebGL 트랙 계산 - 지오메트리는 trackGeometry 단일 정의.
  // 회전 0은 콘텐츠 상단(topMostY), 회전 키는 같은 방향 키들의 공통 시작선에 맞춘다
  const webglTracks = currentKeys
    .map((key, index) => {
      const originalPosition = currentPositions[index];
      if (!originalPosition) return null;
      if (originalPosition.hidden) return null;
      const position = displayPositions[index] ?? originalPosition;
      const rotation = position.rotation ?? 0;
      const useAutoCorrection =
        rotation === 0 && position.noteAutoYCorrection !== false;
      const geometry = translateTrackGeometry(
        computeTrackGeometry({
          keyX: position.dx,
          keyY: position.dy,
          keyWidth: position.width,
          keyHeight: position.height,
          rotation,
          trackHeight,
          noteWidth: position.noteWidth,
          noteAlignment: position.noteAlignment,
          noteOffsetX: position.noteOffsetX,
          noteOffsetY: position.noteOffsetY,
          hitline: useAutoCorrection ? topMostY : undefined,
        }),
        rotatedFlowShiftByIndex.get(index) ?? 0,
      );

      return {
        trackKey: key,
        trackIndex: position.zIndex ?? index,
        position: {
          ...position,
          dx: geometry.origin.x,
          dy: geometry.origin.y,
        },
        // 진행 방향 단위벡터 - 노트 버퍼가 allocate 시점에 스냅샷한다
        direction: geometry.direction,
        width: geometry.crossSize,
        height: trackHeight,
        noteColor: position.noteColor,
        noteOpacity: position.noteOpacity,
        noteOpacityTop: position.noteOpacityTop ?? position.noteOpacity,
        noteOpacityBottom: position.noteOpacityBottom ?? position.noteOpacity,
        noteGlowEnabled: position.noteGlowEnabled ?? false,
        noteGlowSize: position.noteGlowSize ?? 20,
        noteGlowOpacity: position.noteGlowOpacity ?? 70,
        noteGlowOpacityTop:
          position.noteGlowOpacityTop ?? position.noteGlowOpacity ?? 70,
        noteGlowOpacityBottom:
          position.noteGlowOpacityBottom ?? position.noteGlowOpacity ?? 70,
        // 본체 폴백은 resolve가 담당 - 명시 여부가 글로우 소스 우선순위 판별에 필요
        noteGlowColor: position.noteGlowColor,
        flowSpeed: noteSettings?.speed ?? DEFAULT_NOTE_SETTINGS.speed,
        borderRadius: position.noteBorderRadius ?? DEFAULT_NOTE_BORDER_RADIUS,
        noteBorderWidth: position.noteBorderWidth ?? 0,
        noteBorderColor: position.noteBorderColor,
        noteBorderGradient: position.noteBorderGradient ?? null,
        noteBorderOpacity: position.noteBorderOpacity ?? 100,
        noteBorderSide: position.noteBorderSide ?? 'all',
        noteGradient: position.noteGradient ?? null,
        noteGlowGradient: position.noteGlowGradient ?? null,
      };
    })
    .filter(Boolean);

  return {
    // 창 바운즈 (콘텐츠 + 스프라이트 이미지 도달 범위 + 회전 얼굴) - 트랙 밴드 제외
    bounds,
    // 네이티브 창 크기 - 창 바운즈 + 트랙 밴드 + 회전 트랙 + 패딩
    contentSize,
    // 배경이 덮는 박스 - 창 좌표 기준, 오버행 여유는 배경 밖 투명으로 남는다
    backgroundBox,
    displayPositions,
    displayStatPositions,
    displayGraphPositions,
    displayKnobPositions,
    displaySpritePositions,
    positionOffset,
    topMostY,
    leftMostX,
    // fixed-position 델타의 기준점 - 창 바운즈가 아니라 콘텐츠 원점을 쓴다
    contentBounds,
    webglTracks,
  };
}
