import { useState, useEffect, useRef, useCallback } from 'react';
import {
  toCanonicalGradient,
  toCompactRgba,
  type ColorModeValue,
  type ColorPair,
  type GradientSpec,
} from '@src/types/color';
import {
  FormatSelectBar,
  GradientStopEditor,
  type ColorFormat,
} from '@components/main/Modal/content/pickers/GradientFormatControls';
import {
  useGradientEditStore,
  type GradientCanvasAnchor,
  type GradientPreviewState,
  type GradientPreviewSurface,
} from '@stores/grid/useGradientEditStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

interface UseGradientColorStateOptions {
  /** 현재 저장된 쌍 (base 색 + gradient 형제) */
  pair: ColorPair;
  fallbackColor: string;
  /** 편집 대상 식별자 — 바뀌면 초안·선택이 자동 무효화 */
  contextKey?: string;
  /** 온캔버스 각도 핸들 앵커 — 지정 시 그라데이션 편집 중 그리드에 축 표시 */
  canvasAnchor?: GradientCanvasAnchor;
  /** 편집 표면 — 캔버스 일시 페인트가 덮을 필드 (기본 background) */
  canvasSurface?: GradientPreviewSurface;
  /** 캔버스 미리보기 상태 — 활성 편집이면 다른 표면도 활성 값으로 렌더 */
  canvasState?: GradientPreviewState;
  /** 미리보기(드래그 중) — 상위 프리뷰 경로로 전달 */
  onPreview?: (value: ColorModeValue) => void;
  /** 미리보기 취소, 외부 편집 제스처 폐기 */
  onCancel?: () => void;
  /** 확정 커밋 — atomic patch 산출은 호출부가 gradientPairPatch/counterFillPair로 */
  onCommit: (value: ColorModeValue) => void;
}

/**
 * 피커의 형식·스톱 상태 관리 훅.
 * 형식과 스펙은 저장값에서 렌더 시점에 파생한다 — effect로 상태에 복사하지
 * 않으므로 첫 렌더부터 최종 레이아웃이 나오고(피커 위치 점프 방지), 커밋은
 * 저장값 갱신으로 즉시 반영된다. 미커밋 드래그 프리뷰만 draft로 유지
 */

