import { useState, useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isGradientColor, normalizeColorInput } from '@utils/color/colorUtils';
import { slotMembers, slotUiMode, buildSlot } from '@utils/keySlot';
import type { KeySlotUiMode } from '@utils/keySlot';
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from '@src/types/key/keys';
import type {
  NoteColor,
  KeyCounterSettings,
  KeySlot,
} from '@src/types/key/keys';
import { toCompactRgba } from '@src/types/color';

// ============================================================================
// 타입 정의
// ============================================================================

export const TABS = {
  KEY: 'key',
  NOTE: 'note',
  COUNTER: 'counter',
} as const;

export type TabType = (typeof TABS)[keyof typeof TABS];

export const COLOR_MODES = {
  solid: 'solid',
  gradient: 'gradient',
} as const;

export type ColorMode = (typeof COLOR_MODES)[keyof typeof COLOR_MODES];

export interface GradientColor {
  type: 'gradient';
  top: string;
  bottom: string;
}

export const toGradient = (top: string, bottom: string): GradientColor => ({
  type: 'gradient',
  top,
  bottom,
});

// 키 데이터 타입
export interface KeyData {
  key: KeySlot;
  activeImage?: string;
  inactiveImage?: string;
  activeTransparent?: boolean;
  idleTransparent?: boolean;
  width?: number;
  height?: number;
  noteColor?: NoteColor;
  noteOpacity?: number;
  noteEffectEnabled?: boolean;
  noteGlowEnabled?: boolean;
  noteGlowSize?: number;
  noteGlowOpacity?: number;
  noteGlowColor?: NoteColor;
  noteAutoYCorrection?: boolean;
  className?: string;
}

// 키 탭 상태 타입
export interface KeyTabState {
  // 슬롯 멤버 키 목록 (칩 UI), 빈 배열 = 미할당
  members: string[];
  // 입력 방식: 단일 / 개별(any) / 동시(all)
  mode: KeySlotUiMode;
  activeImage: string;
  inactiveImage: string;
  width: number | string;
  height: number | string;
  idleTransparent: boolean;
  activeTransparent: boolean;
  className: string;
  showImagePicker: boolean;
}

// 노트 탭 상태 타입
export interface NoteTabState {
  noteEffectEnabled: boolean;
  colorMode: ColorMode;
  noteColor: string;
  gradientBottom: string;
  noteOpacity: number;
  glowEnabled: boolean;
  glowSize: number;
  glowOpacity: number;
  glowColor: string;
  glowGradientBottom: string;
  glowColorMode: ColorMode;
  showPicker: boolean;
  showGlowPicker: boolean;
  isFocused: boolean;
  displayNoteOpacity: string;
  glowSizeFocused: boolean;
  glowOpacityFocused: boolean;
  displayGlowSize: string;
  displayGlowOpacity: string;
  autoYCorrection: boolean;
}

// 카운터 탭 상태 타입
export interface CounterTabState {
  counterEnabled: boolean;
  placement: string;
  align: string;
  alignMode: string;
  gap: number;
  isGapFocused: boolean;
  displayGap: string;
  fillIdle: string;
  fillActive: string;
  strokeIdle: string;
  strokeActive: string;
  pickerFor: string | null;
  pickerOpen: boolean;
}

// 미리보기 타입
export interface KeyPreviewData {
  type: 'key';
  activeImage?: string;
  inactiveImage?: string;
  width?: number;
  height?: number;
  idleTransparent?: boolean;
  activeTransparent?: boolean;
  className?: string;
}

export interface NotePreviewData {
  type: 'note';
  noteColor?: NoteColor;
  noteOpacity?: number;
  noteEffectEnabled?: boolean;
  noteGlowEnabled?: boolean;
  noteGlowSize?: number;
  noteGlowOpacity?: number;
  noteGlowColor?: NoteColor;
  noteAutoYCorrection?: boolean;
}

