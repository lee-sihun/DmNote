import React from 'react';
import ColorPicker from '@components/main/Modal/content/pickers/color/ColorPicker';
import PopupExit from '@components/main/Modal/PopupExit';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import type {
  EditorCounterFillPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
} from '@src/types/editor';
import {
  normalizeCounterSettings,
  type KeyCounterSettings,
  type KeyPosition,
  type NoteColor,
} from '@src/types/key/keys';
import {
  hexWithAlphaPercent,
  parseAlphaPercent,
  toRgbHexColor,
} from '@utils/color/colorUtils';
import type {
  BatchLocalColors,
  BatchPickerTarget,
  MixedValueGetter,
} from '../batchPanelShared';
import type {
  BatchNoteSurface,
  useBatchNotePaint,
} from '../note/useBatchNotePaint';

type BatchNotePaintController = ReturnType<typeof useBatchNotePaint>;

interface BatchColorPickerPopupProps {
  batchPickerFor: BatchPickerTarget;
  setBatchPickerFor: (value: BatchPickerTarget) => void;
  openNoteSurface: BatchNoteSurface | null;
  batchNotePaint: BatchNotePaintController;
  batchCounterSettings: KeyCounterSettings;
  batchCounterColorState: 'idle' | 'active';
  setBatchCounterColorState: (value: 'idle' | 'active') => void;
  setBatchLocalColors: React.Dispatch<React.SetStateAction<BatchLocalColors>>;
  handleBatchPickerColorChange: (newColor: NoteColor) => void;
  handleBatchPickerColorChangeComplete: (newColor: NoteColor) => void;
  handleBatchFillPickerColorChangeComplete: (
    newColor: string,
    onCounterFillCommit: (patch: EditorCounterFillPropertyPatchV1) => void,
  ) => void;
  getBatchPickerColor: () => NoteColor | string;
  getBatchPickerRef: () => React.RefObject<HTMLButtonElement | null> | null;
  batchColorPickerInteractiveRefs: React.RefObject<HTMLButtonElement | null>[];
  panelElement: HTMLDivElement | null;
  selectedKeyCount: number;
  counterFillTargetCount: number;
  commitCounterFill?: (patch: EditorCounterFillPropertyPatchV1) => void;
  previewNotePaint?: (patch: EditorNotePaintPropertyPatchV1) => void;
  commitNotePaint?: (patch: EditorNotePaintPropertyPatchV1) => void;
  noteMixedValueGetter: MixedValueGetter<KeyPosition>;
  getMixedValue: MixedValueGetter<KeyPosition>;
  getMixedValueActiveCapable: MixedValueGetter<KeyPosition>;
  getMixedValueCanonical: MixedValueGetter<KeyPosition>;
  t: (key: string) => string | undefined;
}

