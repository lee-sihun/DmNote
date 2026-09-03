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

      // 노트 오프셋에 의한 트랙 영역 확장 반영
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

  // 창 바운즈 계산 - 스프라이트는 클리핑하지 않으므로 이미지 도달 범위
  // (모든 자세의 회전·확대·오프셋 AABB 합집합, 전환 오버슈트 여유 포함)가
  // 요소 상자를 넘으면 그만큼 창을 넓혀 네이티브 창 가장자리 잘림을 막는다.
  // 배경 박스는 콘텐츠 바운즈 기준을 유지해 눈에 보이는 크기는 변하지 않는다
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

  // 오프셋 계산
  const topOffset = trackHeight + PADDING;
  const offsetX = bounds ? PADDING - bounds.minX : 0;
  const offsetY = bounds ? topOffset - bounds.minY : 0;

  // 배경 박스 - 콘텐츠 바운즈 + 패딩, 창 좌표 기준.
  // 스프라이트 도달 여유로 창 원점이 왼쪽·위로 밀리면 x·y가 그만큼 커져
  // 배경의 화면상 위치·크기는 오버행 유무와 무관하게 동일하다
  const backgroundBox =
    bounds && contentBounds
      ? {
          x: contentBounds.minX - bounds.minX,
          y: contentBounds.minY - bounds.minY,
          width: contentBounds.maxX - contentBounds.minX + PADDING * 2,
          height: contentBounds.maxY - contentBounds.minY + PADDING + topOffset,
        }
      : null;

  // 원본 객체와 오프셋이 그대로면 이전 결과를 재사용한다.
  // 매번 새 객체를 만들면 아래쪽 Key의 React.memo가 항상 깨져,
  // 프리뷰로 키 하나만 움직여도 오버레이의 모든 키가 다시 그려진다
  const applyOffset = <T extends { dx: number; dy: number }>(
    items: T[],
  ): T[] => {
    if (!bounds || !items.length) return items;
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

  const positionOffset = bounds ? { x: offsetX, y: offsetY } : { x: 0, y: 0 };

  // 콘텐츠 상단의 창 좌표. 스프라이트 오버행이 위로 없으면 topOffset과 같다
  const topMostY = contentBounds ? contentBounds.minY + offsetY : 0;
  // 콘텐츠 왼쪽의 창 좌표. 왼쪽 오버행이 없으면 PADDING과 같다
  const leftMostX = contentBounds ? contentBounds.minX + offsetX : 0;

  // WebGL 트랙 계산
  const webglTracks = currentKeys
    .map((key, index) => {
      const originalPosition = currentPositions[index];
      if (!originalPosition) return null;
      if (originalPosition.hidden) return null;
      const position = displayPositions[index] ?? originalPosition;
      const useAutoCorrection = position.noteAutoYCorrection !== false;
      const trackStartY = useAutoCorrection ? topMostY : position.dy;
      const keyWidth = position.width;
      const desiredNoteWidth =
        typeof position.noteWidth === 'number' &&
        Number.isFinite(position.noteWidth)
          ? Math.max(1, position.noteWidth)
          : keyWidth;
      const noteAlign = position.noteAlignment ?? 'center';
      const noteAlignOffsetX =
        noteAlign === 'left'
          ? 0
          : noteAlign === 'right'
          ? keyWidth - desiredNoteWidth
          : (keyWidth - desiredNoteWidth) / 2;
      const userOffsetX = position.noteOffsetX ?? 0;
      const userOffsetY = position.noteOffsetY ?? 0;

      return {
        trackKey: key,
        trackIndex: position.zIndex ?? index,
        position: {
          ...position,
          dx: position.dx + noteAlignOffsetX + userOffsetX,
          dy: trackStartY + userOffsetY,
        },
        width: desiredNoteWidth,
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
    // 창 크기 계산이 쓰는 창 바운즈 (콘텐츠 + 스프라이트 이미지 도달 범위)
    bounds,
    // 배경이 덮는 박스 - 창 좌표 기준, 오버행 여유는 배경 밖 투명으로 남는다
    backgroundBox,
    displayPositions,
    displayStatPositions,
    displayGraphPositions,
    displayKnobPositions,
    displaySpritePositions,
    positionOffset,
    // 창 높이·배경 박스가 같은 값을 쓰도록 노출
    topOffset,
    topMostY,
    leftMostX,
    // fixed-position 델타의 기준점 - 창 바운즈가 아니라 콘텐츠 원점을 쓴다
    contentBounds,
    webglTracks,
  };
}