export interface CounterPreviewData {
  type: 'counter';
  enabled?: boolean;
  placement?: string;
  align?: string;
  alignMode?: string;
  gap?: number;
  fill?: { idle: string; active: string };
  stroke?: { idle: string; active: string };
}

export interface RollbackData {
  type: 'rollback';
  key: KeyData;
  counter: KeyCounterSettings | null;
}

export type PreviewData =
  | KeyPreviewData
  | NotePreviewData
  | CounterPreviewData
  | RollbackData;

// 저장 데이터 타입
export interface SaveData {
  key: KeySlot;
  activeImage: string;
  inactiveImage: string;
  width: number;
  height: number;
  idleTransparent: boolean;
  activeTransparent: boolean;
  className: string;
  noteColor: NoteColor;
  noteOpacity: number;
  noteEffectEnabled: boolean;
  noteGlowEnabled: boolean;
  noteGlowSize: number;
  noteGlowOpacity: number;
  noteGlowColor: NoteColor;
  noteAutoYCorrection: boolean;
  counter: KeyCounterSettings;
}

// ============================================================================
// 초기 상태 생성 함수
// ============================================================================

export function createInitialKeyState(keyData: KeyData): KeyTabState {
  return {
    members: slotMembers(keyData.key),
    mode: slotUiMode(keyData.key),
    activeImage: keyData.activeImage || '',
    inactiveImage: keyData.inactiveImage || '',
    width: keyData.width || 60,
    height: keyData.height || 60,
    idleTransparent: keyData.idleTransparent || false,
    activeTransparent: keyData.activeTransparent || false,
    className: keyData.className || '',
    showImagePicker: false,
  };
}

export function createInitialNoteState(keyData: KeyData): NoteTabState {
  const initialNoteColor = keyData.noteColor || '#FFFFFF';
  const initialGlowSource = keyData.noteGlowColor ?? initialNoteColor;

  return {
    noteEffectEnabled: keyData.noteEffectEnabled !== false,
    colorMode: isGradientColor(initialNoteColor)
      ? COLOR_MODES.gradient
      : COLOR_MODES.solid,
    noteColor: normalizeColorInput(initialNoteColor),
    gradientBottom: isGradientColor(initialNoteColor)
      ? (initialNoteColor as GradientColor).bottom
      : normalizeColorInput(initialNoteColor),
    noteOpacity: keyData.noteOpacity ?? 80,
    glowEnabled: keyData.noteGlowEnabled ?? false,
    glowSize:
      typeof keyData.noteGlowSize === 'number' ? keyData.noteGlowSize : 20,
    glowOpacity:
      typeof keyData.noteGlowOpacity === 'number'
        ? keyData.noteGlowOpacity
        : 70,
    glowColor: isGradientColor(initialGlowSource)
      ? normalizeColorInput((initialGlowSource as GradientColor).top)
      : normalizeColorInput(initialGlowSource as string),
    glowGradientBottom: isGradientColor(initialGlowSource)
      ? normalizeColorInput((initialGlowSource as GradientColor).bottom)
      : normalizeColorInput(initialGlowSource as string),
    glowColorMode: isGradientColor(initialGlowSource)
      ? COLOR_MODES.gradient
      : COLOR_MODES.solid,
    showPicker: false,
    showGlowPicker: false,
    isFocused: false,
    displayNoteOpacity:
      typeof keyData.noteOpacity === 'number'
        ? `${keyData.noteOpacity}%`
        : '80%',
    glowSizeFocused: false,
    glowOpacityFocused: false,
    displayGlowSize:
      typeof keyData.noteGlowSize === 'number'
        ? keyData.noteGlowSize.toString()
        : '20',
    displayGlowOpacity:
      typeof keyData.noteGlowOpacity === 'number'
        ? `${keyData.noteGlowOpacity}%`
        : '70%',
    autoYCorrection: keyData.noteAutoYCorrection !== false,
  };
}

