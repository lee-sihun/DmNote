import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import { commitSingleElementBoundsById } from '@src/renderer/editor/runtime/elementOps';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { spriteItemsApi } from '@api/modules/itemsApi';
import { clamp } from '@utils/core/clamp';
import { stableStringify } from '@utils/core/stableStringify';
import { toRenderableImageRef } from '@utils/core/imageSource';
import { pickValidatedImage } from '@utils/core/pickValidatedImage';
import {
  anchorToPercent,
  isSameSpriteAnchor,
  percentToAnchor,
} from '@utils/sprite/spriteGeometry';
import {
  fitSpriteBoundsToNaturalSize,
  placeSpriteVisual,
  spritePivotChangePatch,
  spritePosePivotChangePatch,
  spritePoseVisual,
} from '@utils/sprite/spritePlacement';
import { isHTMLElementNode } from '@utils/dom/isElementNode';
import {
  projectSpriteResize,
  spriteResizePatch,
} from '@utils/sprite/resizeProjection';
import {
  copyPoseName,
  materializePoseNames,
  resolvePoseNames,
} from '@utils/sprite/spritePoseNames';
import { rebaseSpritePoseIntent } from '@utils/sprite/spritePoseIntent';
import { toSpriteWireShape } from '@utils/sprite/spriteWireShape';
import { slotDisplayName } from '@utils/keySlot';
import { AXIS_FIELD_WIDTH } from '@utils/cardRecipes';
import { useSpriteEditPreviewStore } from '@stores/grid/useSpriteEditPreviewStore';
import { useSpritePoseHandleStore } from '@stores/grid/useSpritePoseHandleStore';
import {
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
import type { EditorBoundsV1 } from '@src/types/editor';
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
import SpriteImagePreviewCard from './SpriteImagePreviewCard';
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

// 요소 상자 입력의 편집 한계 - 다른 요소의 위치·크기 행과 같은 범위
const BOUNDS_EDIT_LIMITS = {
  coordMin: -9999,
  coordMax: 9999,
  dimensionMin: 10,
  dimensionMax: 9999,
} as const;

// 편집 팝업 대상 - 소유 스프라이트에 결합한다
// (대상 초기화 effect 전 한 렌더 동안 다음 스프라이트 재사용 방지)
interface SpriteEditorTarget {
  positionId: string;
  poseId: string;
}

const isSameEditorTarget = (
  current: SpriteEditorTarget | null,
  next: SpriteEditorTarget,
): boolean =>
  current !== null &&
  current.positionId === next.positionId &&
  current.poseId === next.poseId;

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

  // 무효 자세(빈/중복 트리거)는 백엔드가 거부하므로 커밋 착지 전까지 패널이 값을 들고 있는다
  const [posesDraft, setPosesDraft] = useState<{
    id: string;
    poses: SpritePose[];
  } | null>(null);
  const [pendingPoseWrites, setPendingPoseWrites] = useState<
    ReadonlySet<symbol>
  >(new Set());

  // 대상이 갈리면 팝업을 닫고 draft를 버린다 - effect의 동기 setState는
  // 캐스케이드 렌더라 렌더 중 보정 패턴을 쓴다
  const panelTargetKey = `${selectedKeyType}\n${position.id}`;
  const [lastPanelTargetKey, setLastPanelTargetKey] = useState(panelTargetKey);
  if (panelTargetKey !== lastPanelTargetKey) {
    setLastPanelTargetKey(panelTargetKey);
    setEditorTarget(null);
    setPosesDraft(null);
    setPendingPoseWrites(new Set());
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
  // 덮어도 착지 감지가 빗나가지 않는다. undo 복원은 왕복 오차로 불일치할 수 있어
  // 건드리지 않는다
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
        // 자세 팝업이 열린 채 착지하면 세대를 올린다 - 팝업 리마운트가 진행 중
        // 스크럽 세션을 취소로 닫고, 아래 effect가 preview 게스처를 정산해
        // 이전 배율의 절대값 커밋을 차단한다
        if (editorTarget && editorTarget.positionId === canonicalPosition.id) {
          setResizeGestureCancel((prev) => ({
            tick: (prev?.tick ?? 0) + 1,
            positionId: canonicalPosition.id,
          }));
        }
      }
    }
    // 기준점 착지 rebase - 연결된 상태는 새 기본 축을 따르고 독립 상태만 화면 위치를
    // 보존한다. canonical이 같은 patch의 결과일 때 무효 draft에도 같은 규칙을 적용한다
    if (
      !draftRebased &&
      posesDraft &&
      posesDraft.id === canonicalPosition.id &&
      lastPositionSnapshot.id === canonicalPosition.id &&
      !isSameSpriteAnchor(lastPositionSnapshot.pivot, canonicalPosition.pivot)
    ) {
      const projected = spritePivotChangePatch(
        lastPositionSnapshot,
        canonicalPosition.pivot,
      );
      const pivotLanded =
        projected !== null &&
        stableStringify(projected.idleTransform) ===
          stableStringify(canonicalPosition.idleTransform) &&
        stableStringify(projected.poses) ===
          stableStringify(canonicalPosition.poses);
      if (pivotLanded) {
        const rebased = spritePivotChangePatch(
          { ...lastPositionSnapshot, poses: posesDraft.poses },
          canonicalPosition.pivot,
        );
        if (rebased) {
          setPosesDraft({ id: posesDraft.id, poses: rebased.poses });
          draftRebased = true;
        }
      }
    }
    // 앞선 자세 저장의 중간 착지는 아직 대기 중인 최신 의도를 다시 얹는다
    // 대기 중인 자세 저장이 없으면 undo·redo·다른 창 편집으로 보고 초안을 버린다
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
      if (pendingPoseWrites.size > 0) {
        setPosesDraft({
          id: posesDraft.id,
          poses: rebaseSpritePoseIntent(
            lastPositionSnapshot.poses,
            posesDraft.poses,
            canonicalPosition.poses,
          ),
        });
      } else {
        setPosesDraft(null);
      }
    }
  }

  // 게스처 취소는 렌더 밖에서 - cancel은 활성 게스처가 없으면 no-op이라
  // 정산이 이미 끝난 일반 경로에는 영향이 없다 (계약의 세션 정산 폴백).
  // 캔버스 핸들은 세대 무효화로 진행 중 드래그의 pointerup 커밋을 떨군다
  useLayoutEffect(() => {
    if (!resizeGestureCancel) return;
    editGestureController.cancel();
    useSpritePoseHandleStore
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
  const editingPoseIndex = activeEditorTarget
    ? displayPoses.findIndex(
        (pose) => pose.poseId === activeEditorTarget.poseId,
      )
    : -1;
  const editingPose =
    editingPoseIndex >= 0 ? displayPoses[editingPoseIndex] : null;
  const canonicalEditingPose = activeEditorTarget
    ? canonicalPosition.poses.find(
        (pose) => pose.poseId === activeEditorTarget.poseId,
      ) ?? editingPose
    : null;

  // 편집 중인 자세를 캔버스 보조 표시로 발행한다 (편집창 전용, draft도 스냅샷으로)
  useLayoutEffect(() => {
    const store = useSpriteEditPreviewStore.getState();
    if (activeEditorTarget && editingPose) {
      store.publish({
        kind: 'pose',
        positionId: activeEditorTarget.positionId,
        poseId: editingPose.poseId,
        fallbackPose: editingPose,
        // 무효 draft는 canonical에 착지하지 못하므로 캔버스가 스냅샷을 우선한다
        preferFallback:
          !posesCommittable ||
          (posesDraft !== null && posesDraft.id === position.id),
      });
    } else {
      store.clear();
    }
  }, [
    activeEditorTarget,
    editingPose,
    posesCommittable,
    posesDraft,
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
  const latestPositionRef = useRef(position);
  useEffect(() => {
    latestPosesRef.current = displayPoses;
    latestPositionRef.current = position;
  });

  // id 기반 필드 패치 커밋: 직렬 슬롯 안 최신 base로 patch를 생성해
  // 낙관 로컬 적용이 즉시 canonical에 반영된다.
  // 활성 preview 게스처가 있으면 gestureId를 실어 정산한다
  const commitFields = (
    patch: Partial<ReactiveSpritePosition>,
    generatePatch?: (
      current: ReactiveSpritePosition,
    ) => Partial<ReactiveSpritePosition> | null,
  ) => {
    const gestureId = editGestureController.activeGestureId() ?? undefined;
    const persisted = spriteItemsApi.patchPosition(
      selectedKeyType,
      position.id,
      patch,
      gestureId,
      generatePatch,
    );
    editGestureController.settleCommit(persisted);
    void persisted
      .then((result) => {
        // 무커밋 조용 종료 방지: 대상 소실은 흔적을 남긴다
        if (result === 'targetMissing') {
          console.error('Sprite patch target missing', position.id);
        }
        // 최신 base에서 patch를 다시 만들 수 없어 저장 없이 끝난 경우 - 화면은 canonical로
        // 되돌아가므로 흔적을 남긴다
        if (result === 'skipped') {
          console.warn(
            'Sprite patch skipped against the latest base',
            position.id,
          );
        }
      })
      .catch((error) => {
        console.error('Failed to update sprite', error);
      });
    return persisted;
  };

  const trackPoseWrite = (persisted: Promise<unknown>) => {
    const token = Symbol();
    setPendingPoseWrites((current) => new Set(current).add(token));
    const release = () => {
      setPendingPoseWrites((current) => {
        if (!current.has(token)) return current;
        const next = new Set(current);
        next.delete(token);
        return next;
      });
    };
    void persisted.then(
      () => release(),
      () => release(),
    );
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

  // 요소 상자(위치·크기)는 resizeSprite op - 크기가 바뀌면 자세 이동값이 비례한다.
  // 미리보기도 커밋과 같은 projection을 canonical 기준으로 써야 놓는 순간 튀지 않는다
  const commitBounds = (bounds: EditorBoundsV1) => {
    const gestureId = editGestureController.activeGestureId() ?? undefined;
    const persisted = commitSingleElementBoundsById(
      'sprite',
      position.id,
      bounds,
      gestureId,
    );
    editGestureController.settleCommit(persisted);
    void persisted.catch((error) => {
      console.error('Failed to resize sprite', error);
    });
  };
  const previewBounds = (bounds: EditorBoundsV1) => {
    if (
      bounds.width === canonicalPosition.width &&
      bounds.height === canonicalPosition.height
    ) {
      previewFields({ dx: bounds.dx, dy: bounds.dy });
      return;
    }
    previewFields(spriteResizePatch(canonicalPosition, bounds));
  };
  const boundsWith = (patch: Partial<EditorBoundsV1>): EditorBoundsV1 => ({
    dx: canonicalPosition.dx,
    dy: canonicalPosition.dy,
    width: canonicalPosition.width,
    height: canonicalPosition.height,
    ...patch,
  });
  // 크기는 비율 고정 - 그림 레이어라 늘리지 않는다. 한쪽을 치면 다른 쪽이 따라간다
  // 파생 축도 상한 안에 든다 - 넘치면 파생 축을 상한에 놓고 입력 축을 역산한다
  // (극단 비율에서는 입력 축이 하한 아래로 내려간다, 백엔드는 양수면 받는다)
  const aspectBounds = (
    field: 'width' | 'height',
    raw: number,
  ): EditorBoundsV1 => {
    const { dimensionMin, dimensionMax } = BOUNDS_EDIT_LIMITS;
    const ratio = canonicalPosition.height / canonicalPosition.width;
    let value = clamp(raw, dimensionMin, dimensionMax);
    let derived = field === 'width' ? value * ratio : value / ratio;
    if (derived > dimensionMax) {
      derived = dimensionMax;
      value = field === 'width' ? derived / ratio : derived * ratio;
    }
    return boundsWith(
      field === 'width'
        ? { width: value, height: derived }
        : { height: value, width: derived },
    );
  };

  // 기준점 변경 - 기본 이미지는 제자리에 두고 연결된 상태는 새 축을 따라간다.
  // 독립 상태의 화면 위치 보정이 범위를 넘으면 변경을 받지 않는다
  // 축 하나만 바꾸는 편집은 저장 시점의 최신 기준점 위에 병합한다 - 앞선 축 편집이
  // 아직 큐에 있어도 덮이지 않는다
  const commitPivot = (patch: Partial<SpriteAnchor>) => {
    const draft = spritePivotChangePatch(canonicalPosition, {
      ...canonicalPosition.pivot,
      ...patch,
    });
    if (!draft) return;
    commitFields(draft, (current) =>
      spritePivotChangePatch(current, { ...current.pivot, ...patch }),
    );
  };
  const previewPivot = (next: SpriteAnchor) => {
    const patch = spritePivotChangePatch(canonicalPosition, next);
    if (!patch) return;
    previewFields(patch);
  };

  // extra는 poses와 한 커밋으로 실어야 하는 스프라이트 필드(기준 크기 초기화 등)
  const updatePoses = (
    rawPoses: SpritePose[],
    extra: Partial<ReactiveSpritePosition> = {},
    generateExtra?: (
      current: ReactiveSpritePosition,
    ) => Partial<ReactiveSpritePosition> | null,
  ) => {
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
    const basePoses = canonicalPosition.poses;
    trackPoseWrite(
      commitFields({ ...extra, poses: nextPoses }, (current) => {
        const latestExtra = generateExtra ? generateExtra(current) : extra;
        if (latestExtra === null) return null;
        return {
          ...latestExtra,
          poses: rebaseSpritePoseIntent(basePoses, nextPoses, current.poses),
        };
      }),
    );
  };

  const replacePose = (
    poseIndex: number,
    patch: Partial<SpritePose>,
    generatePatch?: (
      current: ReactiveSpritePosition,
      pose: SpritePose,
    ) => Partial<SpritePose> | null,
  ) => {
    const targetPoseId = displayPoses[poseIndex]?.poseId;
    if (!targetPoseId) return;
    const basePoses =
      posesDraft?.id === position.id ? posesDraft.poses : displayPoses;
    const nextPoses = toSpriteWireShape({
      ...position,
      poses: basePoses.map((pose) =>
        pose.poseId === targetPoseId ? { ...pose, ...patch } : pose,
      ),
    }).poses;
    setPosesDraft({ id: position.id, poses: nextPoses });
    const blocked =
      nextPoses.some((pose) => pose.triggers.length === 0) ||
      findDuplicateTriggerPose(nextPoses) !== null;
    if (blocked) {
      editGestureController.cancel();
      return;
    }
    // position은 활성 프리뷰가 합성된 값일 수 있어 의도 비교 기준으로 쓰지 않는다
    const basePosesAtIntent = canonicalPosition.poses;
    trackPoseWrite(
      commitFields({ poses: nextPoses }, (current) => {
        const rebasedPoses = rebaseSpritePoseIntent(
          basePosesAtIntent,
          nextPoses,
          current.poses,
        );
        if (!generatePatch) return { poses: rebasedPoses };
        const currentPose = current.poses.find(
          (pose) => pose.poseId === targetPoseId,
        );
        if (!currentPose) return null;
        const latestPatch = generatePatch(current, currentPose);
        if (!latestPatch) return null;
        return {
          poses: rebasedPoses.map((pose) =>
            pose.poseId === targetPoseId ? { ...pose, ...latestPatch } : pose,
          ),
        };
      }),
    );
  };

  // 자세 필드 실시간 프리뷰 - 선택한 자세 하나만 캔버스 스냅샷으로 갱신
  // 패널은 같은 렌더 트리의 분리 문서라 전체 poses를 프리뷰 IPC로 보낼 필요가 없다
  const previewPosePatch = (patch: Partial<SpritePose>) => {
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
    previewPosePatch({ transform: next });

  // 팝업 수치 편집은 축 하나씩 온다. 바탕 자세는 저장 대기 중 draft가 있으면 그 자세
  // (직전 캔버스 이동 포함), 없으면 store의 canonical 자세다. 표시 prop은 낡거나 프리뷰가
  // 섞일 수 있어 바탕으로 쓰지 않는다. 저장 시점에는 그때의 최신 자세 위에 다시 병합한다
  const editBasePose = (): SpritePose | null =>
    posesDraft?.id === position.id
      ? editingPose
      : canonicalEditingPose ?? editingPose;

  const handleTransformCommit = (patch: Partial<SpriteTransform>) => {
    const base = editBasePose();
    if (!base) return;
    replacePose(
      editingPoseIndex,
      { transform: { ...base.transform, ...patch } },
      (_current, pose) => ({ transform: { ...pose.transform, ...patch } }),
    );
  };

  const posePivotPatch = (next: SpriteAnchor | null) => {
    const base = editBasePose();
    return base
      ? spritePosePivotChangePatch(canonicalPosition, base, next)
      : null;
  };

  const handlePosePivotPreview = (next: SpriteAnchor) => {
    const patch = posePivotPatch(next);
    if (patch) previewPosePatch(patch);
  };

  const handlePosePivotCommit = (patch: Partial<SpriteAnchor>) => {
    const base = editBasePose();
    if (!base) return;
    const draftPatch = posePivotPatch({
      ...(base.pivot ?? canonicalPosition.pivot),
      ...patch,
    });
    if (!draftPatch) return;
    replacePose(editingPoseIndex, draftPatch, (current, pose) =>
      spritePosePivotChangePatch(current, pose, {
        ...(pose.pivot ?? current.pivot),
        ...patch,
      }),
    );
  };

  const handlePosePivotLinkChange = () => {
    if (!editingPose) return;
    const patch = posePivotPatch(
      editingPose.pivot == null ? { ...position.pivot } : null,
    );
    if (patch) {
      const nextPivot = editingPose.pivot == null ? 'unlink' : 'link';
      replacePose(editingPoseIndex, patch, (current, pose) =>
        spritePosePivotChangePatch(
          current,
          pose,
          nextPivot === 'unlink' ? { ...current.pivot } : null,
        ),
      );
    }
  };

  const handleTransformCancel = () => {
    editGestureController.cancel();
    // 로컬 스냅샷은 gesture 취소 대상이 아니므로 마지막 확정 자세로 직접 복원
    if (editingPose) {
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: position.id,
        poseId: editingPose.poseId,
        fallbackPose: editingPose,
        preferFallback: true,
      });
    }
  };

  // 캔버스 핸들 콜백은 ref 경유 - 세션 재발행 없이 항상 최신 렌더의 배선을 쓴다
  const handleCallbacksRef = useRef<{
    preview: (next: SpriteTransform) => void;
    commit: (next: SpriteTransform) => void;
    previewPivot: (pivot: SpriteAnchor, transform: SpriteTransform) => void;
    commitPivot: (pivot: SpriteAnchor, transform: SpriteTransform) => void;
    cancel: () => void;
  } | null>(null);
  // layout 단계 갱신 - 같은 커밋의 passive effect(핸들의 undo 취소)가 이전 렌더의
  // 클로저를 불러 낡은 draft를 preview로 되살리지 않게 한다
  useLayoutEffect(() => {
    handleCallbacksRef.current = {
      preview: (next) => previewPosePatch({ transform: next }),
      commit: (next) => replacePose(editingPoseIndex, { transform: next }),
      previewPivot: (pivot, transform) =>
        previewPosePatch({ pivot, transform }),
      commitPivot: (pivot, transform) =>
        replacePose(editingPoseIndex, { pivot, transform }, (current, pose) =>
          spritePosePivotChangePatch(current, pose, pivot),
        ),
      cancel: handleTransformCancel,
    };
  });

  // 자세 팝업이 열려 있는 동안 캔버스 자세 핸들 세션 발행
  useLayoutEffect(() => {
    const store = useSpritePoseHandleStore.getState();
    if (activeEditorTarget && editingPose) {
      store.setSession({
        positionId: position.id,
        poseId: editingPose.poseId,
        origin: { dx: position.dx, dy: position.dy },
        width: position.width,
        height: position.height,
        pivot: position.pivot,
        imagePivot: editingPose.pivot ?? position.pivot,
        followsBasePivot: editingPose.pivot == null,
        placement: placeSpriteVisual(
          position,
          spritePoseVisual(position, editingPose),
        ),
        transform: editingPose.transform,
        preview: (next) => handleCallbacksRef.current?.preview(next),
        commit: (next) => handleCallbacksRef.current?.commit(next),
        previewPivot: (pivot, transform) =>
          handleCallbacksRef.current?.previewPivot(pivot, transform),
        commitPivot: (pivot, transform) =>
          handleCallbacksRef.current?.commitPivot(pivot, transform),
        cancel: () => handleCallbacksRef.current?.cancel(),
      });
    } else {
      store.setSession(null);
    }
    // 배치 기하가 위치의 여러 필드(상자·기준점·기준 크기·기본 이미지)에서
    // 파생되므로 위치 전체를 의존성으로 둔다
  }, [activeEditorTarget, editingPose, position]);
  // 언마운트 뒤에도 핸들은 드래그 시작 시점 세션을 붙들고 취소를 부른다. 마지막
  // 렌더의 배선이 남아 있으면 무효 draft를 fallback preview로 다시 발행해 버린 자세가
  // 캔버스에 남으므로, 게스처만 닫는 배선으로 바꾼 뒤 세션을 내린다
  useLayoutEffect(
    () => () => {
      handleCallbacksRef.current = {
        preview: () => {},
        commit: () => {},
        previewPivot: () => {},
        commitPivot: () => {},
        cancel: () => editGestureController.cancel(),
      };
      useSpritePoseHandleStore.getState().setSession(null);
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
      pivot: null,
      imageOverride: null,
      // 원본 크기는 상태 이미지를 고를 때 그 이미지 기준으로 채운다
      imageOverrideMetrics: null,
    };
    updatePoses([...materialized, pose]);
    // 새 상태는 담당 키 선택이 다음 단계라 편집 팝업을 바로 연다.
    // 추가 행은 마지막 상태에서 같은 렌더에 사라지므로 웰 컨테이너를 앵커로 쓴다
    openEditorPopup(
      { positionId: position.id, poseId: pose.poseId },
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
    openEditorPopup({ positionId: position.id, poseId: pose.poseId }, anchor);
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
          imageOverrideMetrics: null,
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
      if (activeEditorTarget?.poseId === poseId) {
        setEditorTarget(null);
      }
      removePose(poseIndex);
    }
  };

  // 이미지 피커와 같은 선택 흐름 (image_load + 디코드 확인).
  // 재진입 플래그만 여기서 관리한다
  const pickImage = async () => {
    if (loadingImageRef.current) return null;
    loadingImageRef.current = true;
    const picked = await pickValidatedImage(t);
    loadingImageRef.current = false;
    return picked;
  };

  // 기본 이미지는 픽셀 배율의 기준이라 크기를 경로와 한 커밋으로 묶고, 요소 상자를
  // 그 이미지 비율로 맞춘다 (기준점은 제자리). 상자가 곧 비트맵이라 여백이 없다
  const handleBaseImageSelect = async () => {
    const requestedGeneration = asyncGenerationRef.current;
    const picked = await pickImage();
    if (!picked) return;
    // 파일창이 떠 있는 동안 대상 전환·언마운트가 지났으면 폐기
    if (asyncGenerationRef.current !== requestedGeneration) return;
    const latest = latestPositionRef.current;
    const patch = {
      baseImage: picked.path,
      referenceNaturalSize: {
        source: picked.path,
        width: picked.width,
        height: picked.height,
      },
      ...fitSpriteBoundsToNaturalSize(latest, latest.pivot, picked),
    };
    commitFields(patch, (current) => ({
      baseImage: picked.path,
      referenceNaturalSize: {
        source: picked.path,
        width: picked.width,
        height: picked.height,
      },
      ...fitSpriteBoundsToNaturalSize(current, current.pivot, picked),
    }));
  };

  // 기본 이미지를 지워도 기준 크기는 남긴다 - 자세 이미지만 남은 뒤 배율이 흔들리지 않게
  const handleBaseImageReset = () =>
    commitFields({
      baseImage: null,
      referenceNaturalSize: position.referenceNaturalSize
        ? { ...position.referenceNaturalSize, source: null }
        : null,
    });

  const handlePoseImageSelect = async (poseId: string) => {
    const requestedGeneration = asyncGenerationRef.current;
    const picked = await pickImage();
    if (!picked) return;
    if (asyncGenerationRef.current !== requestedGeneration) return;
    // 자세가 사라졌으면 폐기하고, 최신 poses에 다시 결합한다
    const latest = latestPosesRef.current;
    if (!latest.some((pose) => pose.poseId === poseId)) return;
    // 기본 이미지도 기준 크기도 없으면 첫 자세 이미지가 기준이 된다 (source 없음)
    const referenceInit: Partial<ReactiveSpritePosition> =
      toRenderableImageRef(position.baseImage) === null &&
      !position.referenceNaturalSize
        ? {
            referenceNaturalSize: {
              source: null,
              width: picked.width,
              height: picked.height,
            },
          }
        : {};
    updatePoses(
      latest.map((pose) =>
        pose.poseId === poseId
          ? {
              ...pose,
              imageOverride: picked.path,
              imageOverrideMetrics: {
                source: picked.path,
                width: picked.width,
                height: picked.height,
              },
            }
          : pose,
      ),
      referenceInit,
      (current) => {
        if (!current.poses.some((pose) => pose.poseId === poseId)) return null;
        return toRenderableImageRef(current.baseImage) === null &&
          !current.referenceNaturalSize
          ? referenceInit
          : {};
      },
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
  const pivotLabel = t('propertiesPanel.spritePivot') || '기준점';

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
            {/* 기본 이미지 - 카드 클릭이 곧 선택, 호버 초기화 */}
            <SpriteImagePreviewCard
              source={position.baseImage}
              onPick={() => void handleBaseImageSelect()}
              onReset={handleBaseImageReset}
              t={t}
            />

            {/* 요소 상자와 기준점 - 다른 요소의 위치·크기 행과 같은 문법 */}
            <PropertySection>
              <PropertyRow label={t('propertiesPanel.position') || '위치'}>
                <NumberInput
                  value={position.dx}
                  onChange={(value) => commitBounds(boundsWith({ dx: value }))}
                  onPreview={(value) =>
                    previewBounds(boundsWith({ dx: value }))
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="X"
                  ariaLabel={`${t('propertiesPanel.position') || '위치'} X`}
                  width={AXIS_FIELD_WIDTH}
                  min={BOUNDS_EDIT_LIMITS.coordMin}
                  max={BOUNDS_EDIT_LIMITS.coordMax}
                  allowDecimal
                  decimalScale={1}
                />
                <NumberInput
                  value={position.dy}
                  onChange={(value) => commitBounds(boundsWith({ dy: value }))}
                  onPreview={(value) =>
                    previewBounds(boundsWith({ dy: value }))
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="Y"
                  ariaLabel={`${t('propertiesPanel.position') || '위치'} Y`}
                  width={AXIS_FIELD_WIDTH}
                  min={BOUNDS_EDIT_LIMITS.coordMin}
                  max={BOUNDS_EDIT_LIMITS.coordMax}
                  allowDecimal
                  decimalScale={1}
                />
              </PropertyRow>
              <PropertyRow label={t('propertiesPanel.size') || '크기'}>
                <NumberInput
                  value={position.width}
                  onChange={(value) =>
                    commitBounds(aspectBounds('width', value))
                  }
                  onPreview={(value) =>
                    previewBounds(aspectBounds('width', value))
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="W"
                  ariaLabel={`${t('propertiesPanel.size') || '크기'} W`}
                  width={AXIS_FIELD_WIDTH}
                  min={BOUNDS_EDIT_LIMITS.dimensionMin}
                  max={BOUNDS_EDIT_LIMITS.dimensionMax}
                  allowDecimal
                  decimalScale={1}
                />
                <NumberInput
                  value={position.height}
                  onChange={(value) =>
                    commitBounds(aspectBounds('height', value))
                  }
                  onPreview={(value) =>
                    previewBounds(aspectBounds('height', value))
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="H"
                  ariaLabel={`${t('propertiesPanel.size') || '크기'} H`}
                  width={AXIS_FIELD_WIDTH}
                  min={BOUNDS_EDIT_LIMITS.dimensionMin}
                  max={BOUNDS_EDIT_LIMITS.dimensionMax}
                  allowDecimal
                  decimalScale={1}
                />
              </PropertyRow>

              {/* 기준점 - 회전·배율 축이자 자세 이미지의 고정점. 위치·크기와 같은 한 줄 행.
                  9점 프리셋은 캔버스 표식 드래그의 자석 스냅이 맡는다 */}
              <PropertyRow label={pivotLabel}>
                <NumberInput
                  value={anchorToPercent(position.pivot.x)}
                  onChange={(value) =>
                    commitPivot({ x: percentToAnchor(value) })
                  }
                  onPreview={(value) =>
                    previewPivot({
                      ...canonicalPosition.pivot,
                      x: percentToAnchor(value),
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="X"
                  suffix="%"
                  ariaLabel={`${pivotLabel} X`}
                  width={AXIS_FIELD_WIDTH}
                  min={anchor.min * 100}
                  max={anchor.max * 100}
                  allowDecimal
                  decimalScale={1}
                />
                <NumberInput
                  value={anchorToPercent(position.pivot.y)}
                  onChange={(value) =>
                    commitPivot({ y: percentToAnchor(value) })
                  }
                  onPreview={(value) =>
                    previewPivot({
                      ...canonicalPosition.pivot,
                      y: percentToAnchor(value),
                    })
                  }
                  onCancel={() => editGestureController.cancel()}
                  prefix="Y"
                  suffix="%"
                  ariaLabel={`${pivotLabel} Y`}
                  width={AXIS_FIELD_WIDTH}
                  min={anchor.min * 100}
                  max={anchor.max * 100}
                  allowDecimal
                  decimalScale={1}
                />
              </PropertyRow>
            </PropertySection>

            {/* 상태 목록 - 피커 행 문법(이름 + 호버 ⋮ 메뉴), 편집은 팝업으로.
                이름 없는 상태는 '상태 N'으로 표시하고, 미지정·중복은 이름 톤으로 알린다 */}
            <div
              ref={poseListRef}
              // 분리 창 피커가 폭·좌우 정렬을 맞추는 섹션 앵커 - 자세 행이 팝업 트리거라
              // 표식이 없으면 카드 고정 폭으로 떨어져 폭이 갈린다
              data-dmn-section="true"
              className="bg-fill-faint rounded-surface p-[4px] flex flex-col gap-[4px]"
            >
              {displayPoses.map((pose, poseIndex) => {
                const isDuplicate = duplicatePose?.poseId === pose.poseId;
                const isEmpty = pose.triggers.length === 0;
                const isEditing = activeEditorTarget?.poseId === pose.poseId;
                const displayName = pose.name || resolvedNames[poseIndex];
                const isRenamingPose = renamingPoseId === pose.poseId;
                const openPose = (anchor: HTMLElement) =>
                  openEditorPopup(
                    { positionId: position.id, poseId: pose.poseId },
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

      {/* 상태 편집 팝업 */}
      <PopupExit open={editingPose !== null}>
        {editingPose ? (
          <SpritePoseEditorPopup
            // 리사이즈 착지 세대 - 리마운트가 진행 중 스크럽 세션을 취소로 닫아
            // 이전 배율 절대값 커밋을 차단한다 (useScrubDrag 언마운트 취소 계약)
            key={`resize-${resizeGestureCancel?.tick ?? 0}`}
            open
            ariaLabel={editingPose.name || resolvedNames[editingPoseIndex]}
            // 셸은 행 전환 동안 유지되고 편집 subtree·앵커만 poseId로 갈린다
            poseId={editingPose.poseId}
            transform={editingPose.transform}
            pivot={editingPose.pivot ?? position.pivot}
            followsBasePivot={editingPose.pivot == null}
            referenceRef={poseAnchorRef}
            panelElement={panelElement}
            interactiveRefs={[poseListRef]}
            poseControls={{
              keyOptions,
              triggers: editingPose.triggers,
              isDuplicate: duplicatePose?.poseId === editingPose.poseId,
              imageOverride: editingPose.imageOverride,
              onToggleTrigger: (keyId) =>
                togglePoseTrigger(editingPoseIndex, keyId),
              onImagePick: () => void handlePoseImageSelect(editingPose.poseId),
              // 이미지를 지우면 그 이미지에 매인 크기도 함께 지운다
              onImageReset: () =>
                replacePose(editingPoseIndex, {
                  imageOverride: null,
                  imageOverrideMetrics: null,
                }),
            }}
            // 콜백 부재는 접두 스크럽 자체를 꺼 버린다 - 항상 넘기고 안에서 분기
            onTransformCommit={handleTransformCommit}
            onTransformPreview={handleTransformPreview}
            onTransformCancel={handleTransformCancel}
            onPivotCommit={handlePosePivotCommit}
            onPivotPreview={handlePosePivotPreview}
            onPivotLinkChange={handlePosePivotLinkChange}
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
