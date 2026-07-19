import type { KeyPosition } from '@src/types/key/keys';
import type { ColorModeValue, GradientSpec } from '@src/types/color';
import type {
  GradientCanvasAnchor,
  GradientPreviewSurface,
} from '@stores/grid/useGradientEditStore';

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

export interface PropertiesPanelProps {
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyMappingChange?: (index: number, newKey: string) => void;
}

export interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
}

export interface NumberInputProps {
  value: number | string;
  onChange: (value: number) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  prefix?: string;
  suffix?: string;
  width?: string;
  allowDecimal?: boolean;
  decimalScale?: number;
  isMixed?: boolean;
  mixedPlaceholder?: string;
}

export interface OptionalNumberInputProps {
  value?: number;
  onChange: (value?: number) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  prefix?: string;
  suffix?: string;
  width?: string;
  placeholder?: string;
  allowNegative?: boolean;
  allowDecimal?: boolean;
  decimalScale?: number;
  isMixed?: boolean;
  mixedPlaceholder?: string;
}

export interface ColorInputProps {
  value: string;
  onChange: (value: string) => void;
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
}

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
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

export interface SingleKeyContentProps {
  // 키 데이터
  keyIndex: number;
  keyPosition: KeyPosition;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;

  // 탭 상태
  activeTab: TabType;

  // 핸들러
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyMappingChange?: (index: number, newKey: string) => void;

  // 키 리스닝 상태 (옵션 - 개별 편집 모드에서는 사용하지 않음)
  isListening?: boolean;
  onKeyListen?: () => void;

  // 이미지 픽커 상태 (옵션 - 개별 편집 모드에서는 사용하지 않음)
  showImagePicker?: boolean;
  onToggleImagePicker?: () => void;
  imageButtonRef?: React.RefObject<HTMLButtonElement>;

  // 커스텀 CSS 설정
  useCustomCSS?: boolean;

  // 번역 함수
  t: (key: string) => string;
}

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
  onPositionChange: (index: number, dx: number, dy: number) => void;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  onKeyMappingChange?: (index: number, newKey: string) => void;
  isListening?: boolean;
  onKeyListen?: () => void;
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
  imageButtonRef?: React.RefObject<HTMLButtonElement>;
  panelElement?: HTMLElement | null;
  useCustomCSS?: boolean;
  t: (key: string) => string;
}

export interface NoteTabContentProps {
  keyIndex: number;
  keyPosition: KeyPosition;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
  onKeyPreview?: (index: number, updates: Partial<KeyPosition>) => void;
  panelElement?: HTMLElement | null;
  t: (key: string) => string;
}

export interface CounterTabContentProps {
  keyIndex: number;
  keyPosition: KeyPosition;
  keyDisplayName?: string;
  isStat?: boolean;
  onKeyUpdate: (data: Partial<KeyPosition> & { index: number }) => void;
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
