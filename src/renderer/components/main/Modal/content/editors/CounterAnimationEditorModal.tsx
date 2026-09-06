import { useRef, useState } from 'react';
import type {
  CounterAnimationBezier,
  KeyCounterSettings,
} from '@src/types/key/keys';
import type { CounterAnimationPreset } from '@src/types/key/counterAnimation';
import FullSurfaceModalLayout from '@components/main/Modal/FullSurfaceModalLayout';
import Dropdown from '@components/main/common/dropdown/Dropdown';
import {
  TextInput,
  NumberInput,
} from '@components/main/Grid/PropertiesPanel/controls/PropertyInputs';
import {
  COUNTER_BEZIER_PRESETS,
  clampCounterBezier,
  findBezierPresetId,
} from '@utils/cubicBezier';
import type { CounterAnimationKeyVisual } from '@utils/counter/counterAnimationPreview';
import { type ContinuousInputStrategy } from '@utils/animation/rafLatestScheduler';
import { counterAnimationApi } from '@api/modules/resources/resourceApi';
import {
  clampCounterDuration as clampDuration,
  formatCounterBezierInput as formatBezierInput,
  normalizeCounterScale as normalizeScale,
  parseCounterBezierInput as parseBezierInput,
  parseCounterNumber as parseNumber,
} from './counterAnimationEditorModel';
import CounterAnimationCurveCanvas, {
  COUNTER_ANIMATION_GRID_MINOR_COLOR as GRID_MINOR_COLOR,
} from './CounterAnimationCurveCanvas';
import CounterAnimationPreviewStage from './CounterAnimationPreviewStage';
import { useCounterAnimationCanvasSession } from './useCounterAnimationCanvasSession';

type EditorMode = 'create' | 'edit';

interface CounterAnimationEditorModalProps {
  isOpen: boolean;
  mode: EditorMode;
  initialPreset?: CounterAnimationPreset | null;
  counterSettings?: KeyCounterSettings;
  keyVisual?: CounterAnimationKeyVisual;
  onClose: () => void;
  onSaved: (payload: {
    preset: CounterAnimationPreset;
    mode: EditorMode;
    affectedUsageCount: number;
  }) => void;
  t: (key: string) => string;
  /** 성능 계측용 비교 전략. 제품 경로는 프레임당 최신 입력만 반영한다. */
  continuousInputStrategy?: ContinuousInputStrategy;
}

