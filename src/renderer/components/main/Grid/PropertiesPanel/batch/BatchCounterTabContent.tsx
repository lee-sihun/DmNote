import React from 'react';
import { createPortal } from 'react-dom';
import type { KeyCounterSettings } from '@src/types/key/keys';
import { createCounterAnimationPresetIntent } from '@src/types/key/counterAnimation';
import { patchCounterAnimationPresetByTargets } from '@src/renderer/editor/runtime/elementOps';
import { patchCounterAnimationPresetViaAuthority } from '@plugins/rpc/pluginElementActions';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import {
  LEGACY_BATCH_ELEMENT_BINDING,
  type BatchElementBinding,
} from '@hooks/pickers/useBatchElementBinding';
import {
  PropertyRow,
  NumberInput,
  FontStyleToggle,
  PropertySection,
} from '../index';
import Checkbox from '@components/main/common/Checkbox';
import Dropdown from '@components/main/common/Dropdown';
import FontPicker from '@components/main/Modal/content/pickers/FontPicker';
import CounterAnimationPicker from '@components/main/Modal/content/pickers/CounterAnimationPicker';
import type { CounterAnimationKeyVisual } from '@utils/core/counterAnimationPreview';
import { usePanelNav } from '../PanelNavContext';
import { ColorSwatchButton } from '@components/main/Modal/content/pickers/ColorSwatch';
import { DEFAULT_COUNTER_FONT_SIZE } from '@utils/core/elementDefaults';

// 인-패널 서브 페이지 키 — 트리거 사이트별 유니크
const FONT_PAGE_KEY = 'batch-counter:font';
// 결합 캡처 소유자(리마운트 경계 밖)가 open 판정에 쓰도록 export
export const BATCH_COUNTER_ANIMATION_PAGE_KEY = 'batch-counter:animation';
const ANIMATION_PAGE_KEY = BATCH_COUNTER_ANIMATION_PAGE_KEY;

interface BatchCounterTabContentProps {
  // 카운터 설정 (첫 번째 선택 키 기준)
  batchCounterSettings: KeyCounterSettings;
  // 첫 번째 선택 키의 시각 정보 (프리뷰용)
  keyVisual?: CounterAnimationKeyVisual;
  // 핸들러
  handleBatchCounterUpdate: (updates: Partial<KeyCounterSettings>) => void;
  onCounterEnabledCommit?: (enabled: boolean) => void;
  onCounterAnimationEnabledCommit?: (enabled: boolean) => void;
  // 컬러 디스플레이 (현재 상태 기준)
  colorState: 'idle' | 'active';
  getCounterColorDisplay: (target: 'fill' | 'stroke') => string;
  // 컬러 피커 토글
  onFillPickerToggle: () => void;
  onStrokePickerToggle: () => void;
  // ref 목록
  batchCounterFillButtonRef: React.RefObject<HTMLButtonElement>;
  batchCounterStrokeButtonRef: React.RefObject<HTMLButtonElement>;
  isFillPickerOpen: boolean;
  isStrokePickerOpen: boolean;
  // 모션 완료의 시작 시점 결합. 소유자는 EditSessionBoundary 밖 부모다 -
  // 이 컴포넌트는 선택 변경 시 리마운트되어 open 중 재캡처가 일어난다
  animationBinding?: BatchElementBinding;
  // 패널 요소 (FloatingPopup 위치용)
  // 번역
  t: (key: string) => string;
}

