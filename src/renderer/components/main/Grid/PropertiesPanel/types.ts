import type { ImageFit, KeyPosition, KeySlot } from '@src/types/key/keys';
import type { ColorModeValue, GradientSpec } from '@src/types/color';
import type {
  GradientCanvasAnchor,
  GradientPreviewSurface,
} from '@stores/grid/useGradientEditStore';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';
import type {
  EditorCounterAnimationPresetIntentV1,
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
  EditorCounterStrokePropertyPatchV1,
  EditorCounterFillPropertyPatchV1,
  EditorFontColorPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
  EditorElementPropertyPatchV1,
} from '@src/types/editor';

// ============================================================================
// 탭 상수
// ============================================================================

export const TABS = {
  STYLE: 'style',
  NOTE: 'note',
  COUNTER: 'counter',
} as const;

export type TabType = (typeof TABS)[keyof typeof TABS];

// 레이어 패널 탭 상수
export const LAYER_PANEL_TABS = {
  LAYER: 'layer',
  GRID: 'grid',
} as const;

export type LayerPanelTabType =
  (typeof LAYER_PANEL_TABS)[keyof typeof LAYER_PANEL_TABS];

// ============================================================================
// 컴포넌트 Props 타입
// ============================================================================

export interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
}

export type {
  NumberInputProps,
  OptionalNumberInputProps,
} from '@components/main/common/NumberInput';

export interface ColorInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 내부 ColorPicker mount를 첫 paint 뒤로 미뤄 스와치 피드백을 우선 반영 */
  pickerMountStrategy?: CommitStrategy;
  onChangeComplete?: (value: string) => void;
  activeValue?: string;
  onActiveChange?: (value: string) => void;
  onActiveChangeComplete?: (value: string) => void;
  showStateTabs?: boolean;
  stateMode?: 'idle' | 'active';
  onStateModeChange?: (mode: 'idle' | 'active') => void;
  colorId?: string;
  solidOnly?: boolean;
  panelElement?: HTMLElement | null;
  // 외부에서 열림 상태를 제어할 때 사용
  isOpen?: boolean;
  onToggle?: () => void;
  /** gradient 편집 지원 — 저장된 상태별 스펙. onModeCommit이 있으면 활성화 */
  gradientValue?: GradientSpec | null;
  activeGradientValue?: GradientSpec | null;
  /** gradient 지원 커밋 경로 — 단색/그라데이션 확정을 한 콜백으로 수신 */
  onModeCommit?: (state: 'idle' | 'active', value: ColorModeValue) => void;
  /** 온캔버스 각도 핸들 앵커 */
  canvasAnchor?: GradientCanvasAnchor;
  /** 편집 표면 — 캔버스 일시 페인트 대상 필드 (기본 background) */
  gradientSurface?: GradientPreviewSurface;
  /** 배치 선택에서 hex·알파가 서로 다르면 피커 칸에 Mixed. 둘은 따로 판단한다 */
  hexMixed?: boolean;
  alphaMixed?: boolean;
}

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 타이핑 callback을 첫 paint 뒤로 미뤄 입력 echo를 우선 반영 */
  commitStrategy?: CommitStrategy;
  onBlur?: (value: string) => void;
  /** 지정 시 타이핑은 preview로 흐르고 onChange는 blur/Enter 확정에만 호출됨 */
  onPreview?: (value: string) => void;
  /** Escape 원복 시 호출 (게스처 취소 연동) */
  onCancel?: () => void;
  placeholder?: string;
  width?: string;
  isMixed?: boolean;
}

export interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export interface TabsProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  t: (key: string) => string;
  availableTabs?: TabType[];
}

// 글꼴 스타일 토글 Props
export interface FontStyleToggleProps {
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrikethrough: boolean;
  onBoldChange: (value: boolean) => void;
  onItalicChange: (value: boolean) => void;
  onUnderlineChange: (value: boolean) => void;
  onStrikethroughChange: (value: boolean) => void;
}

// ============================================================================
// 단일 키 콘텐츠 Props (단일 선택 및 개별 편집 모드에서 재사용)
// ============================================================================

// ============================================================================
// 탭 콘텐츠 공통 Props
// ============================================================================

