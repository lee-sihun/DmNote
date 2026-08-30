import { create } from 'zustand';
import type { SpritePose } from '@src/types/key/sprites';

/**
 * 스프라이트 편집 캔버스 프리뷰 - 패널이 편집 중인 것을 캔버스가 보조 표시하게
 * 공유한다. 자세 팝업은 그 자세의 렌더, 기준점 편집은 축 마커.
 * 편집창(그리드) 전용이고 오버레이는 커밋만 반영한다.
 * 발행자는 속성 패널 하나뿐이라 스택 없이 단일 값으로 충분
 */

export type SpriteEditPreview =
  | {
      kind: 'pose';
      positionId: string;
      poseId: string;
      /** composed poses에 없거나(신규 draft) 커밋 불가 상태일 때 그릴 스냅샷 */
      fallbackPose: SpritePose;
      /** 무효 draft 편집 중 - composed의 옛 canonical 값 대신 스냅샷을 우선한다 */
      preferFallback: boolean;
    }
  | { kind: 'pivot'; positionId: string };

const previewEquals = (a: SpriteEditPreview, b: SpriteEditPreview): boolean => {
  if (a.kind !== b.kind || a.positionId !== b.positionId) return false;
  if (a.kind === 'pivot') return true;
  return (
    b.kind === 'pose' &&
    a.poseId === b.poseId &&
    a.fallbackPose === b.fallbackPose &&
    a.preferFallback === b.preferFallback
  );
};

interface SpriteEditPreviewStore {
  preview: SpriteEditPreview | null;
  publish: (next: SpriteEditPreview) => void;
  clear: () => void;
}

export const useSpriteEditPreviewStore = create<SpriteEditPreviewStore>(
  // 내용이 같으면 set 자체를 건너뛴다 - zustand는 빈 부분 갱신도 리스너를 깨운다
  (set, get) => ({
    preview: null,
    publish: (next) => {
      const prev = get().preview;
      if (prev && previewEquals(prev, next)) return;
      set({ preview: next });
    },
    clear: () => {
      if (get().preview === null) return;
      set({ preview: null });
    },
  }),
);

/**
 * 캔버스 leaf 소비 - 자기 스프라이트의 발행일 때만 프리뷰를 반환해
 * 다른 요소의 발행·회수에 리렌더되지 않는다
 */
export function useSpriteEditPreview(
  positionId: string,
): SpriteEditPreview | null {
  return useSpriteEditPreviewStore((store) =>
    store.preview && store.preview.positionId === positionId
      ? store.preview
      : null,
  );
}