const CounterAnimationEditorModal = ({
  isOpen,
  mode,
  initialPreset,
  counterSettings,
  keyVisual,
  onClose,
  onSaved,
  t,
  continuousInputStrategy = 'frame',
}: CounterAnimationEditorModalProps) => {
  const [nameInput, setNameInput] = useState('');
  const [scaleInput, setScaleInput] = useState('1.1');
  const [durationInput, setDurationInput] = useState('300');
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [errorText, setErrorText] = useState('');

  const {
    svgRef,
    localBezierRef,
    editorSize,
    localBezier,
    setLocalBezier,
    bezierInput,
    setBezierInput,
    viewOffset,
    viewScale,
    previewCount,
    previewActive,
    cancelAutoFit,
    applyView,
    observeEditorArea,
    handlePreviewPointerDown,
    handlePointPointerDown,
    handleWheel,
    handleSvgPointerDown,
    handleDoubleClick,
  } = useCounterAnimationCanvasSession({
    isOpen,
    mode,
    initialPreset,
    continuousInputStrategy,
    setNameInput,
    setScaleInput,
    setDurationInput,
    setErrorText,
  });
  const selectedPreset = findBezierPresetId(localBezier);

  const customLabel = t('counterSetting.presetCustom') || 'Custom';

  const presetOptions = (() => {
    const base = COUNTER_BEZIER_PRESETS.map((preset) => ({
      value: preset.id,
      label: preset.fallbackLabel,
    }));
    if (selectedPreset === 'custom') {
      return [{ value: 'custom', label: customLabel }, ...base];
    }
    return base;
  })();

  const handlePresetChange = (value: string) => {
    if (value === 'custom') return;
    const preset = COUNTER_BEZIER_PRESETS.find((item) => item.id === value);
    if (!preset) return;
    const nextBezier = clampCounterBezier(preset.bezier);
    localBezierRef.current = nextBezier;
    setLocalBezier(nextBezier);
    setBezierInput(formatBezierInput(nextBezier));

    cancelAutoFit();
    applyView({ x: 0, y: 0 }, 1);
  };

  const parsedScale = (() => {
    const parsed = parseNumber(scaleInput);
    const normalized = normalizeScale(parsed ?? 1.1);
    return Math.round(normalized * 100) / 100;
  })();

  const parsedDuration = (() => {
    const parsed = parseNumber(durationInput);
    return clampDuration(parsed ?? 300);
  })();

  const canSave = !isSaving && nameInput.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;

    const normalizedBezier: CounterAnimationBezier = [
      localBezierRef.current[0],
      localBezierRef.current[1],
      localBezierRef.current[2],
      localBezierRef.current[3],
    ];

    const requestBase = {
      name: nameInput.trim(),
      bezier: normalizedBezier,
      scale: parsedScale,
      durationMs: parsedDuration,
    };

    setErrorText('');
    setIsSaving(true);
    try {
      const response =
        mode === 'edit' && initialPreset
          ? await counterAnimationApi.update({
              id: initialPreset.id,
              ...requestBase,
            })
          : await counterAnimationApi.create(requestBase);

      if (!response) throw new Error('counter animation update failed');

      onSaved({
        preset: response.preset,
        mode,
        affectedUsageCount: response.affectedUsageCount,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save counter animation preset', error);
      setErrorText(
        t('counterSetting.saveAnimationFailed') || '모션 저장에 실패했습니다.',
      );
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const headerTitle =
    mode === 'edit'
      ? t('counterSetting.editAnimationTitle') || '모션 편집'
      : t('counterSetting.createAnimationTitle') || '모션 추가';

  return (
    <FullSurfaceModalLayout
      onClose={onClose}
      title={headerTitle}
      headerInfo={
        <div className="min-w-0 flex items-center gap-[6px] text-fg-faint">
          <svg
            className="w-[14px] h-[14px] shrink-0"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          <span className="text-caption truncate">
            {t('counterSetting.motionPerformanceNotice') ||
              '모션 효과는 시스템 리소스를 추가로 사용합니다'}
          </span>
        </div>
      }
      submitLabel={
        isSaving
          ? t('counterSetting.saving') || '저장 중...'
          : t('common.save') || '저장'
      }
      submitDisabled={!canSave}
      onSubmit={() => {
        void handleSave();
      }}
      cancelLabel={t('common.cancel') || '취소'}
    >
      {/* 본문 — 상단: 캔버스 히어로 + 미리보기 무대, 하단: 파라미터 데크 */}
      <div className="flex-1 min-h-0 flex flex-col gap-[12px]">
        <div className="flex-1 min-h-0 flex gap-[12px]">
          {/* 커브 캔버스 — 카드 내부를 통째로 채우는 풀블리드 캔버스 */}
          <CounterAnimationCurveCanvas
            editorAreaRef={observeEditorArea}
            svgRef={svgRef}
            bezier={localBezier}
            editorSize={editorSize}
            viewOffset={viewOffset}
            viewScale={viewScale}
            onWheel={handleWheel}
            onPointerDown={handleSvgPointerDown}
            onDoubleClick={handleDoubleClick}
            onHandlePointerDown={handlePointPointerDown}
          />

          <CounterAnimationPreviewStage
            counterSettings={counterSettings}
            keyVisual={keyVisual}
            animationBezier={localBezier}
            animationScale={parsedScale}
            animationDurationMs={parsedDuration}
            count={previewCount}
            active={previewActive}
            gridMinorColor={GRID_MINOR_COLOR}
            onPointerDown={handlePreviewPointerDown}
            t={t}
          />
        </div>

        {/* 파라미터 데크 — 하단 풀폭 항상 한 줄, 이름 입력이 남는 폭 흡수 */}
        <div className="shrink-0 bg-fill-faint rounded-surface px-[10px] py-[4px] flex flex-nowrap items-center gap-x-[10px] overflow-hidden">
          {/* 이름 필드 — 짧은 라벨 + 예시형 플레이스홀더, 입력이 남는 폭을 정확히 채워
                  옆 필드와 갭이 동일하게 유지됨 (라벨 길이가 긴 로케일도 flex로 자동 흡수) */}
          <div className="flex items-center gap-[8px] min-h-[32px] flex-1 min-w-0">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.nameLabel') || '이름'}
            </p>
            <input
              type="text"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder={
                t('counterSetting.animationNamePlaceholder') || '예: 내 모션'
              }
              className="flex-1 min-w-0 h-[23px] px-[8px] bg-inset rounded-md text-body text-fg placeholder-fg-faint outline-none focus:shadow-focus-ring transition-shadow duration-fast"
            />
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px]">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.presetLabel') || '프리셋'}
            </p>
            <Dropdown
              commitStrategy="after-paint"
              options={presetOptions}
              value={selectedPreset}
              onChange={(val) => handlePresetChange(String(val))}
              widthClass="w-[130px]"
            />
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px]">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.bezierLabel') || '베지어'}
            </p>
            <TextInput
              value={bezierInput}
              onChange={(raw) => {
                setBezierInput(raw);
                const parsed = parseBezierInput(raw);
                if (!parsed) return;
                localBezierRef.current = parsed;
                setLocalBezier(parsed);
              }}
              onBlur={() => {
                const parsed = parseBezierInput(bezierInput);
                if (!parsed) {
                  setBezierInput(formatBezierInput(localBezierRef.current));
                  return;
                }
                localBezierRef.current = parsed;
                setLocalBezier(parsed);
                setBezierInput(formatBezierInput(parsed));
              }}
              placeholder="0.25, 0.46, 0.45, 0.94"
              width="140px"
            />
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px]">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.scale') || '스케일'}
            </p>
            <NumberInput
              value={parsedScale}
              onChange={(val) => setScaleInput(String(val))}
              onBlur={(committed) => {
                // 확정값을 입력에서 직접 받는다. onChange가 예약한 scaleInput은
                // 같은 blur 이벤트 안에서 아직 이전 값이다
                const parsed = committed ?? parseNumber(scaleInput);
                const normalized = normalizeScale(parsed ?? 1.1);
                setScaleInput(String(Math.round(normalized * 100) / 100));
              }}
              allowDecimal={true}
              decimalScale={2}
              min={0}
              max={9999}
              width="54px"
            />
          </div>

          <div className="flex items-center gap-[8px] min-h-[32px]">
            <p className="text-fg-muted text-label shrink-0">
              {t('counterSetting.duration') || '지속 시간'}
            </p>
            <NumberInput
              value={parsedDuration}
              onChange={(val) => setDurationInput(String(val))}
              onBlur={(committed) => {
                // 확정값을 입력에서 직접 받는다. onChange가 예약한 durationInput은
                // 같은 blur 이벤트 안에서 아직 이전 값이다
                const parsed = committed ?? parseNumber(durationInput);
                const normalized = clampDuration(parsed ?? 300);
                setDurationInput(String(normalized));
              }}
              width="54px"
              min={100}
              max={5000}
            />
          </div>
        </div>

        {errorText ? (
          <p className="shrink-0 text-caption leading-[14px] text-danger-fg">
            {errorText}
          </p>
        ) : null}
      </div>
    </FullSurfaceModalLayout>
  );
};

export default CounterAnimationEditorModal;
