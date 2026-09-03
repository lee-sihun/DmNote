import { create } from 'zustand';
import type { SpriteAnchor, SpriteTransform } from '@src/types/key/sprites';
import type { SpritePlacement } from '@utils/sprite/spritePlacement';

/**
 * 온캔버스 자세 핸들 세션 - 자세 팝업이 열려 있는 동안 그리드 오버레이가
 * 어느 스프라이트의 어떤 자세를 편집 중인지 공유한다.
 * 발행자는 SingleSpritePanel 하나, 소비자는 SpriteCanvasHandles 하나
 */

export interface SpritePoseHandleSession {
  positionId: string;
  poseId: string;
  /** 요소 원점 (그리드 좌표) */
  origin: { dx: number; dy: number };
  /** 요소 상자와 기준점 - 회전·배율 축 P의 근거 */
  width: number;
  height: number;
  /** 요소의 공통 논리 원점 */
  pivot: SpriteAnchor;
  /** 상태 이미지 내부 기준점. 연결 상태에서는 pivot과 같다 */
  imagePivot: SpriteAnchor;
  followsBasePivot: boolean;
  /** 자세 이미지의 배치 (요소 로컬 px) - 프레임 폴리곤의 원본 */
  placement: SpritePlacement;
  transform: SpriteTransform;
  preview: (transform: SpriteTransform) => void;
  commit: (transform: SpriteTransform) => void;
  previewPivot: (pivot: SpriteAnchor, transform: SpriteTransform) => void;
  commitPivot: (pivot: SpriteAnchor, transform: SpriteTransform) => void;
  cancel: () => void;
}

interface SpritePoseHandleState {
  session: SpritePoseHandleSession | null;
  /** 소유권 세대 - 세션 종료·대상 교체 때 증가. 포인터 이벤트 사이에 대상이
      갈려도 이전 드래그가 새 세션을 소유할 수 없다 (gradient 세션과 동일 규칙) */
  generation: number;
  lastOwnerKey: string | null;
  setSession: (session: SpritePoseHandleSession | null) => void;
  /** 리사이즈 착지 등 좌표 기준이 바뀔 때 세대만 올려 진행 중 드래그의
      커밋을 무효화한다 - 세션 자체는 유지되고 다음 드래그는 새 세대를 잡는다 */
  invalidateOwnership: (positionId: string) => void;
}

const ownerKey = (session: SpritePoseHandleSession): string =>
  `${session.positionId}\n${session.poseId}`;

const sameSessionGeometry = (
  current: SpritePoseHandleSession,
  next: SpritePoseHandleSession,
): boolean =>
  current.origin.dx === next.origin.dx &&
  current.origin.dy === next.origin.dy &&
  current.width === next.width &&
  current.height === next.height &&
  current.pivot.x === next.pivot.x &&
  current.pivot.y === next.pivot.y &&
  current.imagePivot.x === next.imagePivot.x &&
  current.imagePivot.y === next.imagePivot.y &&
  current.placement.rect.x === next.placement.rect.x &&
  current.placement.rect.y === next.placement.rect.y &&
  current.placement.rect.width === next.placement.rect.width &&
  current.placement.rect.height === next.placement.rect.height &&
  current.transform.x === next.transform.x &&
  current.transform.y === next.transform.y &&
  current.transform.rotation === next.transform.rotation &&
  current.transform.scale === next.transform.scale;

export const useSpritePoseHandleStore = create<SpritePoseHandleState>(
  (set) => ({
    session: null,
    generation: 0,
    lastOwnerKey: null,
    setSession: (session) =>
      set((state) => {
        if (!session) {
          return state.session
            ? {
                session: null,
                lastOwnerKey: null,
                generation: state.generation + 1,
              }
            : {};
        }
        const key = ownerKey(session);
        const geometryChanged =
          state.session !== null &&
          key === state.lastOwnerKey &&
          !sameSessionGeometry(state.session, session);
        return key !== state.lastOwnerKey || geometryChanged
          ? {
              session,
              lastOwnerKey: key,
              generation: state.generation + 1,
            }
          : { session };
      }),
    invalidateOwnership: (positionId) =>
      set((state) =>
        state.session?.positionId === positionId
          ? { generation: state.generation + 1 }
          : {},
      ),
  }),
);