const BatchColorPickerPopup = ({
  batchPickerFor,
  setBatchPickerFor,
  openNoteSurface,
  batchNotePaint,
  batchCounterSettings,
  batchCounterColorState,
  setBatchCounterColorState,
  setBatchLocalColors,
  handleBatchPickerColorChange,
  handleBatchPickerColorChangeComplete,
  handleBatchFillPickerColorChangeComplete,
  getBatchPickerColor,
  getBatchPickerRef,
  batchColorPickerInteractiveRefs,
  panelElement,
  selectedKeyCount,
  counterFillTargetCount,
  commitCounterFill,
  previewNotePaint,
  commitNotePaint,
  noteMixedValueGetter,
  getMixedValue,
  getMixedValueActiveCapable,
  getMixedValueCanonical,
  t,
}: BatchColorPickerPopupProps) => {
  const noteOpacityMixed = noteMixedValueGetter(
    (pos) => pos.noteOpacity,
    80,
  ).isMixed;
  const glowOpacityMixed = noteMixedValueGetter(
    (pos) => pos.noteGlowOpacity,
    70,
  ).isMixed;

  // 열린 피커의 hex 칸과 % 칸의 독립 Mixed 판정
  const batchPickerMixed = ((): { hex: boolean; alpha: boolean } => {
    const paintHex = (value: NoteColor | undefined) =>
      typeof value === 'string' ? toRgbHexColor(value) : value;
    if (
      openNoteSurface &&
      batchNotePaint.states[openNoteSurface].format === 'gradient'
    ) {
      return { hex: false, alpha: false };
    }
    switch (batchPickerFor) {
      case 'noteColor':
        return {
          hex: noteMixedValueGetter((pos) => paintHex(pos.noteColor), '#FFFFFF')
            .isMixed,
          alpha: noteOpacityMixed,
        };
      case 'glowColor':
        return {
          hex: noteMixedValueGetter(
            (pos) => paintHex(pos.noteGlowColor ?? pos.noteColor),
            '#FFFFFF',
          ).isMixed,
          alpha: glowOpacityMixed,
        };
      case 'borderColor':
        return {
          hex: noteMixedValueGetter(
            (pos) => toRgbHexColor(pos.noteBorderColor),
            '',
          ).isMixed,
          alpha: noteMixedValueGetter((pos) => pos.noteBorderOpacity, 100)
            .isMixed,
        };
      case 'fill': {
        // 입력 상태 색은 통계를 편집하지 않으므로 Mixed도 같은 집합으로
        const state = batchCounterColorState === 'active' ? 'active' : 'idle';
        const mixedFn =
          state === 'active' ? getMixedValueActiveCapable : getMixedValue;
        const colorOf = (pos: KeyPosition) =>
          normalizeCounterSettings(pos.counter).fill[state];
        return {
          hex: mixedFn((pos) => toRgbHexColor(colorOf(pos)), '').isMixed,
          alpha: mixedFn((pos) => parseAlphaPercent(colorOf(pos)), 100).isMixed,
        };
      }
      default:
        return { hex: false, alpha: false };
    }
  })();

  return (
    <PopupExit open={Boolean(batchPickerFor)}>
      {batchPickerFor ? (
        <ColorPicker
          open={!!batchPickerFor}
          referenceRef={getBatchPickerRef()}
          panelElement={panelElement}
          color={
            openNoteSurface
              ? openNoteSurface === 'border' &&
                batchNotePaint.states.border.format !== 'gradient'
                ? hexWithAlphaPercent(
                    batchNotePaint.borderSolid,
                    batchNotePaint.borderOpacity,
                  )
                : batchNotePaint.activeState.pickerColor
              : getBatchPickerColor()
          }
          onColorChange={(color) => {
            if (openNoteSurface) {
              if (typeof color !== 'string') return;
              if (
                openNoteSurface === 'border' &&
                batchNotePaint.states.border.format !== 'gradient'
              ) {
                batchNotePaint.previewBorderSolid(color);
                return;
              }
              batchNotePaint.activeState.handlePickerColorChange(color, false);
              return;
            }
            handleBatchPickerColorChange(color);
          }}
          onColorChangeComplete={(color) => {
            if (openNoteSurface) {
              if (typeof color !== 'string') return;
              if (
                openNoteSurface === 'border' &&
                batchNotePaint.states.border.format !== 'gradient'
              ) {
                batchNotePaint.commitBorderSolid(color);
                return;
              }
              batchNotePaint.activeState.handlePickerColorChange(color, true);
              return;
            }
            if (
              commitCounterFill &&
              batchPickerFor === 'fill' &&
              typeof color === 'string'
            ) {
              handleBatchFillPickerColorChangeComplete(
                color,
                commitCounterFill,
              );
              return;
            }
            if (batchPickerFor === 'fill' && counterFillTargetCount === 0) {
              return;
            }
            handleBatchPickerColorChangeComplete(color);
          }}
          onClose={() => setBatchPickerFor(null)}
          interactiveRefs={batchColorPickerInteractiveRefs}
          solidOnly={true}
          stateMode={
            batchPickerFor === 'fill' && selectedKeyCount > 0
              ? batchCounterColorState
              : undefined
          }
          onStateModeChange={
            batchPickerFor === 'fill' && selectedKeyCount > 0
              ? setBatchCounterColorState
              : undefined
          }
          onInputCancel={(_target, restoredColor) => {
            if (openNoteSurface) {
              if (typeof restoredColor !== 'string') return;
              const state = batchNotePaint.states[openNoteSurface];
              if (openNoteSurface === 'border' && state.format !== 'gradient') {
                batchNotePaint.previewBorderSolid(restoredColor);
              } else {
                state.handlePickerColorChange(restoredColor, false);
              }
              editGestureController.cancel();
              return;
            }
            if (batchPickerFor === 'fill') {
              const state =
                batchCounterColorState === 'active' ? 'active' : 'idle';
              setBatchLocalColors((prev) => ({
                ...prev,
                [state === 'active' ? 'fillActive' : 'fillIdle']:
                  batchCounterSettings.fill[state],
              }));
            }
          }}
          hexMixed={batchPickerMixed.hex}
          opacityPercentMixed={batchPickerMixed.alpha}
          headerSlot={
            openNoteSurface ? batchNotePaint.activeState.headerSlot : undefined
          }
          footerSlot={
            openNoteSurface ? batchNotePaint.activeState.footerSlot : undefined
          }
          gradientSpec={
            openNoteSurface
              ? batchNotePaint.activeState.paletteGradientSpec
              : undefined
          }
          onGradientSpecSelect={
            openNoteSurface
              ? batchNotePaint.activeState.handleGradientSpecSelect
              : undefined
          }
          {...((openNoteSurface === 'note' || openNoteSurface === 'glow') &&
          batchNotePaint.states[openNoteSurface].format !== 'gradient'
            ? {
                // 단색 형식의 색 알파는 저장 시 hex 변환으로 버려지므로 항상 숨김
                hideColorAlpha: true,
              }
            : {})}
          {...((openNoteSurface === 'note' || openNoteSurface === 'glow') &&
          batchNotePaint.states[openNoteSurface].format !== 'gradient' &&
          !batchNotePaint.anyPresented[openNoteSurface]
            ? {
                // 전부 단색인 선택의 외부 투명도 조절기
                opacityPercent:
                  openNoteSurface === 'note'
                    ? batchNotePaint.noteOpacity
                    : batchNotePaint.glowOpacity,
                onOpacityPercentChange: (value: number) => {
                  if (openNoteSurface === 'note') {
                    batchNotePaint.setNoteOpacity(value);
                    previewNotePaint?.({
                      property: 'notePaint',
                      value: { opacity: value },
                    });
                    return;
                  }
                  batchNotePaint.setGlowOpacity(value);
                  previewNotePaint?.({
                    property: 'noteGlowPaint',
                    value: { opacity: value },
                  });
                },
                onOpacityPercentChangeComplete: (value: number) => {
                  const surface = openNoteSurface;
                  if (surface === 'note') {
                    batchNotePaint.setNoteOpacity(value);
                  } else {
                    batchNotePaint.setGlowOpacity(value);
                  }
                  // 단색 형식의 {opacity} 단독 커밋
                  commitNotePaint?.({
                    property:
                      surface === 'note' ? 'notePaint' : 'noteGlowPaint',
                    value: { opacity: value },
                  });
                },
                onOpacityPercentCancel: () => {
                  // Escape 게스처 취소와 canonical 대표값 복원
                  editGestureController.cancel();
                  if (openNoteSurface === 'note') {
                    batchNotePaint.setNoteOpacity(
                      getMixedValueCanonical((pos) => pos.noteOpacity, 80)
                        .value,
                    );
                    return;
                  }
                  batchNotePaint.setGlowOpacity(
                    getMixedValueCanonical((pos) => pos.noteGlowOpacity, 70)
                      .value,
                  );
                },
                opacityPercentLabel:
                  openNoteSurface === 'note'
                    ? t('keySetting.noteOpacity') || '노트 투명도'
                    : t('keySetting.noteGlowOpacity') || '글로우 투명도',
              }
            : {})}
        />
      ) : null}
    </PopupExit>
  );
};

export default BatchColorPickerPopup;
