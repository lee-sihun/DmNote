import { create } from 'zustand';
import type {
  SpriteAnchor,
  SpriteRect,
  SpriteTransform,
} from '@src/types/key/sprites';

/**
 * 온캔버스 자세 기즈모 세션 - 자세 팝업이 열려 있는 동안 그리드 오버레이가
 * 어느 스프라이트의 어떤 자세를 편집 중인지 공유한다.
 * 발행자는 SingleSpritePanel 하나, 소비자는 SpritePoseGizmo 하나
 */

export interface SpritePoseGizmoSession {
  positionId: string;
  poseId: string;
  /** 활동 영역 원점 (그리드 좌표) */
  origin: { dx: number; dy: number };
  imageRect: SpriteRect;
  pivot: SpriteAnchor;
  contactPoint: SpriteAnchor;
  transform: SpriteTransform;
  /** 뻗기 - 노브 드래그가 rotation과 함께 scale까지 역산 */
  stretch: boolean;
  preview: (transform: SpriteTransform) => void;
  commit: (transform: SpriteTransform) => void;
  cancel: () => void;
  commitContactPoint: (point: SpriteAnchor) => void;
}

interface SpritePoseGizmoState {
  session: SpritePoseGizmoSession | null;
  /** 소유권 세대 - 세션 종료·대상 교체 때 증가. 포인터 이벤트 사이에 대상이
      갈려도 이전 드래그가 새 세션을 소유할 수 없다 (gradient 세션과 동일 규칙) */
  generation: number;
  lastOwnerKey: string | null;
  setSession: (session: SpritePoseGizmoSession | null) => void;
  /** 리사이즈 착지 등 좌표 기준이 바뀔 때 세대만 올려 진행 중 드래그의
      커밋을 무효화한다 - 세션 자체는 유지되고 다음 드래그는 새 세대를 잡는다 */
  invalidateOwnership: (positionId: string) => void;
}

const ownerKey = (session: SpritePoseGizmoSession): string =>
  `${session.positionId}\n${session.poseId}`;

export const useSpritePoseGizmoStore = create<SpritePoseGizmoState>((set) => ({
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
      return key !== state.lastOwnerKey
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
}));