// 같은 색의 알파 0 버전 — 파싱 불가한 색(named 등)은 원문 유지
const zeroAlpha = (color: string): string => {
  const c = color.trim();
  // #RGBA 4자리는 toCompactRgba 미지원 — RGB만 확장해 처리 (알파는 어차피 0)
  const short = c.match(/^#([0-9a-fA-F]{4})$/);
  const normalized = short
    ? `#${short[1]
        .slice(0, 3)
        .split('')
        .map((ch) => ch + ch)
        .join('')}`
    : c;
  const m = toCompactRgba(normalized).match(/^rgba\((\d+),(\d+),(\d+),/);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},0)` : color;
};
export function useGradientColorState({
  pair,
  fallbackColor,
  contextKey,
  canvasAnchor,
  canvasSurface = 'background',
  canvasState = 'idle',
  onPreview,
  onCancel,
  onCommit,
}: UseGradientColorStateOptions) {
  const storedSpec = pair.gradient ?? null;
  const selectedElements = useGridSelectionStore(
    (state) => state.selectedElements,
  );
  const lastGradientSpecsRef = useRef(new Map<string, GradientSpec>());

  // 형식 왕복 기억은 연속 선택 안에서만 유효. 삭제·재선택으로 대상이
  // 바뀌면 이전 요소의 spec을 재사용하지 않는다
  useEffect(() => {
    lastGradientSpecsRef.current.clear();
  }, [selectedElements]);

  // 진행 중(미커밋) 드래그 초안 — 다른 대상으로 바뀌면 자동 무효
  const [draft, setDraft] = useState<{
    key: string | undefined;
    spec: GradientSpec;
  } | null>(null);

  const workingSpec =
    (draft && draft.key === contextKey ? draft.spec : null) ?? storedSpec;
  const format: ColorFormat = workingSpec ? 'gradient' : 'solid';

  // 선택 스톱 — 대상별로 유지, 대상이 바뀌면 0
  const [selection, setSelection] = useState<{
    key: string | undefined;
    index: number;
  }>({ key: contextKey, index: 0 });

  const maxStopIndex = Math.max(0, (workingSpec?.stops.length ?? 1) - 1);

  // 대상 전환·외부 spec 축소 시 이전 초안과 범위 밖 선택을 폐기
  useEffect(() => {
    setDraft((prev) => (prev && prev.key !== contextKey ? null : prev));
    setSelection((prev) => {
      if (prev.key !== contextKey) return { key: contextKey, index: 0 };
      const index = Math.min(Math.max(prev.index, 0), maxStopIndex);
      return index === prev.index ? prev : { ...prev, index };
    });
  }, [contextKey, maxStopIndex]);
  const selectedStop =
    selection.key === contextKey
      ? Math.min(Math.max(selection.index, 0), maxStopIndex)
      : 0;
  const setSelectedStop = useCallback(
    (index: number) =>
      setSelection({
        key: contextKey,
        index,
      }),
    [contextKey],
  );

  const baseColor = pair.color || fallbackColor;

  const seedSpecFromSolid = useCallback(
    (color: string): GradientSpec =>
      toCanonicalGradient({
        // 기본 방향 위→아래, 끝 스톱은 같은 색 알파 0 — 색→투명 페이드 시드
        angle: 180,
        stops: [
          { color, pos: 0 },
          { color: zeroAlpha(color), pos: 1 },
        ],
      }),
    [],
  );

  const handleFormatChange = (next: ColorFormat) => {
    if (next === format) return;
    setDraft(null);
    if (next === 'gradient') {
      // 저장값 → 기억된 spec → 단색 시드 순 — 왕복 시 편집 상태를 그대로 복원
      // (기억 spec은 무변형: 단색 편집이 그라데이션 기억을 조용히 바꾸지 않는다)
      const remembered = contextKey
        ? lastGradientSpecsRef.current.get(contextKey)
        : undefined;
      const spec = storedSpec ?? remembered ?? seedSpecFromSolid(baseColor);
      setSelectedStop(0);
      onCommit({ mode: 'gradient', spec });
    } else {
      if (contextKey && workingSpec) {
        lastGradientSpecsRef.current.set(contextKey, workingSpec);
      }
      // 단색 전환 — 대표색(첫 스톱)을 base로 승계, gradient 제거를 한 patch로
      const solid = workingSpec?.stops[0]?.color ?? baseColor;
      onCommit({ mode: 'solid', color: solid });
    }
  };

  const applySpec = (spec: GradientSpec, commit: boolean) => {
    if (commit) {
      // 커밋은 저장값 갱신으로 같은 렌더 패스에 반영 — 초안은 제거
      setDraft(null);
      onCommit({ mode: 'gradient', spec });
    } else {
      // 취소 복원 등으로 저장값과 같아진 preview는 draft를 남기지 않는다
      if (storedSpec && JSON.stringify(spec) === JSON.stringify(storedSpec)) {
        setDraft(null);
      } else {
        setDraft({ key: contextKey, spec });
      }
      onPreview?.({ mode: 'gradient', spec });
    }
  };

  // 온캔버스 편집 세션 발행 — 그라데이션 형식으로 편집 중일 때만.
  // 수립/해제는 대상·표면 수명 단위로만 하고, 프리뷰 프레임의 spec·선택
  // 변화는 patch로 흘려 스토어 알림을 프레임당 1회로 유지한다
  const applySpecRef = useRef(applySpec);
  // eslint-disable-next-line react-hooks/refs
  applySpecRef.current = applySpec;
  const onCancelRef = useRef(onCancel);
  // eslint-disable-next-line react-hooks/refs
  onCancelRef.current = onCancel;
  const canvasAnchorRef = useRef(canvasAnchor);
  // eslint-disable-next-line react-hooks/refs
  canvasAnchorRef.current = canvasAnchor;
  const workingSpecRef = useRef(workingSpec);
  // eslint-disable-next-line react-hooks/refs
  workingSpecRef.current = workingSpec;
  const selectedStopRef = useRef(selectedStop);
  // eslint-disable-next-line react-hooks/refs
  selectedStopRef.current = selectedStop;

  const anchorKey = canvasAnchor
    ? canvasAnchor.kind === 'batch'
      ? 'batch'
      : `${canvasAnchor.kind}:${canvasAnchor.id}`
    : null;
  // 단일 세션은 안정 ID를 항상 소유권 키에 포함해 재정렬 뒤에도 대상을 유지
  const sessionKeyValue =
    canvasAnchor?.kind === 'batch'
      ? contextKey ?? 'batch'
      : anchorKey
      ? `${anchorKey}:${contextKey ?? ''}`
      : contextKey ?? '';
  const hasSession = Boolean(canvasAnchor && workingSpec);

  useEffect(() => {
    const anchor = canvasAnchorRef.current;
    const spec = workingSpecRef.current;
    if (!hasSession || !anchor || !spec) {
      return undefined;
    }
    useGradientEditStore.getState().setSession({
      anchor,
      sessionKey: sessionKeyValue,
      surface: canvasSurface,
      stateMode: canvasState,
      spec,
      selectedIndex: selectedStopRef.current,
      selectStop: setSelectedStop,
      apply: (spec: GradientSpec, commit: boolean) =>
        applySpecRef.current(spec, commit),
      cancel: () => {
        setDraft(null);
        onCancelRef.current?.();
      },
    });
    return () => {
      // 피커가 닫혀 앵커가 사라진 경우 세션 소유권과 무관하게 로컬 초안 폐기
      if (!canvasAnchorRef.current) {
        setDraft(null);
      }
      // 여전히 내 세션일 때만 해제 (다른 피커가 이미 교체했으면 유지)
      const store = useGradientEditStore.getState();
      if (store.session?.sessionKey === sessionKeyValue) {
        store.setSession(null);
      }
    };
  }, [
    hasSession,
    anchorKey,
    sessionKeyValue,
    canvasSurface,
    canvasState,
    setSelectedStop,
  ]);

  useEffect(() => {
    if (!hasSession || !workingSpec) return;
    useGradientEditStore.getState().patchSession(sessionKeyValue, {
      spec: workingSpec,
      selectedIndex: selectedStop,
    });
  }, [hasSession, sessionKeyValue, workingSpec, selectedStop]);

  // 피커 색 엔진 바인딩 — 현재 편집 대상 색
  const pickerColor =
    format === 'gradient'
      ? workingSpec?.stops[selectedStop]?.color ?? baseColor
      : baseColor;

  const handlePickerColorChange = (color: string, commit: boolean) => {
    if (format === 'solid') {
      if (commit) onCommit({ mode: 'solid', color });
      else onPreview?.({ mode: 'solid', color });
      return;
    }
    const spec = workingSpec ?? seedSpecFromSolid(baseColor);
    const stops = spec.stops.map((s, i) =>
      i === selectedStop ? { ...s, color } : s,
    );
    applySpec({ ...spec, stops }, commit);
  };

  // 헤더 = 그라데이션일 때 스톱 바, 푸터 = 형식 셀렉트 바 (팔레트 아래)
  const headerSlot =
    format === 'gradient' && workingSpec ? (
      <GradientStopEditor
        spec={workingSpec}
        selectedIndex={selectedStop}
        onSelectStop={setSelectedStop}
        onSpecChange={(spec) => applySpec(spec, false)}
        onSpecChangeComplete={(spec) => applySpec(spec, true)}
      />
    ) : null;

  const footerSlot = (
    <FormatSelectBar format={format} onFormatChange={handleFormatChange} />
  );

  // 팔레트 연동 — 편집 중 spec은 닫힐 때 저장, 항목 클릭은 spec 전체 적용
  const paletteGradientSpec = format === 'gradient' ? workingSpec : null;
  const handleGradientSpecSelect = (spec: GradientSpec) => {
    setSelectedStop(0);
    applySpec(spec, true);
  };

  const cancelPreview = () => {
    setDraft(null);
  };

  return {
    format,
    headerSlot,
    footerSlot,
    pickerColor,
    handlePickerColorChange,
    paletteGradientSpec,
    handleGradientSpecSelect,
    cancelPreview,
  };
}