export interface StyleTabContentProps {
  /** 온캔버스 각도 핸들 앵커 (단일 키/통계) */
  canvasAnchor?: GradientCanvasAnchor;
  keyIndex: number;
  keyPosition: KeyPosition;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;
  onGeometryPreview?: (
    field: 'dx' | 'dy' | 'width' | 'height',
    value: number,
  ) => void;
  onGeometryCommit?: (
    field: 'dx' | 'dy' | 'width' | 'height',
    value: number,
  ) => void;
  onElementPropertyCommit?: (patch: EditorElementPropertyPatchV1) => void;
  onKeyMappingChange?: (index: number, newSlot: KeySlot) => void;
  // 편집 대상 슬롯 (칩 에디터용)
  keySlot?: KeySlot | null;
  // 키 매핑 UI를 대체하는 커스텀 컨트롤 (통계 요소 등)
  mappingControl?: React.ReactNode;
  // 키 매핑 영역을 통째로 대체하는 커스텀 레이아웃 (다중 라인 라벨 등)
  mappingControlLayout?: React.ReactNode;
  mappingLabel?: string;
  // 표시 텍스트 입력 숨김 (통계 요소는 statType이 displayText 역할)
  hideDisplayText?: boolean;
  showSoundControls?: boolean;
  // 눌림 상태가 없는 요소(통계)는 상태별 편집 표면에서 대기만 편집
  shadowActiveState?: boolean;
  showImagePicker?: boolean;
  onToggleImagePicker?: () => void;
  onInactiveImageCommit?: (inactiveImage: string) => void;
  onActiveImageCommit?: (activeImage: string) => void;
  onIdleTransparentCommit?: (idleTransparent: boolean) => void;
  onActiveTransparentCommit?: (activeTransparent: boolean) => void;
  onIdleImageFitCommit?: (idleImageFit: ImageFit) => void;
  onActiveImageFitCommit?: (activeImageFit: ImageFit) => void;
  onSoundPathCommit?: (soundPath: string) => void;
  onSoundEnabledCommit?: (soundEnabled: boolean) => void;
  onSoundVolumeCommit?: (soundVolume: number) => void;
  onStylePropertyPreview?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onPaintCommit?: (patch: EditorPaintPropertyPatchV1) => void;
  onFontColorCommit?: (patch: EditorFontColorPropertyPatchV1) => void;
  onShadowCommit?: (patch: EditorShadowPropertyPatchV1) => void;
  imageButtonRef?: React.RefObject<HTMLButtonElement>;
  panelElement?: HTMLElement | null;
  useCustomCSS?: boolean;
  t: (key: string) => string;
}

export interface NoteTabContentProps {
  keyPosition: KeyPosition;
  onElementPropertyCommit?: (patch: EditorElementPropertyPatchV1) => void;
  onStylePropertyPreview?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onStylePropertyCommit?: (patch: EditorPreviewStylePropertyPatchV1) => void;
  onNotePaintPreview?: (patch: EditorNotePaintPropertyPatchV1) => void;
  onNotePaintCommit?: (patch: EditorNotePaintPropertyPatchV1) => void;
  panelElement?: HTMLElement | null;
  t: (key: string) => string;
}

export interface CounterTabContentProps {
  keyPosition: KeyPosition;
  keyDisplayName?: string;
  isStat?: boolean;
  onCounterEnabledCommit?: (enabled: boolean) => void;
  onCounterAnimationEnabledCommit?: (enabled: boolean) => void;
  onCounterLayoutCommit?: (patch: EditorCounterLayoutPropertyPatchV1) => void;
  onCounterTypographyCommit?: (
    patch: EditorCounterTypographyPropertyPatchV1,
  ) => void;
  onCounterStrokeCommit?: (patch: EditorCounterStrokePropertyPatchV1) => void;
  onCounterFillCommit?: (patch: EditorCounterFillPropertyPatchV1) => void;
  onCounterAnimationPresetCommit?: (
    intent: EditorCounterAnimationPresetIntentV1,
  ) => void;
  panelElement?: HTMLElement | null;
  t: (key: string) => string;
}

// ============================================================================
// 키 데이터 타입
// ============================================================================

export interface KeyData {
  index: number;
  position: KeyPosition | undefined;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;
}

// ============================================================================
// 레이어 패널 타입
// ============================================================================

export interface LayerItem {
  type: 'key' | 'stat' | 'graph' | 'knob' | 'plugin';
  id: string;
  index?: number;
  name: string;
  zIndex: number;
  hidden: boolean;
  groupId?: string;
}

export interface GroupHeaderItem {
  displayType: 'group-header';
  groupId: string;
  groupName: string;
  isCollapsed: boolean;
  childCount: number;
  allHidden: boolean;
}

export interface LayerDisplayItem {
  displayType: 'layer';
  item: LayerItem;
  groupDepth: number;
  flatIndex: number;
}

export type DisplayItem = GroupHeaderItem | LayerDisplayItem;

// 배치 커밋이 받는 모양. 단일 선택이 쓰는 태그 유니온(EditorElementPropertyPatchV1)과
// 다르다 - 배치 핸들러는 PropertiesPanel의 get*Patch 헬퍼로 단일 키 객체를 태그 유니온으로
// 바꿔 wire에 올린다. 그 헬퍼들이 키가 정확히 하나일 때만 통과시키므로, 여기에 태그 유니온을
// 보내면 키가 둘이라 전부 null이 되어 커밋이 조용히 폐기된다
export type BatchElementPropertyUpdate = Partial<KeyPosition>;
