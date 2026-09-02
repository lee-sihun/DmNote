import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { spriteItemsApi } from '@api/modules/itemsApi';
import { clamp } from '@utils/core/clamp';
import { stableStringify } from '@utils/core/stableStringify';
import { pickValidatedImagePath } from '@utils/core/pickValidatedImage';
import { anchorToPercent, percentToAnchor } from '@utils/sprite/spriteGeometry';
import { isHTMLElementNode } from '@utils/dom/isElementNode';
import { projectSpriteResize } from '@utils/sprite/resizeProjection';
import {
  copyPoseName,
  materializePoseNames,
  resolvePoseNames,
} from '@utils/sprite/spritePoseNames';
import { toSpriteWireShape } from '@utils/sprite/spriteWireShape';
import { slotDisplayName } from '@utils/keySlot';
import { ACTION_BUTTON_CLASS, AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import { useSpriteEditPreviewStore } from '@stores/grid/useSpriteEditPreviewStore';
import { useSpritePoseGizmoStore } from '@stores/grid/useSpritePoseGizmoStore';
import {
  contactWorldPosition,
  solveTranslationKeepingContact,
  type ContactGeometry,
} from '@utils/sprite/contactSolver';
import {
  DEFAULT_SPRITE_CONTACT_POINT,
  DEFAULT_SPRITE_TRANSITION_EASING,
  IDENTITY_SPRITE_TRANSFORM,
  SPRITE_CONSTRAINTS,
  findDuplicateTriggerPose,
  type ReactiveSpritePosition,
  type SpriteActivation,
  type SpriteAnchor,
  type SpritePose,
  type SpriteTransform,
} from '@src/types/key/sprites';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import { PANEL_ROOT_CLASS, PANEL_HEADER_CLASS } from '../panelChrome';
import {
  PropertyRow,
  PropertySection,
  NumberInput,
  TABS,
  TabType,
} from '../index';
import Dropdown from '@components/main/common/Dropdown';
import ListAddRow from '@components/main/common/ListAddRow';
import PopupExit from '@components/main/Modal/PopupExit';
import ListPopup, { type ListItem } from '@components/main/Modal/ListPopup';
import {
  pickerRowClass,
  pickerMoreButtonClass,
  pickerMoreButtonVisibleClass,
  pickerMoreButtonHiddenClass,
} from '@components/main/Modal/content/pickers/pickerRowClass';
import MoreVerticalIcon from '@components/main/Modal/content/pickers/MoreVerticalIcon';
import { usePickerItemMenu } from '@hooks/usePickerItemMenu';
import EditSessionBoundary from '../EditSessionBoundary';
import SpritePoseEditorPopup from './SpritePoseEditorPopup';
import SpriteImageSettingsPopup from './SpriteImageSettingsPopup';
import PanelRenameTitle from '../PanelRenameTitle';

// 계약과 동일한 cubic-bezier 문자열만 저장 (transitionEasing은 문자열 그대로 CSS로 간다)
const SPRITE_EASING_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Default', value: DEFAULT_SPRITE_TRANSITION_EASING },
  { label: 'Linear', value: 'cubic-bezier(0, 0, 1, 1)' },
  { label: 'Ease Out', value: 'cubic-bezier(0, 0, 0.58, 1)' },
  { label: 'Ease In', value: 'cubic-bezier(0.42, 0, 1, 1)' },
  { label: 'Ease In-Out', value: 'cubic-bezier(0.42, 0, 0.58, 1)' },
  { label: 'Overshoot', value: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
];

// 편집 팝업 대상 - 두 변형 모두 소유 스프라이트에 결합한다
// (대상 초기화 effect 전 한 렌더 동안 다음 스프라이트 재사용 방지)
type SpriteEditorTarget =
  | { kind: 'image'; positionId: string }
  | { kind: 'pose'; positionId: string; poseId: string };

const isSameEditorTarget = (
  current: SpriteEditorTarget | null,
  next: SpriteEditorTarget,
): boolean => {
  if (current === null) return false;
  if (current.kind !== next.kind) return false;
  if (current.positionId !== next.positionId) return false;
  return current.kind === 'pose'
    ? next.kind === 'pose' && current.poseId === next.poseId
    : true;
};

interface SingleSpritePanelProps {
  setPanelElement: (el: HTMLDivElement | null) => void;
  panelElement: HTMLDivElement | null;
  singleSpritePosition: CanonicalReactiveSpritePosition;
  selectedKeyType: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameValue: string;
  setRenameValue: (value: string) => void;
  renameCancelledRef: React.MutableRefObject<boolean>;
  handleRenameCommit: (value: string) => void;
  handleRenameCancel: () => void;
  handleRenameStart: () => void;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  t: (key: string) => string;
}

export const SingleSpritePanel: React.FC<SingleSpritePanelProps> = ({
  setPanelElement,
  panelElement,
  singleSpritePosition,
  selectedKeyType,
  isRenaming,
  renameInputRef,
  renameValue,
  setRenameValue,
  renameCancelledRef,
  handleRenameCommit,
  handleRenameCancel,
  handleRenameStart,
  singleScrollRefFor,
  t,
}) => {
  const position = singleSpritePosition;
  const keyMappings = useKeyStore((state) => state.keyMappings);
  const canonicalKeyPositions = useKeyStore(
    (state) => state.canonicalPositions,
  );
  const loadingImageRef = useRef(false);

  // 편집 팝업 앵커 - 여는 순간의 행·버튼(또는 웰)을 담는다
  const poseAnchorRef = useRef<HTMLElement | null>(null);
  // 상태 목록 영역 - 여기서의 pointerdown은 팝업 바깥닫힘을 거치지 않고
  // 행 클릭이 대상을 직접 교체한다 (닫힘-재열림 사이 idle 프리뷰 깜빡임 방지)
  const poseListRef = useRef<HTMLDivElement | null>(null);
  const [editorTarget, setEditorTarget] = useState<SpriteEditorTarget | null>(
    null,
  );
  // 도우미 토글 - 저장하지 않는 편집 세션 상태.
  // 핀 고정: 회전·배율 스크럽이 손끝을 제자리에 두도록 x·y 역산
  // 뻗기: 캔버스 노브 드래그가 scale까지 역산
  const [pinLockEnabled, setPinLockEnabled] = useState(false);
  const [stretchEnabled, setStretchEnabled] = useState(false);

  // 무효 자세(빈/중복 트리거)는 백엔드가 거부하므로 커밋 착지 전까지 패널이 값을 들고 있는다
  const [posesDraft, setPosesDraft] = useState<{
    id: string;
    poses: SpritePose[];
  } | null>(null);

  // 대상이 갈리면 팝업을 닫고 draft를 버린다 - effect의 동기 setState는
  // 캐스케이드 렌더라 렌더 중 보정 패턴을 쓴다
  const panelTargetKey = `${selectedKeyType}\n${position.id}`;
  const [lastPanelTargetKey, setLastPanelTargetKey] = useState(panelTargetKey);
  if (panelTargetKey !== lastPanelTargetKey) {
    setLastPanelTargetKey(panelTargetKey);
    setEditorTarget(null);
    setPosesDraft(null);
    setPinLockEnabled(false);
    setStretchEnabled(false);
  }

  // draft는 커밋이 canonical에 착지하면 지운다 - position prop이 곧 canonical.
  // 백엔드 직렬화 순서가 초안과 달라도 같은 내용이면 착지로 본다
  if (
    posesDraft &&
    posesDraft.id === position.id &&
    stableStringify(position.poses) === stableStringify(posesDraft.poses)
  ) {
    setPosesDraft(null);
  }

  // 리사이즈 착지 시 draft rebase - canonical 콘텐츠가 이전 스냅샷의 projection과
  // 정확히 일치하면(리사이즈 정산) 무효 draft의 자세도 같은 배율로 따라간다.
  // 판정은 합성 prop이 아니라 스토어 기준 - 활성 스크럽 프리뷰가 prop의 poses를
  // 덮어도 착지 감지가 빗나가지 않는다. 박스만 바뀌는 legacy patch는 imageRect가
  // 어긋나 제외되고, undo 복원은 왕복 오차로 불일치할 수 있어 건드리지 않는다
  const storePosition = useSpriteStore(
    (state: { positions: Record<string, ReactiveSpritePosition[]> }) =>
      state.positions[selectedKeyType]?.find(
        (candidate) => candidate.id === position.id,
      ) ?? null,
  );
  const canonicalPosition = storePosition ?? position;
  const [lastPositionSnapshot, setLastPositionSnapshot] =
    useState(canonicalPosition);
  // 리사이즈 착지 취소 신호 - 착지 시점의 스프라이트를 함께 실어 effect가
  // 렌더 시점 대상이 아니라 착지 대상에 작용한다
  const [resizeGestureCancel, setResizeGestureCancel] = useState<{
    tick: number;
    positionId: string;
  } | null>(null);
  if (lastPositionSnapshot !== canonicalPosition) {
    setLastPositionSnapshot(canonicalPosition);
    let draftRebased = false;
    if (
      lastPositionSnapshot.id === canonicalPosition.id &&
      (lastPositionSnapshot.width !== canonicalPosition.width ||
        lastPositionSnapshot.height !== canonicalPosition.height)
    ) {
      const nextBounds = {
        dx: canonicalPosition.dx,
        dy: canonicalPosition.dy,
        width: canonicalPosition.width,
        height: canonicalPosition.height,
      };
      const projected = projectSpriteResize(lastPositionSnapshot, nextBounds);
      const resizeLanded =
        stableStringify(projected.imageRect) ===
          stableStringify(canonicalPosition.imageRect) &&
        stableStringify(projected.idleTransform) ===
          stableStringify(canonicalPosition.idleTransform) &&
        stableStringify(projected.poses) ===
          stableStringify(canonicalPosition.poses);
      if (resizeLanded) {
        if (posesDraft && posesDraft.id === canonicalPosition.id) {
          setPosesDraft({
            id: posesDraft.id,
            poses: projectSpriteResize(
              { ...lastPositionSnapshot, poses: posesDraft.poses },
              nextBounds,
            ).poses,
          });
          draftRebased = true;
        }
        // 편집 팝업(자세·이미지 설정)이 열린 채 착지하면 세대를 올린다 -
        // 팝업 리마운트가 진행 중 스크럽 세션을 취소로 닫고, 아래 effect가
        // preview 게스처를 정산해 이전 배율의 절대값 커밋을 차단한다
        if (editorTarget && editorTarget.positionId === canonicalPosition.id) {
          setResizeGestureCancel((prev) => ({
            tick: (prev?.tick ?? 0) + 1,
            positionId: canonicalPosition.id,
          }));
        }
      }
    }
    // 외부에서 poses가 갈리면(undo·redo·다른 창 편집) 초안을 버린다.
    // 내 커밋 착지는 canonical이 초안과 같아 여기 걸리지 않으므로, 무효 초안이
    // 남아 있다가 다시 유효해지는 순간 이전 배열을 통째로 되살리는 것만 막는다.
    // 폐기는 되돌릴 수 없어 키 순서에 둔감한 비교를 쓴다 - 백엔드 문서 교체로
    // 직렬화 순서만 바뀐 것을 외부 변경으로 오판하면 편집 중인 값이 사라진다
    if (
      !draftRebased &&
      posesDraft &&
      posesDraft.id === canonicalPosition.id &&
      lastPositionSnapshot.id === canonicalPosition.id &&
      stableStringify(lastPositionSnapshot.poses) !==
        stableStringify(canonicalPosition.poses) &&
      stableStringify(canonicalPosition.poses) !==
        stableStringify(posesDraft.poses)
    ) {
      setPosesDraft(null);
    }
  }

  // 게스처 취소는 렌더 밖에서 - cancel은 활성 게스처가 없으면 no-op이라
  // 정산이 이미 끝난 일반 경로에는 영향이 없다 (계약의 세션 정산 폴백).
  // 기즈모는 세대 무효화로 진행 중 드래그의 pointerup 커밋을 떨군다
  useLayoutEffect(() => {
    if (!resizeGestureCancel) return;
    editGestureController.cancel();
    useSpritePoseGizmoStore
      .getState()
      .invalidateOwnership(resizeGestureCancel.positionId);
  }, [resizeGestureCancel]);

  // 담당 키 후보: 현재 모드의 키 요소 목록 (값은 요소 id, 라벨은 슬롯 표시명)
  const modeSlots = keyMappings[selectedKeyType] ?? [];
  const keyOptions = (canonicalKeyPositions[selectedKeyType] ?? []).flatMap(
    (keyPosition, index) => {
      if (!keyPosition.id) return [];
      const label =
        slotDisplayName(modeSlots[index] ?? '') || `Key ${index + 1}`;
      return [{ id: keyPosition.id, label }];
    },
  );
  const displayPoses =
    posesDraft && posesDraft.id === position.id
      ? posesDraft.poses
      : position.poses;
  const duplicatePose = findDuplicateTriggerPose(displayPoses);
  const hasEmptyTriggerPose = displayPoses.some(
    (pose) => pose.triggers.length === 0,
  );
  const posesCommittable = duplicatePose === null && !hasEmptyTriggerPose;

  // 대상 초기화 effect가 돌기 전 한 렌더 동안 다음 스프라이트에 팝업이
  // 재사용되지 않게 소유자 일치를 렌더 단계에서 판정한다
  const activeEditorTarget =
    editorTarget && editorTarget.positionId === position.id
      ? editorTarget
      : null;
  const editingPoseIndex =
    activeEditorTarget?.kind === 'pose'
      ? displayPoses.findIndex(
          (pose) => pose.poseId === activeEditorTarget.poseId,
        )
      : -1;
  const editingPose =
    editingPoseIndex >= 0 ? displayPoses[editingPoseIndex] : null;
  const imageEditing = activeEditorTarget?.kind === 'image';

  // 기준점 행을 만지는 동안 캔버스에 축 마커를 띄운다 (포커스 또는 접두 스크럽)
  const pivotRowRef = useRef<HTMLDivElement | null>(null);
  const [pivotEngaged, setPivotEngaged] = useState(false);
  useEffect(() => {
    if (!pivotEngaged) return;
    // 접두 스크럽은 포커스를 옮기지 않는다 - 포인터를 뗀 뒤 포커스가 행 밖이면 해제
    const ownerWindow =
      pivotRowRef.current?.ownerDocument.defaultView ?? window;
    const handleUp = () => {
      const row = pivotRowRef.current;
      if (row && row.contains(row.ownerDocument.activeElement)) return;
      setPivotEngaged(false);
    };
    ownerWindow.addEventListener('pointerup', handleUp);
    return () => ownerWindow.removeEventListener('pointerup', handleUp);
  }, [pivotEngaged]);

  // 편집 중인 것을 캔버스 보조 표시로 발행한다 (편집창 전용).
  // 자세 팝업은 그 자세의 렌더(draft도 스냅샷으로), 기준점 편집은 축 마커
  useLayoutEffect(() => {
    const store = useSpriteEditPreviewStore.getState();
    if (activeEditorTarget?.kind === 'pose' && editingPose) {
      store.publish({
        kind: 'pose',
        positionId: activeEditorTarget.positionId,
        poseId: editingPose.poseId,
        fallbackPose: editingPose,
        // 무효 draft는 canonical에 착지하지 못하므로 캔버스가 스냅샷을 우선한다
        preferFallback: !posesCommittable,
      });
    } else if (pivotEngaged) {
      store.publish({ kind: 'pivot', positionId: position.id });
    } else {
      store.clear();
    }
  }, [
    activeEditorTarget,
    editingPose,
    posesCommittable,
    pivotEngaged,
    position.id,
  ]);
  // 언마운트 잔류 방지 - layout 시점에 회수해 한 프레임 잔상도 남기지 않는다
  useLayoutEffect(() => () => useSpriteEditPreviewStore.getState().clear(), []);

  // 비동기 이미지 선택 완료 시점의 유효성 - 대상 전환·언마운트가 지나면 세대가
  // 갈려 이전 요청을 폐기한다. 자세 결합은 최신 poses에서 poseId로 다시 찾는다
  const asyncGenerationRef = useRef(0);
  useLayoutEffect(() => {
    const generation = asyncGenerationRef;
    return () => {
      generation.current += 1;
    };
  }, [position.id, selectedKeyType]);
  const latestPosesRef = useRef(displayPoses);
  useEffect(() => {
    latestPosesRef.current = displayPoses;
  });

  // id 기반 필드 패치 커밋: 직렬 슬롯 안 최신 base로 patch를 생성해
  // 낙관 로컬 적용이 즉시 canonical에 반영된다.
  // 활성 preview 게스처가 있으면 gestureId를 실어 정산한다
  const commitFields = (patch: Partial<ReactiveSpritePosition>) => {
    const gestureId = editGestureController.activeGestureId() ?? undefined;
    const persisted = spriteItemsApi.patchPosition(
      selectedKeyType,
      position.id,
      patch,
      gestureId,
    );
    editGestureController.settleCommit(persisted);
    void persisted
      .then((result) => {
        // 무커밋 조용 종료 방지: 대상 소실은 흔적을 남긴다
        if (result === 'targetMissing') {
          console.error('Sprite patch target missing', position.id);
        }
      })
      .catch((error) => {
        console.error('Failed to update sprite', error);
      });
  };

  // 스크럽·타이핑 실시간 프리뷰 (spritePosition 도메인)
  const previewFields = (patch: Record<string, unknown>) => {
    if (!isNativeElementId(position.id)) return;
    const locator = resolveElementById('sprite', position.id);
    if (!locator) return;
    editGestureController.preview(locator.mode, [{ id: position.id, patch }], {
      domain: 'spritePosition',
    });
  };

  const updatePoses = (rawPoses: SpritePose[]) => {
    // draft와 커밋이 같은 wire 정규형(트리거 정렬·dedup)을 공유해야
    // canonical 착지 비교가 일치해 draft가 제때 풀린다
    const nextPoses = toSpriteWireShape({ ...position, poses: rawPoses }).poses;
    setPosesDraft({ id: position.id, poses: nextPoses });
    const blocked =
      nextPoses.some((pose) => pose.triggers.length === 0) ||
      findDuplicateTriggerPose(nextPoses) !== null;
    if (blocked) {
      // 열린 preview 게스처에 무효 poses가 실려 커밋 경계로 승격되지 않게 닫는다
      editGestureController.cancel();
      return;
    }
    commitFields({ poses: nextPoses });
  };

  const replacePose = (poseIndex: number, patch: Partial<SpritePose>) =>
    updatePoses(
      displayPoses.map((pose, index) =>
        index === poseIndex ? { ...pose, ...patch } : pose,
      ),
    );

  const poseGeometry = (pose: SpritePose): ContactGeometry => ({
    imageRect: position.imageRect,
    pivot: position.pivot,
    contactPoint: pose.contactPoint,
  });

  // 핀 고정 보정 - 회전·배율 변경에만 적용한다. x·y 직접 입력은 위치 지정 의도라
  // 건드리지 않고, 퇴화(핀=축)면 원값 그대로 둔다
  const withPinLock = (next: SpriteTransform): SpriteTransform => {
    if (!pinLockEnabled || !editingPose) return next;
    const base = editingPose.transform;
    if (next.rotation === base.rotation && next.scale === base.scale) {
      return next;
    }
    const geometry = poseGeometry(editingPose);
    const solved = solveTranslationKeepingContact(
      geometry,
      { rotation: next.rotation, scale: next.scale },
      contactWorldPosition(geometry, base),
    );
    return solved.status === 'ok' ? solved.transform : next;
  };

  // 자세 필드 실시간 프리뷰 - 커밋 가능하면 gesture 채널, 무효 draft면 캔버스 스냅샷
  const previewPosePatch = (patch: Partial<SpritePose>) => {
    if (posesCommittable) {
      previewFields({
        poses: displayPoses.map((entry, index) =>
          index === editingPoseIndex ? { ...entry, ...patch } : entry,
        ),
      });
      return;
    }
    if (!editingPose) return;
    useSpriteEditPreviewStore.getState().publish({
      kind: 'pose',
      positionId: position.id,
      poseId: editingPose.poseId,
      fallbackPose: { ...editingPose, ...patch },
      preferFallback: true,
    });
  };

  const handleTransformPreview = (next: SpriteTransform) =>
    previewPosePatch({ transform: withPinLock(next) });

  const handleTransformCommit = (next: SpriteTransform) =>
    replacePose(editingPoseIndex, { transform: withPinLock(next) });

  const handleTransformCancel = () => {
    editGestureController.cancel();
    // 무효 draft 스크럽은 스냅샷 채널이라 gesture 취소가 복원하지 못한다
    if (!posesCommittable && editingPose) {
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: position.id,
        poseId: editingPose.poseId,
        fallbackPose: editingPose,
        preferFallback: true,
      });
    }
  };

  // 기즈모 콜백은 ref 경유 - 세션 재발행 없이 항상 최신 렌더의 배선을 쓴다
  const gizmoHandlersRef = useRef<{
    preview: (next: SpriteTransform) => void;
    commit: (next: SpriteTransform) => void;
    cancel: () => void;
    commitContactPoint: (point: SpriteAnchor) => void;
  } | null>(null);
  // layout 단계 갱신 - 같은 커밋의 passive effect(기즈모의 undo 취소)가 이전 렌더의
  // 클로저를 불러 낡은 draft를 preview로 되살리지 않게 한다
  useLayoutEffect(() => {
    gizmoHandlersRef.current = {
      // 노브 드래그는 축 고정 역산이 x·y까지 이미 정했다 - 핀 고정 보정 미적용
      preview: (next) => previewPosePatch({ transform: next }),
      commit: (next) => replacePose(editingPoseIndex, { transform: next }),
      cancel: handleTransformCancel,
      commitContactPoint: (point) =>
        replacePose(editingPoseIndex, { contactPoint: point }),
    };
  });

  // 자세 팝업이 열려 있는 동안 캔버스 기즈모 세션 발행
  useLayoutEffect(() => {
    const store = useSpritePoseGizmoStore.getState();
    if (activeEditorTarget?.kind === 'pose' && editingPose) {
      store.setSession({
        positionId: position.id,
        poseId: editingPose.poseId,
        origin: { dx: position.dx, dy: position.dy },
        imageRect: position.imageRect,
        pivot: position.pivot,
        contactPoint: editingPose.contactPoint,
        transform: editingPose.transform,
        stretch: stretchEnabled,
        preview: (next) => gizmoHandlersRef.current?.preview(next),
        commit: (next) => gizmoHandlersRef.current?.commit(next),
        cancel: () => gizmoHandlersRef.current?.cancel(),
        commitContactPoint: (point) =>
          gizmoHandlersRef.current?.commitContactPoint(point),
      });
    } else {
      store.setSession(null);
    }
  }, [
    activeEditorTarget,
    editingPose,
    position.id,
    position.dx,
    position.dy,
    position.imageRect,
    position.pivot,
    stretchEnabled,
  ]);
  // 언마운트 뒤에도 기즈모는 드래그 시작 시점 세션을 붙들고 취소를 부른다. 마지막
  // 렌더의 배선이 남아 있으면 무효 draft를 fallback preview로 다시 발행해 버린 자세가
  // 캔버스에 남으므로, 게스처만 닫는 배선으로 바꾼 뒤 세션을 내린다
  useLayoutEffect(
    () => () => {
      gizmoHandlersRef.current = {
        preview: () => {},
        commit: () => {},
        cancel: () => editGestureController.cancel(),
        commitContactPoint: () => {},
      };
      useSpritePoseGizmoStore.getState().setSession(null);
    },
    [],
  );

  const togglePoseTrigger = (poseIndex: number, keyId: string) => {
    const pose = displayPoses[poseIndex];
    if (!pose) return;
    const nextTriggers = pose.triggers.includes(keyId)
      ? pose.triggers.filter((id) => id !== keyId)
      : [...pose.triggers, keyId];
    replacePose(poseIndex, { triggers: nextTriggers });
  };

  // 대상 전환·닫기 전 팝업 안 포커스 동기 정산 - 미커밋 draft는 이전 대상에 커밋되고
  // 새 세션은 빈 상태로 시작한다
  const settleEditorPopupFocus = () => {
    // 분리 패널은 다른 창 문서라 instanceof 대신 캐스팅
    const ownerDocument = panelElement?.ownerDocument ?? document;
    const active = ownerDocument.activeElement as HTMLElement | null;
    if (
      active?.matches('input, textarea') &&
      active.closest('[role="dialog"]')
    ) {
      flushSync(() => active.blur());
    }
  };

  const openEditorPopup = (target: SpriteEditorTarget, anchor: HTMLElement) => {
    settleEditorPopupFocus();
    if (isSameEditorTarget(editorTarget, target)) {
      setEditorTarget(null);
      return;
    }
    poseAnchorRef.current = anchor;
    setEditorTarget(target);
  };

  const addPose = (anchor: HTMLElement) => {
    if (displayPoses.length >= SPRITE_CONSTRAINTS.maxPoses) return;
    const materialized = materializePoseNames(displayPoses, poseNameLabel);
    const pose: SpritePose = {
      poseId: crypto.randomUUID(),
      name: nextDefaultPoseName(materialized),
      triggers: [],
      // 새 상태는 항등에서 출발 - 기본 배치와의 차이만 상태가 가진다
      transform: { ...IDENTITY_SPRITE_TRANSFORM },
      imageOverride: null,
      // 핀은 이전 상태를 따라간다 - 정렬된 이미지 세트에서 재지정 반복 방지
      contactPoint: {
        ...(materialized.at(-1)?.contactPoint ?? DEFAULT_SPRITE_CONTACT_POINT),
      },
    };
    updatePoses([...materialized, pose]);
    // 새 상태는 담당 키 선택이 다음 단계라 편집 팝업을 바로 연다.
    // 추가 행은 마지막 상태에서 같은 렌더에 사라지므로 웰 컨테이너를 앵커로 쓴다
    openEditorPopup(
      { kind: 'pose', positionId: position.id, poseId: pose.poseId },
      anchor.parentElement ?? anchor,
    );
  };

  const removePose = (poseIndex: number) =>
    updatePoses(
      materializePoseNames(displayPoses, poseNameLabel).filter(
        (_, index) => index !== poseIndex,
      ),
    );

  const clonePose = (sourcePoseId: string) => {
    if (displayPoses.length >= SPRITE_CONSTRAINTS.maxPoses) return;
    const materialized = materializePoseNames(displayPoses, poseNameLabel);
    const sourceIndex = materialized.findIndex(
      (entry) => entry.poseId === sourcePoseId,
    );
    if (sourceIndex < 0) return;
    const source = materialized[sourceIndex];
    const pose: SpritePose = {
      ...source,
      poseId: crypto.randomUUID(),
      name: copyPoseName(
        materialized,
        sourceIndex,
        poseNameLabel,
        t('common.copySuffix') || '복제',
      ),
      transform: { ...source.transform },
      // 같은 트리거 집합은 저장이 거부되므로 담당 키는 비워서 시작한다.
      // 빈 트리거 draft는 상태 추가와 같은 보류 경로를 탄다
      triggers: [],
    };
    updatePoses([
      ...materialized.slice(0, sourceIndex + 1),
      pose,
      ...materialized.slice(sourceIndex + 1),
    ]);
    // 사본은 원본 바로 아래 행 - 담당 키 지정이 다음 단계라 편집 팝업을 바로 연다.
    // 분리 패널 창의 행은 다른 realm이라 instanceof 대신 realm-safe 판정을 쓴다
    const sourceRow = poseListRef.current?.children[sourceIndex];
    const anchor = isHTMLElementNode(sourceRow)
      ? sourceRow
      : poseListRef.current ?? panelElement;
    if (!anchor) return;
    openEditorPopup(
      { kind: 'pose', positionId: position.id, poseId: pose.poseId },
      anchor,
    );
  };

  // 행 ⋮ 메뉴 - 피커 행과 같은 부품 (이름 변경·복제·삭제)
  const poseMenu = usePickerItemMenu<string>();
  const poseMenuItems: ListItem[] = [
    { id: 'rename', label: t('contextMenu.rename') || '이름 변경' },
    {
      id: 'duplicate',
      label: t('contextMenu.duplicate') || '복제',
      disabled: displayPoses.length >= SPRITE_CONSTRAINTS.maxPoses,
    },
    { id: 'delete', label: t('propertiesPanel.delete') || '삭제' },
  ];

  // 행 인라인 이름 변경 - 레이어 탭·피커 행과 같은 규약 (Escape·blur 경합은 ref로)
  const [renamingPoseId, setRenamingPoseId] = useState<string | null>(null);
  const [poseRenameValue, setPoseRenameValue] = useState('');
  const poseRenameInputRef = useRef<HTMLInputElement | null>(null);
  const poseRenameCancelledRef = useRef(false);
  useEffect(() => {
    if (!renamingPoseId) return;
    poseRenameInputRef.current?.focus();
    poseRenameInputRef.current?.select();
  }, [renamingPoseId]);

  const poseNameLabel = t('propertiesPanel.spritePose') || '상태';
  const resolvedNames = resolvePoseNames(displayPoses, poseNameLabel);

  // 새 상태 기본 이름 - 점유된 '상태 N' 중 비어 있는 가장 작은 번호
  const nextDefaultPoseName = (poses: SpritePose[]): string =>
    resolvePoseNames(
      [
        ...poses,
        {
          poseId: 'next',
          triggers: [],
          transform: IDENTITY_SPRITE_TRANSFORM,
          imageOverride: null,
          contactPoint: DEFAULT_SPRITE_CONTACT_POINT,
        },
      ],
      poseNameLabel,
    )[poses.length];

  const startPoseRename = (poseId: string) => {
    const poseIndex = displayPoses.findIndex(
      (entry) => entry.poseId === poseId,
    );
    if (poseIndex < 0) return;
    poseRenameCancelledRef.current = false;
    // 패널 헤더처럼 표시 중인 이름으로 시작해 전체 선택한다
    setPoseRenameValue(
      displayPoses[poseIndex].name || resolvedNames[poseIndex],
    );
    setRenamingPoseId(poseId);
  };

  const commitPoseRename = (poseId: string, raw: string) => {
    setRenamingPoseId(null);
    const poseIndex = displayPoses.findIndex(
      (entry) => entry.poseId === poseId,
    );
    if (poseIndex < 0) return;
    const trimmed = raw.trim();
    // 무명 상태에서 표시 번호를 그대로 확정한 건 변경이 아니다 -
    // 같은 번호로 다음 구조 변경에서 고정되므로 커밋을 만들지 않는다
    if (
      displayPoses[poseIndex].name == null &&
      trimmed === resolvedNames[poseIndex]
    ) {
      return;
    }
    // 빈 값은 자동 이름 재부여 - sticky 규약이라 null로 되돌리지 않고
    // 자기 이름을 뺀 점유 번호 기준으로 빈 번호를 준다
    const nextName =
      trimmed === ''
        ? resolvePoseNames(
            displayPoses.map((pose, index) =>
              index === poseIndex ? { ...pose, name: null } : pose,
            ),
            poseNameLabel,
          )[poseIndex]
        : trimmed;
    if ((displayPoses[poseIndex].name ?? null) === nextName) return;
    replacePose(poseIndex, { name: nextName });
  };

  const handlePoseMenuSelect = (actionId: string) => {
    const poseId = poseMenu.renderKey;
    poseMenu.close();
    if (poseId === null) return;
    if (actionId === 'rename') {
      startPoseRename(poseId);
      return;
    }
    if (actionId === 'duplicate') {
      clonePose(poseId);
      return;
    }
    if (actionId === 'delete') {
      const poseIndex = displayPoses.findIndex(
        (entry) => entry.poseId === poseId,
      );
      if (poseIndex < 0) return;
      // 삭제 대상의 편집 팝업이 열려 있으면 함께 닫는다
      if (
        activeEditorTarget?.kind === 'pose' &&
        activeEditorTarget.poseId === poseId
      ) {
        setEditorTarget(null);
      }
      removePose(poseIndex);
    }
  };

  // 이미지 피커와 같은 선택 흐름 (image_load + 디코드 확인).
  // 재진입 플래그만 여기서 관리한다
  const pickImage = async (): Promise<string | null> => {
    if (loadingImageRef.current) return null;
    loadingImageRef.current = true;
    const picked = await pickValidatedImagePath(t);
    loadingImageRef.current = false;
    return picked;
  };

  const handleBaseImageSelect = async () => {
    const requestedGeneration = asyncGenerationRef.current;
    const path = await pickImage();
    if (!path) return;
    // 파일창이 떠 있는 동안 대상 전환·언마운트가 지났으면 폐기
    if (asyncGenerationRef.current !== requestedGeneration) return;
    commitFields({ baseImage: path });
  };

  const handlePoseImageSelect = async (poseId: string) => {
    const requestedGeneration = asyncGenerationRef.current;
    const path = await pickImage();
    if (!path) return;
    if (asyncGenerationRef.current !== requestedGeneration) return;
    // 자세가 사라졌으면 폐기하고, 최신 poses에 다시 결합한다
    const latest = latestPosesRef.current;
    if (!latest.some((pose) => pose.poseId === poseId)) return;
    updatePoses(
      latest.map((pose) =>
        pose.poseId === poseId ? { ...pose, imageOverride: path } : pose,
      ),
    );
  };

  const spriteTitle = position.layerName || 'Sprite';
  const { anchor, transitionMs, pressDurationMs } = SPRITE_CONSTRAINTS;
  const easingValue =
    position.transitionEasing || DEFAULT_SPRITE_TRANSITION_EASING;
  const easingOptions = SPRITE_EASING_PRESETS.some(
    (preset) => preset.value === easingValue,
  )
    ? [...SPRITE_EASING_PRESETS]
    : [
        {
          label: t('propertiesPanel.spriteEasingCustom') || '사용자 정의',
          value: easingValue,
        },
        ...SPRITE_EASING_PRESETS,
      ];

  return (
    <div ref={setPanelElement} className={PANEL_ROOT_CLASS}>
      <div className={PANEL_HEADER_CLASS}>
        <PanelRenameTitle
          title={spriteTitle}
          isRenaming={isRenaming}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          renameInputRef={renameInputRef}
          renameCancelledRef={renameCancelledRef}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={handleRenameCancel}
          onRenameStart={handleRenameStart}
          renameLabel={t('contextMenu.rename') || 'Rename'}
        />
      </div>

      <div className="flex-1 properties-panel-overlay-scroll">
        <div
          ref={singleScrollRefFor(TABS.STYLE)}
          className="properties-panel-overlay-viewport"
        >
          <EditSessionBoundary>
            {/* 기본 이미지 - 미리보기·표시·위치·크기는 설정 팝업이 맡는다 */}
            <PropertySection>
              <PropertyRow
                label={t('propertiesPanel.spriteBaseImage') || '기본 이미지'}
              >
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={imageEditing}
                  aria-label={
                    t('propertiesPanel.spriteBaseImage') || '기본 이미지'
                  }
                  className={`${ACTION_BUTTON_CLASS} ${
                    imageEditing ? 'shadow-focus-ring' : ''
                  }`}
                  onClick={(event) =>
                    openEditorPopup(
                      { kind: 'image', positionId: position.id },
                      event.currentTarget,
                    )
                  }
                >
                  {t('propertiesPanel.configure') || '설정하기'}
                </button>
              </PropertyRow>

              {/* 기준점 - 회전·배율의 축, 이미지 상자 기준 비율(%).
                  만지는 동안 캔버스에 십자 마커가 뜬다 */}
              <PropertyRow label={t('propertiesPanel.spritePivot') || '기준점'}>
                <div
                  ref={pivotRowRef}
                  className="flex items-center gap-[8px]"
                  onFocusCapture={() => setPivotEngaged(true)}
                  onBlurCapture={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      setPivotEngaged(false);
                    }
                  }}
                  onPointerDownCapture={() => setPivotEngaged(true)}
                >
                  <NumberInput
                    value={anchorToPercent(position.pivot.x)}
                    onChange={(value) =>
                      commitFields({
                        pivot: {
                          ...position.pivot,
                          x: percentToAnchor(value),
                        },
                      })
                    }
                    onPreview={(value) =>
                      previewFields({
                        pivot: {
                          ...position.pivot,
                          x: percentToAnchor(value),
                        },
                      })
                    }
                    onCancel={() => editGestureController.cancel()}
                    prefix="X"
                    suffix="%"
                    ariaLabel={`${
                      t('propertiesPanel.spritePivot') || '기준점'
                    } X`}
                    width={AXIS_FIELD_WIDTH}
                    min={anchor.min * 100}
                    max={anchor.max * 100}
                    allowDecimal
                    decimalScale={1}
                  />
                  <NumberInput
                    value={anchorToPercent(position.pivot.y)}
                    onChange={(value) =>
                      commitFields({
                        pivot: {
                          ...position.pivot,
                          y: percentToAnchor(value),
                        },
                      })
                    }
                    onPreview={(value) =>
                      previewFields({
                        pivot: {
                          ...position.pivot,
                          y: percentToAnchor(value),
                        },
                      })
                    }
                    onCancel={() => editGestureController.cancel()}
                    prefix="Y"
                    suffix="%"
                    ariaLabel={`${
                      t('propertiesPanel.spritePivot') || '기준점'
                    } Y`}
                    width={AXIS_FIELD_WIDTH}
                    min={anchor.min * 100}
                    max={anchor.max * 100}
                    allowDecimal
                    decimalScale={1}
                  />
                </div>
              </PropertyRow>
            </PropertySection>

            {/* 상태 목록 - 피커 행 문법(이름 + 호버 ⋮ 메뉴), 편집은 팝업으로.
                이름 없는 상태는 '상태 N'으로 표시하고, 미지정·중복은 이름 톤으로 알린다 */}
            <div
              ref={poseListRef}
              // 분리 창 피커가 폭·좌우 정렬을 맞추는 섹션 앵커 - 자세 행이 팝업 트리거라
              // 표식이 없으면 카드 고정 폭으로 떨어져 이미지 설정 팝업과 폭이 갈린다
              data-dmn-section="true"
              className="bg-fill-faint rounded-surface p-[4px] flex flex-col gap-[4px]"
            >
              {displayPoses.map((pose, poseIndex) => {
                const isDuplicate = duplicatePose?.poseId === pose.poseId;
                const isEmpty = pose.triggers.length === 0;
                const isEditing =
                  activeEditorTarget?.kind === 'pose' &&
                  activeEditorTarget.poseId === pose.poseId;
                const displayName = pose.name || resolvedNames[poseIndex];
                const isRenamingPose = renamingPoseId === pose.poseId;
                const openPose = (anchor: HTMLElement) =>
                  openEditorPopup(
                    {
                      kind: 'pose',
                      positionId: position.id,
                      poseId: pose.poseId,
                    },
                    anchor,
                  );
                return (
                  <div
                    key={pose.poseId}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      if (isRenamingPose) return;
                      openPose(event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      // 이름 변경 중에는 클릭과 동일하게 열기 차단
                      if (isRenamingPose) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openPose(event.currentTarget);
                      }
                    }}
                    onContextMenu={(event) => {
                      // 목록 영역은 바깥닫힘 예외라 메뉴를 열 때 직접 닫는다
                      setEditorTarget(null);
                      poseMenu.openFromContextMenu(event, pose.poseId);
                    }}
                    className={`${pickerRowClass} ${
                      isEditing || isRenamingPose
                        ? 'bg-fill-hover text-fg cursor-pointer'
                        : 'text-fg hover:bg-fill cursor-pointer'
                    }`}
                    title={displayName}
                  >
                    {isRenamingPose ? (
                      <input
                        ref={poseRenameInputRef}
                        type="text"
                        className="min-w-0 flex-1 bg-transparent border-none p-0 outline-none text-label text-fg caret-accent"
                        value={poseRenameValue}
                        onChange={(event) =>
                          setPoseRenameValue(event.target.value)
                        }
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => {
                          if (!poseRenameCancelledRef.current) {
                            commitPoseRename(pose.poseId, poseRenameValue);
                          }
                          poseRenameCancelledRef.current = false;
                        }}
                        onKeyDown={(event) => {
                          // 피커 행 규약 - 행·전역 단축키로 전파하지 않는다
                          event.stopPropagation();
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            (event.target as HTMLInputElement).blur();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            poseRenameCancelledRef.current = true;
                            setRenamingPoseId(null);
                          }
                        }}
                        spellCheck={false}
                      />
                    ) : (
                      <span
                        className={`min-w-0 flex-1 truncate text-left ${
                          isDuplicate
                            ? 'text-danger-fg'
                            : isEmpty
                            ? 'text-fg-faint'
                            : ''
                        }`}
                      >
                        {displayName}
                      </span>
                    )}
                    <button
                      type="button"
                      className={`${pickerMoreButtonClass} ${
                        isEditing || poseMenu.menuKey === pose.poseId
                          ? pickerMoreButtonVisibleClass
                          : pickerMoreButtonHiddenClass
                      } ${
                        isEditing
                          ? 'text-fg hover:text-fg'
                          : 'text-fg-muted hover:text-fg'
                      }`}
                      title={t('common.more') || '더보기'}
                      aria-label={t('common.more') || '더보기'}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        poseMenu.capturePressState(pose.poseId);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        // 목록 영역은 바깥닫힘 예외라 메뉴를 열 때 직접 닫는다
                        setEditorTarget(null);
                        poseMenu.openFromButton(event, pose.poseId);
                      }}
                    >
                      <MoreVerticalIcon />
                    </button>
                  </div>
                );
              })}
              {displayPoses.length < SPRITE_CONSTRAINTS.maxPoses ? (
                <ListAddRow
                  label={t('propertiesPanel.spriteAddPose') || '상태 추가'}
                  onClick={(event) => addPose(event.currentTarget)}
                />
              ) : null}
            </div>

            {/* 전환·반응 */}
            <PropertySection>
              <PropertyRow
                label={t('propertiesPanel.spriteActivation') || '반응 방식'}
              >
                <Dropdown
                  options={[
                    {
                      label:
                        t('propertiesPanel.spriteActivationHold') ||
                        '누름 유지',
                      value: 'whileHeld',
                    },
                    {
                      label:
                        t('propertiesPanel.spriteActivationPress') ||
                        '단발 재생',
                      value: 'onPress',
                    },
                  ]}
                  value={position.activation}
                  onChange={(value) =>
                    commitFields({ activation: value as SpriteActivation })
                  }
                  align="right"
                />
              </PropertyRow>
              {position.activation === 'onPress' ? (
                <PropertyRow
                  label={
                    t('propertiesPanel.spritePressDuration') || '재생 시간'
                  }
                >
                  <NumberInput
                    value={position.pressDurationMs}
                    onChange={(value) =>
                      commitFields({
                        // Rust u32 계약 - 스크럽 소수값을 정수로 고정
                        pressDurationMs: Math.round(
                          clamp(
                            value,
                            pressDurationMs.min,
                            pressDurationMs.max,
                          ),
                        ),
                      })
                    }
                    onPreview={(value) =>
                      previewFields({
                        pressDurationMs: Math.round(
                          clamp(
                            value,
                            pressDurationMs.min,
                            pressDurationMs.max,
                          ),
                        ),
                      })
                    }
                    onCancel={() => editGestureController.cancel()}
                    suffix="ms"
                    min={pressDurationMs.min}
                    max={pressDurationMs.max}
                  />
                </PropertyRow>
              ) : (
                <PropertyRow
                  label={t('propertiesPanel.spriteTransition') || '전환 시간'}
                >
                  <NumberInput
                    value={position.transitionMs}
                    onChange={(value) =>
                      commitFields({
                        // Rust u32 계약 - 스크럽 소수값을 정수로 고정
                        transitionMs: Math.round(
                          clamp(value, transitionMs.min, transitionMs.max),
                        ),
                      })
                    }
                    onPreview={(value) =>
                      previewFields({
                        transitionMs: Math.round(
                          clamp(value, transitionMs.min, transitionMs.max),
                        ),
                      })
                    }
                    onCancel={() => editGestureController.cancel()}
                    suffix="ms"
                    min={transitionMs.min}
                    max={transitionMs.max}
                  />
                </PropertyRow>
              )}

              <PropertyRow
                label={t('propertiesPanel.spriteEasing') || '가속 곡선'}
              >
                <Dropdown
                  options={easingOptions}
                  value={easingValue}
                  onChange={(value) =>
                    commitFields({ transitionEasing: value })
                  }
                  align="right"
                />
              </PropertyRow>
            </PropertySection>
          </EditSessionBoundary>
        </div>
      </div>

      {/* 편집 팝업 - 이미지 설정·상태 편집이 한 자리를 배타로 쓴다 */}
      <PopupExit open={imageEditing || editingPose !== null}>
        {imageEditing ? (
          <SpriteImageSettingsPopup
            // 리사이즈 착지 세대 - 리마운트가 진행 중 스크럽 세션을 취소로 닫아
            // 이전 배율 절대값 커밋을 차단한다 (useScrubDrag 언마운트 취소 계약)
            key={`resize-${resizeGestureCancel?.tick ?? 0}`}
            open
            position={position}
            referenceRef={poseAnchorRef}
            panelElement={panelElement}
            onCommit={commitFields}
            onPreview={previewFields}
            onCancel={() => editGestureController.cancel()}
            onImagePick={() => void handleBaseImageSelect()}
            onImageReset={() => commitFields({ baseImage: null })}
            onClose={() => setEditorTarget(null)}
            t={t}
          />
        ) : editingPose ? (
          <SpritePoseEditorPopup
            // 리사이즈 착지 세대 - 위 이미지 팝업과 같은 스크럽 차단 계약
            key={`resize-${resizeGestureCancel?.tick ?? 0}`}
            open
            ariaLabel={editingPose.name || resolvedNames[editingPoseIndex]}
            // 셸은 행 전환 동안 유지되고 편집 subtree·앵커만 poseId로 갈린다
            poseId={editingPose.poseId}
            transform={editingPose.transform}
            referenceRef={poseAnchorRef}
            panelElement={panelElement}
            interactiveRefs={[poseListRef]}
            poseControls={{
              keyOptions,
              triggers: editingPose.triggers,
              isDuplicate: duplicatePose?.poseId === editingPose.poseId,
              imageOverride: editingPose.imageOverride,
              imageFit: position.imageFit,
              onToggleTrigger: (keyId) =>
                togglePoseTrigger(editingPoseIndex, keyId),
              onImagePick: () => void handlePoseImageSelect(editingPose.poseId),
              onImageReset: () =>
                replacePose(editingPoseIndex, { imageOverride: null }),
            }}
            // 콜백 부재는 접두 스크럽 자체를 꺼 버린다 - 항상 넘기고 안에서 분기
            onTransformCommit={handleTransformCommit}
            onTransformPreview={handleTransformPreview}
            onTransformCancel={handleTransformCancel}
            pinControls={{
              contactPoint: editingPose.contactPoint,
              pinLock: pinLockEnabled,
              stretch: stretchEnabled,
              onContactPointCommit: (point) =>
                replacePose(editingPoseIndex, { contactPoint: point }),
              onContactPointPreview: (point) =>
                previewPosePatch({ contactPoint: point }),
              onPinLockToggle: () => setPinLockEnabled((value) => !value),
              onStretchToggle: () => setStretchEnabled((value) => !value),
            }}
            onClose={() => setEditorTarget(null)}
            t={t}
          />
        ) : null}
      </PopupExit>

      {/* 행 ⋮ 메뉴 - 퇴장 모션 동안 renderKey가 유지된다 */}
      {poseMenu.renderKey !== null && (
        <ListPopup
          open={poseMenu.menuKey !== null}
          ariaLabel={t('common.more') || '더보기'}
          position={poseMenu.renderPosition ?? undefined}
          onClose={poseMenu.close}
          items={poseMenuItems}
          onSelect={handlePoseMenuSelect}
          offsetX={0}
          offsetY={0}
        />
      )}
    </div>
  );
};