export function createInitialCounterState(
  initialCounterSettings: KeyCounterSettings | null | undefined,
): CounterTabState {
  const resolved = normalizeCounterSettings(
    initialCounterSettings ?? createDefaultCounterSettings(),
  );

  return {
    counterEnabled: resolved.enabled,
    placement: resolved.placement,
    align: resolved.align,
    alignMode: resolved.alignMode,
    gap: resolved.gap ?? 6,
    isGapFocused: false,
    displayGap: `${resolved.gap ?? 6}px`,
    fillIdle: resolved.fill.idle,
    fillActive: resolved.fill.active,
    strokeIdle: resolved.stroke.idle,
    strokeActive: resolved.stroke.active,
    pickerFor: null,
    pickerOpen: false,
  };
}

// ============================================================================
// 메인 훅
// ============================================================================

export interface UseUnifiedKeySettingStateProps {
  keyData: KeyData;
  initialCounterSettings: KeyCounterSettings | null | undefined;
  onPreview?: (data: PreviewData) => void;
  onSave: (data: SaveData) => void;
  onClose: () => void;
}

export function useUnifiedKeySettingState({
  keyData,
  initialCounterSettings,
  onPreview,
  onSave,
  onClose,
}: UseUnifiedKeySettingStateProps) {
  // 탭 상태
  const [activeTab, setActiveTab] = useState<TabType>(TABS.KEY);

  // 초기 데이터 저장 (취소 시 롤백용)
  const originalDataRef = useRef({
    key: keyData,
    counter: initialCounterSettings,
  });

  // 키 탭 상태
  const [keyState, setKeyState] = useState<KeyTabState>(() =>
    createInitialKeyState(keyData),
  );

  // 노트 탭 상태
  const [noteState, setNoteState] = useState<NoteTabState>(() =>
    createInitialNoteState(keyData),
  );

  // 카운터 탭 상태 — 비교·병합 기준은 마운트 시점 원본으로 고정
  // (프리뷰가 부모 position을 갱신해 initialCounterSettings가 오염되므로)
  const [resolvedCounterSettings] = useState(() =>
    normalizeCounterSettings(
      initialCounterSettings ?? createDefaultCounterSettings(),
    ),
  );

  const [counterState, setCounterState] = useState<CounterTabState>(() =>
    createInitialCounterState(initialCounterSettings),
  );

  // 미리보기 핸들러
  const handleKeyPreview = (updates: Omit<KeyPreviewData, 'type'>) => {
    if (!onPreview) return;
    onPreview({
      type: 'key',
      ...updates,
    });
  };

  const handleNotePreview = (updates: Omit<NotePreviewData, 'type'>) => {
    if (!onPreview) return;
    onPreview({
      type: 'note',
      ...updates,
    });
  };

  const handleCounterPreview = (updates: Omit<CounterPreviewData, 'type'>) => {
    if (!onPreview) return;
    onPreview({
      type: 'counter',
      ...updates,
    });
  };

  // 백그라운드 GIF 최적화 완료 시(원본 -> WebP 치환) 편집 중 상태도 동기화
  useEffect(() => {
    const unlistenPromise = listen<{ fromPath?: string; toPath?: string }>(
      'image:optimized',
      ({ payload }) => {
        const fromPath =
          typeof payload?.fromPath === 'string' ? payload.fromPath.trim() : '';
        const toPath =
          typeof payload?.toPath === 'string' ? payload.toPath.trim() : '';

        if (!fromPath || !toPath || fromPath === toPath) return;

        let previewUpdates: Omit<KeyPreviewData, 'type'> | null = null;

        setKeyState((prev) => {
          let changed = false;
          const next = { ...prev };

          if (prev.inactiveImage === fromPath) {
            next.inactiveImage = toPath;
            changed = true;
          }
          if (prev.activeImage === fromPath) {
            next.activeImage = toPath;
            changed = true;
          }

          if (changed) {
            previewUpdates = {
              ...(prev.inactiveImage === fromPath
                ? { inactiveImage: toPath }
                : {}),
              ...(prev.activeImage === fromPath ? { activeImage: toPath } : {}),
            };
            return next;
          }

          return prev;
        });

        if (previewUpdates && onPreview) {
          onPreview({
            type: 'key',
            ...previewUpdates,
          });
        }
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [onPreview]);

  // 저장 핸들러
  const handleSubmit = () => {
    const noteColorValue =
      noteState.colorMode === COLOR_MODES.gradient
        ? toGradient(noteState.noteColor, noteState.gradientBottom)
        : noteState.noteColor;

    const glowColorValue =
      noteState.glowColorMode === COLOR_MODES.gradient
        ? toGradient(noteState.glowColor, noteState.glowGradientBottom)
        : noteState.glowColor;

    onSave({
      // 키 데이터 - 단일 모드는 첫 키만 유지
      key: buildSlot(
        keyState.mode === 'single'
          ? keyState.members.slice(0, 1)
          : keyState.members,
        keyState.mode === 'all' ? 'all' : 'any',
      ),
      activeImage: keyState.activeImage,
      inactiveImage: keyState.inactiveImage,
      width:
        typeof keyState.width === 'number'
          ? keyState.width
          : parseInt(keyState.width, 10) || 60,
      height:
        typeof keyState.height === 'number'
          ? keyState.height
          : parseInt(keyState.height, 10) || 60,
      idleTransparent: keyState.idleTransparent,
      activeTransparent: keyState.activeTransparent,
      className: keyState.className,
      // 노트 데이터
      noteColor: noteColorValue,
      noteOpacity: noteState.noteOpacity,
      noteEffectEnabled: noteState.noteEffectEnabled,
      noteGlowEnabled: noteState.glowEnabled,
      noteGlowSize: noteState.glowSize,
      noteGlowOpacity: noteState.glowOpacity,
      noteGlowColor: glowColorValue,
      noteAutoYCorrection: noteState.autoYCorrection,
      // 카운터 데이터 — 이 다이얼로그가 편집하지 않는 필드(폰트·애니메이션·gradient)는 원본 유지
      counter: normalizeCounterSettings({
        ...resolvedCounterSettings,
        enabled: counterState.counterEnabled,
        placement: counterState.placement,
        align: counterState.align,
        alignMode: counterState.alignMode,
        gap: counterState.gap,
        fill: {
          idle: counterState.fillIdle,
          active: counterState.fillActive,
        },
        stroke: {
          idle: counterState.strokeIdle,
          active: counterState.strokeActive,
        },
        // fill 피커가 단색 전용이므로 색을 바꿨다면 단색 선택으로 보고 gradient 해제.
        // 비교는 canonical 표기 기준 — 같은 색의 hex↔rgba 재출력으로 오판하지 않게
        fillIdleGradient:
          toCompactRgba(counterState.fillIdle) ===
          toCompactRgba(resolvedCounterSettings.fill.idle)
            ? resolvedCounterSettings.fillIdleGradient ?? null
            : null,
        fillActiveGradient:
          toCompactRgba(counterState.fillActive) ===
          toCompactRgba(resolvedCounterSettings.fill.active)
            ? resolvedCounterSettings.fillActiveGradient ?? null
            : null,
      }),
    });
  };

  // 취소 핸들러 (원본으로 롤백)
  const handleClose = () => {
    if (onPreview) {
      const original = originalDataRef.current;
      onPreview({
        type: 'rollback',
        key: original.key,
        counter: original.counter,
      });
    }
    onClose();
  };

  return {
    // 탭 상태
    activeTab,
    setActiveTab,

    // 키 상태
    keyState,
    setKeyState,

    // 노트 상태
    noteState,
    setNoteState,

    // 카운터 상태
    counterState,
    setCounterState,

    // 핸들러
    handleKeyPreview,
    handleNotePreview,
    handleCounterPreview,
    handleSubmit,
    handleClose,
  };
}
