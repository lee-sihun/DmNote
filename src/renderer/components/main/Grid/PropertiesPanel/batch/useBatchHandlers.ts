import type {
  KeyPosition,
  NoteColor,
  KeyCounterSettings,
} from '@src/types/key/keys';
import { normalizeCounterSettings } from '@src/types/key/keys';
import {
  getActivePairPreservation,
  gradientPairPatch,
  type ColorModeValue,
} from '@src/types/color';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import {
  resolveElementShadowForPosition,
  type ElementShadowSpec,
} from '@src/types/key/shadows';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import {
  computeBatchGeometryPlan,
  computeBatchSpacingValue,
  type BatchGeometryOperation,
} from '@src/renderer/editor/runtime/batchGeometryPlan';
import {
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';

import type { EditorPatchV1 } from '@src/types/editor';

type KeyLikeType = 'key' | 'stat' | 'graph' | 'knob';
type IdleColorProperty = 'backgroundColor' | 'borderColor' | 'fontColor';
type ActiveColorProperty =
  | 'activeBackgroundColor'
  | 'activeBorderColor'
  | 'activeFontColor';

const ACTIVE_COLOR_PROPERTY: Record<IdleColorProperty, ActiveColorProperty> = {
  backgroundColor: 'activeBackgroundColor',
  borderColor: 'activeBorderColor',
  fontColor: 'activeFontColor',
};

const GRADIENT_PROPERTY = {
  backgroundColor: {
    idle: 'backgroundGradient',
    active: 'activeBackgroundGradient',
  },
  borderColor: {
    idle: 'borderGradient',
    active: 'activeBorderGradient',
  },
} as const;

const isIdleColorProperty = (
  property: keyof KeyPosition,
): property is IdleColorProperty => property in ACTIVE_COLOR_PROPERTY;

const ACTIVE_STATE_PROPERTIES = new Set<keyof KeyPosition>([
  'activeBackgroundColor',
  'activeBorderColor',
  'activeFontColor',
  'activeBackgroundGradient',
  'activeBorderGradient',
  'activeImage',
  'activeTransparent',
  'activeImageFit',
  'activeShadow',
]);

const isActiveStateProperty = (property: keyof KeyPosition): boolean =>
  ACTIVE_STATE_PROPERTIES.has(property);

const buildBatchStyleUpdate = (
  index: number,
  position: KeyPosition | undefined,
  property: keyof KeyPosition,
  value: KeyPosition[keyof KeyPosition],
  includeFontColor = true,
  preserveActiveState = true,
): { index: number } & Partial<KeyPosition> => {
  const update = { index, [property]: value } as {
    index: number;
  } & Partial<KeyPosition>;
  if (
    !position ||
    !preserveActiveState ||
    !isIdleColorProperty(property) ||
    (!includeFontColor && property === 'fontColor')
  ) {
    return update;
  }

  const activeProperty = ACTIVE_COLOR_PROPERTY[property];
  const gradientProperty =
    property === 'fontColor' ? undefined : GRADIENT_PROPERTY[property];
  const preservation = getActivePairPreservation(
    {
      color: position[property],
      gradient: gradientProperty ? position[gradientProperty.idle] : undefined,
    },
    {
      color: position[activeProperty],
      gradient: gradientProperty
        ? position[gradientProperty.active]
        : undefined,
    },
  );
  if (preservation?.color !== undefined) {
    Object.assign(update, { [activeProperty]: preservation.color });
  }
  if (gradientProperty && preservation?.gradient !== undefined) {
    Object.assign(update, {
      [gradientProperty.active]: preservation.gradient,
    });
  }
  return update;
};

interface LayoutElement {
  type: KeyLikeType;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type KeyLikeBatchUpdate = {
  type: KeyLikeType;
  index: number;
} & Partial<KeyPosition>;

type BatchCommitOptions = {
  deferSave?: boolean;
  // 세션 단위 히스토리 병합용 (백엔드가 같은 gestureId 연속 커밋을 한 entry로 흡수)
  gestureId?: string;
};

interface SelectedElement {
  type: KeyLikeType;
  id?: string;
  index?: number;
}

const getLayoutElementKey = (type: KeyLikeType, index: number): string =>
  `${type}:${index}`;

interface UseBatchHandlersProps {
  selectedKeyLikeElements: SelectedElement[];
  keyPositions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  graphPositions?: Record<string, GraphItemPosition[] | undefined>;
  selectedKeyType: string;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyBatchUpdate?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
    options?: BatchCommitOptions,
  ) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyBatchPreview?: (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
  ) => void;
  onStatUpdate: (data: Partial<StatItemPosition> & { index: number }) => void;
  onStatBatchUpdate?: (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
    options?: BatchCommitOptions,
  ) => void;
  onStatPreview?: (index: number, updates: Partial<StatItemPosition>) => void;
  onStatBatchPreview?: (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
  ) => void;
  onGraphUpdate?: (
    data: Partial<GraphItemPosition> & { index: number },
  ) => void;
  onGraphBatchUpdate?: (
    updates: Array<{ index: number } & Partial<GraphItemPosition>>,
    options?: BatchCommitOptions,
  ) => void;
  onGraphPreview?: (index: number, updates: Partial<GraphItemPosition>) => void;
  onGraphBatchPreview?: (
    updates: Array<{ index: number } & Partial<GraphItemPosition>>,
  ) => void;
  knobPositions?: Record<string, KnobItemPosition[] | undefined>;
  onKnobUpdate?: (data: Partial<KnobItemPosition> & { index: number }) => void;
  onKnobBatchUpdate?: (
    updates: Array<{ index: number } & Partial<KnobItemPosition>>,
    options?: BatchCommitOptions,
  ) => void;
  onKnobPreview?: (index: number, updates: Partial<KnobItemPosition>) => void;
  onKnobBatchPreview?: (
    updates: Array<{ index: number } & Partial<KnobItemPosition>>,
  ) => void;
  onStableGeometryCommit?: (
    operation: BatchGeometryOperation,
    options?: BatchCommitOptions,
  ) => void;
  onStableGeometryPreview?: (operation: BatchGeometryOperation) => void;
  stableGeometryEnabled?: boolean;
}

export function useBatchHandlers({
  selectedKeyLikeElements,
  keyPositions,
  statPositions,
  graphPositions,
  selectedKeyType,
  onKeyUpdate,
  onKeyBatchUpdate,
  onKeyPreview,
  onKeyBatchPreview,
  onStatUpdate,
  onStatBatchUpdate,
  onStatPreview,
  onStatBatchPreview,
  onGraphUpdate,
  onGraphBatchUpdate,
  onGraphPreview,
  onGraphBatchPreview,
  knobPositions,
  onKnobUpdate,
  onKnobBatchUpdate,
  onKnobPreview,
  onKnobBatchPreview,
  onStableGeometryCommit,
  onStableGeometryPreview,
  stableGeometryEnabled = false,
}: UseBatchHandlersProps) {
  const selectedKeys = selectedKeyLikeElements.filter(
    (el) => el.type === 'key',
  );
  const selectedStats = selectedKeyLikeElements.filter(
    (el) => el.type === 'stat',
  );
  const selectedGraphs = selectedKeyLikeElements.filter(
    (el) => el.type === 'graph',
  );
  const selectedKnobs = selectedKeyLikeElements.filter(
    (el) => el.type === 'knob',
  );

  const getKeyLikePosition = (type: KeyLikeType, index: number) => {
    if (type === 'key') return keyPositions[selectedKeyType]?.[index] ?? null;
    if (type === 'stat') return statPositions[selectedKeyType]?.[index] ?? null;
    if (type === 'knob')
      return knobPositions?.[selectedKeyType]?.[index] ?? null;
    return graphPositions?.[selectedKeyType]?.[index] ?? null;
  };

  const dispatchKeyUpdates = (
    updates: Array<{ index: number } & Partial<KeyPosition>>,
    kind: 'preview' | 'commit',
    options?: BatchCommitOptions,
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onKeyBatchPreview) {
        onKeyBatchPreview(updates);
        return;
      }
      if (onKeyPreview) {
        updates.forEach(({ index, ...rest }) => onKeyPreview(index, rest));
        return;
      }
      return;
    }

    if (onKeyBatchUpdate) {
      onKeyBatchUpdate(updates, options);
      return;
    }
    updates.forEach((update) => onKeyUpdate(update));
  };

  const dispatchStatUpdates = (
    updates: Array<{ index: number } & Partial<StatItemPosition>>,
    kind: 'preview' | 'commit',
    options?: BatchCommitOptions,
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onStatBatchPreview) {
        onStatBatchPreview(updates);
        return;
      }
      if (onStatPreview) {
        updates.forEach(({ index, ...rest }) => onStatPreview(index, rest));
        return;
      }
      // preview 핸들러가 없으면 즉시 반영
      updates.forEach((update) => onStatUpdate(update));
      return;
    }

    if (onStatBatchUpdate) {
      onStatBatchUpdate(updates, options);
      return;
    }
    updates.forEach((update) => onStatUpdate(update));
  };

  const dispatchGraphUpdates = (
    updates: Array<{ index: number } & Partial<GraphItemPosition>>,
    kind: 'preview' | 'commit',
    options?: BatchCommitOptions,
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onGraphBatchPreview) {
        onGraphBatchPreview(updates);
        return;
      }
      if (onGraphPreview) {
        updates.forEach(({ index, ...rest }) => onGraphPreview(index, rest));
        return;
      }
      if (onGraphUpdate) {
        updates.forEach((update) => onGraphUpdate(update));
      }
      return;
    }

    if (onGraphBatchUpdate) {
      onGraphBatchUpdate(updates, options);
      return;
    }
    if (onGraphUpdate) {
      updates.forEach((update) => onGraphUpdate(update));
    }
  };

  const dispatchKnobUpdates = (
    updates: Array<{ index: number } & Partial<KnobItemPosition>>,
    kind: 'preview' | 'commit',
    options?: BatchCommitOptions,
  ) => {
    if (updates.length === 0) return;
    if (kind === 'preview') {
      if (onKnobBatchPreview) {
        onKnobBatchPreview(updates);
        return;
      }
      if (onKnobPreview) {
        updates.forEach(({ index, ...rest }) => onKnobPreview(index, rest));
        return;
      }
      if (onKnobUpdate) {
        updates.forEach((update) => onKnobUpdate(update));
      }
      return;
    }

    if (onKnobBatchUpdate) {
      onKnobBatchUpdate(updates, options);
      return;
    }
    if (onKnobUpdate) {
      updates.forEach((update) => onKnobUpdate(update));
    }
  };

  const getSelectedLayoutElements = (): LayoutElement[] => {
    return selectedKeyLikeElements
      .filter(
        (el): el is { type: KeyLikeType; index: number } =>
          el.index !== undefined,
      )
      .map((el) => {
        const pos = getKeyLikePosition(el.type, el.index);
        if (!pos) return null;
        return {
          type: el.type,
          index: el.index,
          x: pos.dx,
          y: pos.dy,
          width: pos.width,
          height: pos.height,
        };
      })
      .filter((element): element is LayoutElement => element !== null);
  };

  const computeGeometryUpdates = (
    operation: BatchGeometryOperation,
  ): KeyLikeBatchUpdate[] => {
    const elements = getSelectedLayoutElements();
    const byKey = new Map(
      elements.map((element) => [
        getLayoutElementKey(element.type, element.index),
        element,
      ]),
    );
    const plan = computeBatchGeometryPlan(
      elements.map((element) => ({
        key: getLayoutElementKey(element.type, element.index),
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      })),
      operation,
    );
    if (!plan) return [];
    return plan.updates.flatMap(({ key, patch }) => {
      const element = byKey.get(key);
      return element
        ? [{ type: element.type, index: element.index, ...patch }]
        : [];
    });
  };

  const dispatchKeyLikeUpdates = (
    updates: KeyLikeBatchUpdate[],
    kind: 'preview' | 'commit' = 'commit',
    options?: BatchCommitOptions,
  ) => {
    const keyUpdates = updates
      .filter((u) => u.type === 'key')
      .map(({ type: _t, ...rest }) => rest) as Array<
      { index: number } & Partial<KeyPosition>
    >;
    const statUpdates = updates
      .filter((u) => u.type === 'stat')
      .map(({ type: _t, ...rest }) => rest) as Array<
      { index: number } & Partial<StatItemPosition>
    >;
    const graphUpdates = updates
      .filter((u) => u.type === 'graph')
      .map(({ type: _t, ...rest }) => rest) as Array<
      { index: number } & Partial<GraphItemPosition>
    >;
    const knobUpdates = updates
      .filter((u) => u.type === 'knob')
      .map(({ type: _t, ...rest }) => rest) as Array<
      { index: number } & Partial<KnobItemPosition>
    >;

    if (kind === 'preview') {
      dispatchKeyUpdates(keyUpdates, 'preview');
      dispatchStatUpdates(statUpdates, 'preview');
      dispatchGraphUpdates(graphUpdates, 'preview');
      dispatchKnobUpdates(knobUpdates, 'preview');
      return;
    }

    if (keyUpdates.length > 0) {
      dispatchKeyUpdates(keyUpdates, 'commit', { deferSave: true });
    }
    if (statUpdates.length > 0) {
      dispatchStatUpdates(statUpdates, 'commit', { deferSave: true });
    }
    if (graphUpdates.length > 0) {
      dispatchGraphUpdates(graphUpdates, 'commit', { deferSave: true });
    }
    if (knobUpdates.length > 0) {
      dispatchKnobUpdates(knobUpdates, 'commit', { deferSave: true });
    }

    const patch: EditorPatchV1 = { schemaVersion: 1 };
    if (keyUpdates.length > 0) {
      // deferSave로 canonical에 반영된 최신 값 기준 (rendered 승격 금지)
      patch.keyPositions = useKeyStore.getState().canonicalPositions;
    }
    if (statUpdates.length > 0) {
      patch.statPositions = useStatItemStore.getState().positions;
    }
    if (graphUpdates.length > 0) {
      patch.graphPositions = useGraphItemStore.getState().positions;
    }
    if (knobUpdates.length > 0) {
      patch.knobPositions = useKnobItemStore.getState().positions;
    }
    const sessionGestureId =
      options?.gestureId ?? editGestureController.activeGestureId();
    const commitPromise = editorCoordinator.commitPatch(
      patch,
      sessionGestureId ? { gestureId: sessionGestureId } : undefined,
    );
    // 배치 프리뷰 게스처를 combined 커밋 성패로 정산
    editGestureController.settleCommit(commitPromise);
    void commitPromise.catch((error) => {
      console.error('Failed to commit combined batch update', error);
    });
  };

  // 스타일 변경 (프리뷰)
  const handleBatchStyleChange = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    if (
      stableGeometryEnabled &&
      onStableGeometryPreview &&
      (property === 'width' || property === 'height') &&
      typeof value === 'number'
    ) {
      onStableGeometryPreview({
        kind: 'resize',
        dimension: property,
        value,
      });
      return;
    }
    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [property]: value })) as Array<
      { index: number } & Partial<KeyPosition>
    >;
    dispatchKeyUpdates(keyUpdates, 'preview');

    const statUpdates = isActiveStateProperty(property)
      ? []
      : (selectedStats
          .filter((el) => el.index !== undefined)
          .map((el) => ({ index: el.index!, [property]: value })) as Array<
          { index: number } & Partial<StatItemPosition>
        >);
    dispatchStatUpdates(statUpdates, 'preview');

    const graphUpdates = isActiveStateProperty(property)
      ? []
      : (selectedGraphs
          .filter((el) => el.index !== undefined)
          .map((el) => ({ index: el.index!, [property]: value })) as Array<
          { index: number } & Partial<GraphItemPosition>
        >);
    dispatchGraphUpdates(graphUpdates, 'preview');

    const knobUpdates = selectedKnobs
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [property]: value })) as Array<
      { index: number } & Partial<KnobItemPosition>
    >;
    dispatchKnobUpdates(knobUpdates, 'preview');
  };

  // 스타일 변경 완료 (저장)
  const handleBatchStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    const currentKeys = keyPositions[selectedKeyType] || [];
    const currentStats = statPositions[selectedKeyType] || [];

    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => {
        const index = el.index!;
        return buildBatchStyleUpdate(
          index,
          currentKeys[index],
          property,
          value,
        );
      });
    const statUpdates = isActiveStateProperty(property)
      ? []
      : selectedStats
          .filter((el) => el.index !== undefined)
          .map((el) => {
            const index = el.index!;
            return buildBatchStyleUpdate(
              index,
              currentStats[index],
              property,
              value,
              true,
              false,
            ) as { index: number } & Partial<StatItemPosition>;
          });
    const graphUpdates = isActiveStateProperty(property)
      ? []
      : (selectedGraphs
          .filter((el) => el.index !== undefined)
          .map((el) => ({ index: el.index!, [property]: value })) as Array<
          { index: number } & Partial<GraphItemPosition>
        >);
    const currentKnobs = knobPositions?.[selectedKeyType] || [];
    const knobUpdates = selectedKnobs
      .filter((el) => el.index !== undefined)
      .map((el) => {
        const index = el.index!;
        return buildBatchStyleUpdate(
          index,
          currentKnobs[index],
          property,
          value,
          false,
        ) as { index: number } & Partial<KnobItemPosition>;
      });
    dispatchKeyLikeUpdates([
      ...keyUpdates.map((update) => ({ type: 'key' as const, ...update })),
      ...statUpdates.map((update) => ({
        type: 'stat' as const,
        ...update,
      })),
      ...graphUpdates.map((update) => ({
        type: 'graph' as const,
        ...update,
      })),
      ...knobUpdates.map((update) => ({
        type: 'knob' as const,
        ...update,
      })),
    ] as KeyLikeBatchUpdate[]);
  };

  // 요소별 저장값+기본값을 합친 실제 그림자 (이미지·노브 투명 등 기본 억제 규칙 포함)
  const resolveShadowFor = (
    position: KeyPosition,
    active: boolean,
    kind: 'key' | 'knob',
  ): ElementShadowSpec => {
    return resolveElementShadowForPosition({
      position,
      elementType: kind,
      active,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
    });
  };

  const dispatchShadowUpdates = (
    buildUpdate: (
      index: number,
      position: KeyPosition | undefined,
      kind: 'key' | 'knob',
      elementType: 'key' | 'stat' | 'knob',
    ) => { index: number } & Partial<KeyPosition>,
  ) => {
    const currentKeys = keyPositions[selectedKeyType] || [];
    const currentStats = statPositions[selectedKeyType] || [];
    const currentKnobs = knobPositions?.[selectedKeyType] || [];

    dispatchKeyLikeUpdates([
      ...selectedKeys
        .filter((element) => element.index !== undefined)
        .map((element) => ({
          type: 'key' as const,
          ...buildUpdate(
            element.index!,
            currentKeys[element.index!],
            'key',
            'key',
          ),
        })),
      ...selectedStats
        .filter((element) => element.index !== undefined)
        .map((element) => ({
          type: 'stat' as const,
          ...buildUpdate(
            element.index!,
            currentStats[element.index!],
            'key',
            'stat',
          ),
        })),
      ...selectedKnobs
        .filter((element) => element.index !== undefined)
        .map((element) => ({
          type: 'knob' as const,
          ...buildUpdate(
            element.index!,
            currentKnobs[element.index!],
            'knob',
            'knob',
          ),
        })),
    ] as KeyLikeBatchUpdate[]);
  };

  const handleBatchShadowChangeComplete = (
    state: 'idle' | 'active',
    patch: Partial<ElementShadowSpec>,
  ) => {
    const active = state === 'active';
    const field = active ? 'activeShadow' : 'shadow';
    dispatchShadowUpdates((index, position, kind, elementType) => {
      if (!position) return { index };
      // 통계는 눌림 상태가 없음 — 입력 그림자를 기록하지 않음
      if (active && elementType === 'stat') return { index };
      return {
        index,
        [field]: { ...resolveShadowFor(position, active, kind), ...patch },
      };
    });
  };

  // 마스터 토글 — 대기·입력 그림자를 요소별 현재 값 기준으로 한 번에 켜고 끔
  const handleBatchShadowEnabledChange = (enabled: boolean) => {
    dispatchShadowUpdates((index, position, kind, elementType) => {
      if (!position) return { index };
      return {
        index,
        shadow: { ...resolveShadowFor(position, false, kind), enabled },
        // 통계는 눌림 상태가 없음 — activeShadow 실체화 금지
        ...(elementType === 'stat'
          ? {}
          : {
              activeShadow: {
                ...resolveShadowFor(position, true, kind),
                enabled,
              },
            }),
      };
    });
  };

  // 그라데이션 커밋 — 배경/테두리 쌍(base+sibling)을 선택 요소 전체에 atomic 적용
  const handleBatchGradientCommit = (
    target: 'backgroundColor' | 'borderColor',
    state: 'idle' | 'active',
    value: ColorModeValue,
  ) => {
    const isBg = target === 'backgroundColor';
    const baseField =
      state === 'active'
        ? isBg
          ? 'activeBackgroundColor'
          : 'activeBorderColor'
        : target;
    const pairPatch = gradientPairPatch(
      baseField,
      value,
    ) as Partial<KeyPosition>;

    const buildUpdate = (
      index: number,
      pos: KeyPosition | undefined,
      preserveActiveState = true,
    ): { index: number } & Partial<KeyPosition> => {
      const update: { index: number } & Partial<KeyPosition> = {
        index,
        ...pairPatch,
      };
      // idle 편집 전 사용자 저장값 기준 active 쌍 보존
      if (state === 'idle' && pos && preserveActiveState) {
        const preservation = getActivePairPreservation(
          {
            color: isBg ? pos.backgroundColor : pos.borderColor,
            gradient: isBg ? pos.backgroundGradient : pos.borderGradient,
          },
          {
            color: isBg ? pos.activeBackgroundColor : pos.activeBorderColor,
            gradient: isBg
              ? pos.activeBackgroundGradient
              : pos.activeBorderGradient,
          },
        );
        if (preservation?.color !== undefined) {
          if (isBg) {
            update.activeBackgroundColor = preservation.color;
          } else {
            update.activeBorderColor = preservation.color;
          }
        }
        if (preservation?.gradient !== undefined) {
          if (isBg) {
            update.activeBackgroundGradient = preservation.gradient;
          } else {
            update.activeBorderGradient = preservation.gradient;
          }
        }
      }
      return update;
    };

    const currentKeys = keyPositions[selectedKeyType] || [];
    const currentStats = statPositions[selectedKeyType] || [];
    const currentGraphs = graphPositions?.[selectedKeyType] || [];
    const currentKnobs = knobPositions?.[selectedKeyType] || [];

    dispatchKeyLikeUpdates([
      ...selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({
          type: 'key' as const,
          ...buildUpdate(el.index!, currentKeys[el.index!]),
        })),
      ...selectedStats
        .filter((el) => state !== 'active' && el.index !== undefined)
        .map((el) => ({
          type: 'stat' as const,
          ...buildUpdate(el.index!, currentStats[el.index!], false),
        })),
      ...selectedGraphs
        // 그래프는 active 상태가 없음 — 입력 그라데이션 기록 제외
        .filter((el) => state !== 'active' && el.index !== undefined)
        .map((el) => ({
          type: 'graph' as const,
          ...buildUpdate(el.index!, currentGraphs[el.index!]),
        })),
      ...selectedKnobs
        .filter((el) => el.index !== undefined)
        .map((el) => ({
          type: 'knob' as const,
          ...buildUpdate(el.index!, currentKnobs[el.index!]),
        })),
    ] as KeyLikeBatchUpdate[]);
  };

  // 정렬 핸들러
  const handleBatchAlign = (
    direction: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
  ) => {
    if (stableGeometryEnabled && onStableGeometryCommit) {
      onStableGeometryCommit({ kind: 'align', direction });
      return;
    }
    dispatchKeyLikeUpdates(
      computeGeometryUpdates({ kind: 'align', direction }),
    );
  };

  // 분배 핸들러
  const handleBatchDistribute = (direction: 'horizontal' | 'vertical') => {
    if (stableGeometryEnabled && onStableGeometryCommit) {
      onStableGeometryCommit({ kind: 'distribute', direction });
      return;
    }
    dispatchKeyLikeUpdates(
      computeGeometryUpdates({ kind: 'distribute', direction }),
    );
  };

  /**
   * 간격 적용 공통 로직 (preview/commit 공용)
   * 반환: 변경이 필요한 업데이트 배열 (없으면 빈 배열)
   */
  const computeSpacingUpdates = (spacing: number): KeyLikeBatchUpdate[] => {
    return computeGeometryUpdates({ kind: 'spacing', spacing });
  };

  // 간격 프리뷰 (타이핑 중 시각적 반영, 히스토리 미저장)
  const handleBatchSpacingPreview = (spacing: number) => {
    const updates = computeSpacingUpdates(spacing);
    if (updates.length === 0) return;
    dispatchKeyLikeUpdates(updates, 'preview');
  };

  // 간격 커밋
  const handleBatchSpacingCommit = (
    spacing: number,
    options?: BatchCommitOptions,
  ) => {
    if (stableGeometryEnabled && onStableGeometryCommit) {
      onStableGeometryCommit({ kind: 'spacing', spacing }, options);
      return;
    }
    const updates = computeSpacingUpdates(spacing);
    if (updates.length === 0) return;
    dispatchKeyLikeUpdates(updates, 'commit', options);
  };

  // 기존 호환용 (외부에서 직접 호출 시 commit 모드)
  const handleBatchSpacing = (
    spacing: number,
    options?: BatchCommitOptions,
  ) => {
    handleBatchSpacingCommit(spacing, options);
  };

  const getBatchSpacingValue = () => {
    return computeBatchSpacingValue(
      getSelectedLayoutElements().map((element) => ({
        key: getLayoutElementKey(element.type, element.index),
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      })),
    );
  };

  // 일괄 크기 변경 핸들러
  const handleBatchResize = (dimension: 'width' | 'height', value: number) => {
    if (stableGeometryEnabled && onStableGeometryCommit) {
      onStableGeometryCommit({ kind: 'resize', dimension, value });
      return;
    }
    dispatchKeyLikeUpdates(
      computeGeometryUpdates({ kind: 'resize', dimension, value }),
    );
  };

  // 카운터 업데이트 핸들러
  const handleBatchCounterUpdate = (
    updates: Partial<KeyCounterSettings>,
    options?: {
      activeStateOnly?: boolean;
      colorState?: 'idle' | 'active';
    },
  ) => {
    const mergeCounterSettings = (
      currentSettings: KeyCounterSettings,
    ): KeyCounterSettings => {
      const newSettings = { ...currentSettings, ...updates };
      if (options?.colorState && updates.fill) {
        newSettings.fill = {
          ...currentSettings.fill,
          [options.colorState]: updates.fill[options.colorState],
        };
      }
      if (options?.colorState && updates.stroke) {
        newSettings.stroke = {
          ...currentSettings.stroke,
          [options.colorState]: updates.stroke[options.colorState],
        };
      }
      return newSettings;
    };

    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => {
        const pos = keyPositions[selectedKeyType]?.[el.index!];
        if (!pos) return null;
        const currentSettings = normalizeCounterSettings(pos.counter);
        const newSettings = mergeCounterSettings(currentSettings);
        return { index: el.index!, counter: newSettings };
      })
      .filter(
        (update): update is { index: number; counter: KeyCounterSettings } =>
          update !== null,
      );
    const statUpdates = (options?.activeStateOnly ? [] : selectedStats)
      .filter((el) => el.index !== undefined)
      .map((el) => {
        const pos = statPositions[selectedKeyType]?.[el.index!];
        if (!pos) return null;
        const currentSettings = normalizeCounterSettings(pos.counter);
        const newSettings = mergeCounterSettings(currentSettings);
        return { index: el.index!, counter: newSettings } as {
          index: number;
        } & Partial<StatItemPosition>;
      })
      .filter(
        (
          update,
        ): update is {
          index: number;
          counter: KeyCounterSettings;
        } & Partial<StatItemPosition> => update !== null,
      );
    dispatchKeyLikeUpdates([
      ...keyUpdates.map((update) => ({ type: 'key' as const, ...update })),
      ...statUpdates.map((update) => ({
        type: 'stat' as const,
        ...update,
      })),
    ] as KeyLikeBatchUpdate[]);
  };

  // 노트 색상 변경 (프리뷰) - 키 요소만
  const handleBatchNoteColorChange = (newColor: NoteColor) => {
    let colorValue: NoteColor;
    if (
      newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient'
    ) {
      colorValue = {
        type: 'gradient',
        top: newColor.top,
        bottom: newColor.bottom,
      };
    } else {
      colorValue = newColor;
    }

    const updates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, noteColor: colorValue }));

    dispatchKeyUpdates(
      updates as Array<{ index: number } & Partial<KeyPosition>>,
      'preview',
    );
  };

  // 노트 색상 변경 완료 (저장) - 키 요소만
  const handleBatchNoteColorChangeComplete = (newColor: NoteColor) => {
    let colorValue: NoteColor;
    if (
      newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient'
    ) {
      colorValue = {
        type: 'gradient',
        top: newColor.top,
        bottom: newColor.bottom,
      };
    } else {
      colorValue = newColor;
    }

    const updates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, noteColor: colorValue }));

    dispatchKeyUpdates(
      updates as Array<{ index: number } & Partial<KeyPosition>>,
      'commit',
    );
  };

  // 글로우 색상 변경 (프리뷰) - 키 요소만
  const handleBatchGlowColorChange = (newColor: NoteColor) => {
    let colorValue: NoteColor;
    if (
      newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient'
    ) {
      colorValue = {
        type: 'gradient',
        top: newColor.top,
        bottom: newColor.bottom,
      };
    } else {
      colorValue = newColor;
    }

    const updates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, noteGlowColor: colorValue }));

    dispatchKeyUpdates(
      updates as Array<{ index: number } & Partial<KeyPosition>>,
      'preview',
    );
  };

  // 글로우 색상 변경 완료 (저장) - 키 요소만
  const handleBatchGlowColorChangeComplete = (newColor: NoteColor) => {
    let colorValue: NoteColor;
    if (
      newColor &&
      typeof newColor === 'object' &&
      newColor.type === 'gradient'
    ) {
      colorValue = {
        type: 'gradient',
        top: newColor.top,
        bottom: newColor.bottom,
      };
    } else {
      colorValue = newColor;
    }

    const updates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, noteGlowColor: colorValue }));

    dispatchKeyUpdates(
      updates as Array<{ index: number } & Partial<KeyPosition>>,
      'commit',
    );
  };

  const handleKeyOnlyStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    const keyUpdates = selectedKeys
      .filter((el) => el.index !== undefined)
      .map((el) => ({ index: el.index!, [property]: value })) as Array<
      { index: number } & Partial<KeyPosition>
    >;
    dispatchKeyUpdates(keyUpdates, 'commit');
  };

  // 눌림 가능(키·노브) 전용 — active 상태 쓰기가 통계만 제외하고 노브는 포함
  const handleActiveCapableStyleChangeComplete = (
    property: keyof KeyPosition,
    value: KeyPosition[keyof KeyPosition],
  ) => {
    dispatchKeyLikeUpdates([
      ...selectedKeys
        .filter((el) => el.index !== undefined)
        .map((el) => ({
          type: 'key' as const,
          index: el.index!,
          [property]: value,
        })),
      ...selectedKnobs
        .filter((el) => el.index !== undefined)
        .map((el) => ({
          type: 'knob' as const,
          index: el.index!,
          [property]: value,
        })),
    ] as KeyLikeBatchUpdate[]);
  };

  return {
    handleBatchStyleChange,
    handleBatchStyleChangeComplete,
    handleBatchShadowChangeComplete,
    handleBatchShadowEnabledChange,
    handleBatchGradientCommit,
    handleKeyOnlyStyleChangeComplete,
    handleActiveCapableStyleChangeComplete,
    handleBatchAlign,
    handleBatchDistribute,
    handleBatchSpacing,
    handleBatchSpacingPreview,
    handleBatchSpacingCommit,
    getBatchSpacingValue,
    handleBatchResize,
    handleBatchCounterUpdate,
    handleBatchNoteColorChange,
    handleBatchNoteColorChangeComplete,
    handleBatchGlowColorChange,
    handleBatchGlowColorChangeComplete,
  };
}