const BatchCounterTabContent: React.FC<BatchCounterTabContentProps> = ({
  batchCounterSettings,
  keyVisual,
  handleBatchCounterUpdate,
  onCounterEnabledCommit,
  onCounterAnimationEnabledCommit,
  colorState,
  getCounterColorDisplay,
  onFillPickerToggle,
  onStrokePickerToggle,
  batchCounterFillButtonRef,
  batchCounterStrokeButtonRef,
  isFillPickerOpen,
  isStrokePickerOpen,
  animationBinding = LEGACY_BATCH_ELEMENT_BINDING,
  t,
}) => {
  // 인-패널 내비게이션 (폰트/애니메이션 서브 페이지)
  const { activePageKey, renderPageKey, openPage, closePage, pageHost } =
    usePanelNav();

  // 모션 편집기를 기다린 비동기 완료. ID 결합이면 시작 시점 선택 요소들에
  // 적용하되, 피커가 소유한 preset 필드만 쓰고 각 요소의 fresh enabled는
  // 보존한다 (첫 요소 기준 델타는 혼합 상태를 오판하므로 intent mask 방식)
  const handleAnimationUpdate = (
    nextAnimation: KeyCounterSettings['animation'],
  ) => {
    if (animationBinding.binding === 'element-id') {
      const targets = (['key', 'stat'] as const).flatMap((elementType) =>
        (animationBinding.selection[elementType] ?? []).map((id) => ({
          elementType,
          id,
        })),
      );
      if (targets.length === 0) return;
      const intent = createCounterAnimationPresetIntent(
        batchCounterSettings.animation,
        nextAnimation,
        'batch',
      );
      const persisted =
        window.__dmn_window_type === 'panel'
          ? patchCounterAnimationPresetViaAuthority(targets, intent)
          : patchCounterAnimationPresetByTargets(targets, intent);
      void persisted.catch(reportElementOpError);
      return;
    }
    handleBatchCounterUpdate({ animation: nextAnimation });
  };

  const getDisplayColor = (color: string): string => {
    if (!color) return '#ffffff';
    if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
    if (color.startsWith('#')) return color;
    return '#ffffff';
  };

  return (
    <>
      <PropertySection>
        {/* 카운터 사용 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('counterSetting.counterEnabled') || '카운터 표시'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={batchCounterSettings.enabled}
            onChange={() => {
              const enabled = !batchCounterSettings.enabled;
              if (onCounterEnabledCommit) {
                onCounterEnabledCommit(enabled);
                return;
              }
              handleBatchCounterUpdate({ enabled });
            }}
          />
        </div>
      </PropertySection>

      <PropertySection>
        {/* 배치 영역 */}
        <PropertyRow label={t('counterSetting.placementArea') || '배치 영역'}>
          <Dropdown
            commitStrategy="after-paint"
            options={[
              {
                label: t('counterSetting.placementInside') || '내부',
                value: 'inside',
              },
              {
                label: t('counterSetting.placementOutside') || '외부',
                value: 'outside',
              },
            ]}
            value={batchCounterSettings.placement}
            onChange={(value) =>
              handleBatchCounterUpdate({
                placement: value as 'inside' | 'outside',
              })
            }
          />
        </PropertyRow>

        {/* 정렬 방향 */}
        <PropertyRow label={t('counterSetting.alignDirection') || '정렬 방향'}>
          <Dropdown
            commitStrategy="after-paint"
            options={[
              { label: t('counterSetting.alignTop') || '상단', value: 'top' },
              {
                label: t('counterSetting.alignBottom') || '하단',
                value: 'bottom',
              },
              { label: t('counterSetting.alignLeft') || '좌측', value: 'left' },
              {
                label: t('counterSetting.alignRight') || '우측',
                value: 'right',
              },
            ]}
            value={batchCounterSettings.align}
            onChange={(value) =>
              handleBatchCounterUpdate({
                align: value as 'top' | 'bottom' | 'left' | 'right',
              })
            }
          />
        </PropertyRow>

        {/* 정렬 방식 (내부 배치 전용) */}
        {batchCounterSettings.placement === 'inside' && (
          <PropertyRow label={t('counterSetting.alignMode') || '정렬 방식'}>
            <Dropdown
              commitStrategy="after-paint"
              options={[
                {
                  label: t('counterSetting.alignModeCenter') || '가운데',
                  value: 'center',
                },
                {
                  label: t('counterSetting.alignModeBetween') || '양끝',
                  value: 'between',
                },
              ]}
              value={batchCounterSettings.alignMode ?? 'center'}
              onChange={(value) =>
                handleBatchCounterUpdate({
                  alignMode: value as 'center' | 'between',
                })
              }
            />
          </PropertyRow>
        )}

        {/* 간격 */}
        <PropertyRow label={t('counterSetting.gap') || '간격'}>
          <NumberInput
            value={batchCounterSettings.gap}
            onChange={(value) => handleBatchCounterUpdate({ gap: value })}
            suffix="px"
            min={0}
            max={9999}
            width="54px"
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 채우기 색상 */}
        <PropertyRow label={t('counterSetting.fill') || '채우기'}>
          <ColorSwatchButton
            ref={batchCounterFillButtonRef}
            type="button"
            onClick={onFillPickerToggle}
            open={isFillPickerOpen}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(getCounterColorDisplay('fill'))}
            title={`${t('counterSetting.fill') || '채우기'} (${
              colorState === 'active'
                ? t('counterSetting.active') || '입력'
                : t('counterSetting.idle') || '대기'
            })`}
          />
        </PropertyRow>

        {/* 외곽선 색상 */}
        <PropertyRow label={t('counterSetting.stroke') || '외곽선'}>
          <ColorSwatchButton
            ref={batchCounterStrokeButtonRef}
            type="button"
            onClick={onStrokePickerToggle}
            open={isStrokePickerOpen}
            className="w-[23px] h-[23px] rounded-md cursor-pointer transition-shadow flex-shrink-0"
            surfaceClassName="rounded-md"
            color={getDisplayColor(getCounterColorDisplay('stroke'))}
            title={`${t('counterSetting.stroke') || '외곽선'} (${
              colorState === 'active'
                ? t('counterSetting.active') || '입력'
                : t('counterSetting.idle') || '대기'
            })`}
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 폰트 */}
        <PropertyRow label={t('counterSetting.font') || '폰트'}>
          <button
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              activePageKey === FONT_PAGE_KEY ? 'shadow-focus-ring' : ''
            } text-fg text-body`}
            onClick={() => {
              if (activePageKey === FONT_PAGE_KEY) closePage();
              else openPage(FONT_PAGE_KEY);
            }}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
        </PropertyRow>

        {/* 폰트 크기 */}
        <PropertyRow label={t('counterSetting.fontSize') || '폰트 크기'}>
          <NumberInput
            value={batchCounterSettings.fontSize ?? DEFAULT_COUNTER_FONT_SIZE}
            onChange={(value) => handleBatchCounterUpdate({ fontSize: value })}
            suffix="px"
            min={8}
            max={72}
            width="54px"
          />
        </PropertyRow>

        {/* 폰트 스타일 */}
        <PropertyRow label={t('counterSetting.fontStyle') || '폰트 스타일'}>
          <FontStyleToggle
            isBold={(batchCounterSettings.fontWeight ?? 400) >= 700}
            isItalic={batchCounterSettings.fontItalic ?? false}
            isUnderline={batchCounterSettings.fontUnderline ?? false}
            isStrikethrough={batchCounterSettings.fontStrikethrough ?? false}
            onBoldChange={(value) =>
              handleBatchCounterUpdate({ fontWeight: value ? 700 : 400 })
            }
            onItalicChange={(value) =>
              handleBatchCounterUpdate({ fontItalic: value })
            }
            onUnderlineChange={(value) =>
              handleBatchCounterUpdate({ fontUnderline: value })
            }
            onStrikethroughChange={(value) =>
              handleBatchCounterUpdate({ fontStrikethrough: value })
            }
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection>
        {/* 카운터 애니메이션 */}
        <div className="flex justify-between items-center w-full min-h-[32px]">
          <p className="text-fg-muted text-label">
            {t('counterSetting.animationEnabled') || '카운터 애니메이션'}
          </p>
          <Checkbox
            commitStrategy="after-paint"
            checked={batchCounterSettings.animation.enabled}
            onChange={() => {
              const enabled = !batchCounterSettings.animation.enabled;
              if (onCounterAnimationEnabledCommit) {
                onCounterAnimationEnabledCommit(enabled);
                return;
              }
              handleBatchCounterUpdate({
                animation: { ...batchCounterSettings.animation, enabled },
              });
            }}
          />
        </div>

        <PropertyRow label={t('counterSetting.animation') || '애니메이션 설정'}>
          <button
            type="button"
            className={`px-[8px] h-[23px] bg-fill hover:bg-fill-hover active:bg-fill-active transition-colors duration-fast rounded-md flex items-center justify-center ${
              activePageKey === ANIMATION_PAGE_KEY ? 'shadow-focus-ring' : ''
            } text-fg text-body`}
            onClick={() => {
              if (activePageKey === ANIMATION_PAGE_KEY) closePage();
              else openPage(ANIMATION_PAGE_KEY);
            }}
          >
            {t('propertiesPanel.configure') || '설정하기'}
          </button>
        </PropertyRow>
      </PropertySection>

      {/* FontPicker — 패널 서브 페이지 */}
      {renderPageKey === FONT_PAGE_KEY &&
        pageHost &&
        createPortal(
          <FontPicker
            open
            selectedFont={batchCounterSettings.fontFamily || null}
            onFontSelect={(fontFamily) => {
              handleBatchCounterUpdate({ fontFamily });
            }}
            pageTitle={t('counterSetting.font') || '폰트'}
            onBack={closePage}
          />,
          pageHost,
        )}

      {/* CounterAnimationPicker — 패널 서브 페이지 */}
      {renderPageKey === ANIMATION_PAGE_KEY &&
        pageHost &&
        createPortal(
          <CounterAnimationPicker
            open
            completionBinding={animationBinding.binding}
            animation={batchCounterSettings.animation}
            counterSettings={batchCounterSettings}
            keyVisual={keyVisual}
            onAnimationChange={handleAnimationUpdate}
            t={t}
            pageTitle={t('counterSetting.animation') || '애니메이션'}
            onBack={closePage}
          />,
          pageHost,
        )}
    </>
  );
};

export default BatchCounterTabContent;
