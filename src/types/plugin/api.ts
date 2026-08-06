import { BootstrapPayload } from '@src/types/app';
import { CustomCss } from '@src/types/plugin/css';
import { CustomJs, JsPlugin } from '@src/types/plugin/js';
import {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
  KeyPosition,
} from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { KnobItemPositions } from '@src/types/key/knobs';
import type { LayerGroups } from '@src/types/layerGroups';
import type {
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorGetResult,
} from '@src/types/editor';
import {
  SettingsDiff,
  SettingsPatchInput,
  SettingsState,
} from '@src/types/settings/settings';

/** Value type for plugin settings (boolean, string, or number) */
export type PluginSettingValue = string | number | boolean;

export type ModeChangePayload = { mode: string };
export type CustomTabsChangePayload = {
  customTabs: CustomTab[];
  selectedKeyType: string;
};
export type KeyStatePayload = {
  key: string;
  state: string;
  mode: string;
  /** 입력 수신~emit 경과 시간(ms). performance.now() - eventAgeMs로 실제 입력 시각 복원 */
  eventAgeMs?: number;
  /** UP 한정. 데몬이 입력 캡처 시점 기준으로 측정한 물리 눌림 지속 시간(ms) */
  holdDurationMs?: number;
};
export type KeysResetPayload = {
  /** 리셋 사유 (예: hook_restart) */
  reason: string;
};
export type InputDevice = 'keyboard' | 'mouse' | 'gamepad' | 'unknown';
export type RawInputPayload = {
  device: InputDevice;
  label: string;
  labels: string[];
  state: string;
};

/**
 * 키 입력 통계 데이터
 */
export type KeyStatsPayload = {
  /** 현재 KPS (Keys Per Second) */
  kps: number;
  /** 평균 KPS */
  kpsAvg: number;
  /** 최대 KPS */
  kpsMax: number;
  /** 현재 탭의 전체 키 카운트 합계 */
  total: number;
};

export type OverlayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type OverlayState = BootstrapPayload['overlay'];
export type OverlayVisibilityPayload = { visible: boolean };
export type OverlayLockPayload = { locked: boolean };
export type OverlayAnchorPayload = { anchor: string };
export type OverlayResizePayload = OverlayBounds;

export type CssTogglePayload = { enabled: boolean };
export type CssSetContentResult = { success: boolean; error?: string };
export type CssLoadResult = {
  success: boolean;
  error?: string;
  content?: string;
  path?: string;
};

// CSS 불러오기 히스토리
export type CssHistoryStatus = 'available' | 'missing' | 'invalid' | 'tooLarge';
export type CustomCssHistoryItem = {
  path: string;
  lastUsedAt: number;
  status: CssHistoryStatus;
};
export type CssHistoryErrorCode =
  | 'PATH_NOT_AUTHORIZED'
  | 'NOT_FOUND'
  | 'NOT_REGULAR_FILE'
  | 'INVALID_EXTENSION'
  | 'TOO_LARGE'
  | 'INVALID_UTF8'
  | 'IO_ERROR';
export type CssActivateResult = {
  success: boolean;
  code?: CssHistoryErrorCode;
  content?: string;
  path?: string;
};

// 폰트 타입
export type FontLoadResult = {
  success: boolean;
  error?: string;
  fontName?: string;
  fontPath?: string;
};

export type ImageLoadResult = {
  success: boolean;
  error?: string;
  imagePath?: string;
};

export type SoundLoadResult = {
  success: boolean;
  error?: string;
  soundPath?: string;
};

export type SoundListItem = {
  soundPath: string;
  fileName: string;
  sizeBytes: number;
  modifiedAtMs?: number;
  /** 피커 목록에서 숨김 여부 — 재생에는 영향 없음 */
  hidden: boolean;
  /** @deprecated hidden의 역논리 별칭 (enabled = !hidden) — 1.6.1 호환 */
  enabled: boolean;
  source: 'local' | 'builtin';
  originalPath?: string;
  trimStartRatio?: number;
  trimEndRatio?: number;
  displayName?: string;
};

export type SoundSetHiddenResult = {
  success: boolean;
  soundPath: string;
  hidden: boolean;
};

export type SoundSetEnabledResult = {
  success: boolean;
  soundPath: string;
  enabled: boolean;
};

export type SoundSaveProcessedWavResult = {
  success: boolean;
  error?: string;
  soundPath?: string;
};

export type SoundRenameResult = {
  success: boolean;
  displayName: string;
};

export type SoundDeleteResult = {
  success: boolean;
};

export type SoundLoadOriginalResult = {
  success: boolean;
  error?: string;
  audioBase64?: string;
  originalExtension?: string;
};

export type SoundUpdateProcessedWavResult = {
  success: boolean;
  error?: string;
};

export type CounterAnimationPreset = {
  id: string;
  name: string;
  source: 'builtin' | 'user';
  labelKey?: string;
  bezier: [number, number, number, number];
  scale: number;
  durationMs: number;
};

export type CounterAnimationListResponse = {
  builtinPresets: CounterAnimationPreset[];
  userPresets: CounterAnimationPreset[];
};

export type CounterAnimationCreateRequest = {
  name: string;
  bezier: [number, number, number, number];
  scale: number;
  durationMs: number;
};

export type CounterAnimationUpdateRequest = {
  id: string;
  name: string;
  bezier: [number, number, number, number];
  scale: number;
  durationMs: number;
};

export type CounterAnimationUpsertResponse = {
  preset: CounterAnimationPreset;
  affectedUsageCount: number;
};

export type CounterAnimationDeleteResponse = {
  success: boolean;
  id: string;
  affectedUsageCount: number;
  fallbackPresetId: string;
};

// 탭별 CSS 타입
export type TabCssResponse = {
  tabId: string;
  css: import('@src/types/plugin/css').TabCss | null;
};
export type TabCssLoadResult = {
  success: boolean;
  error?: string;
  tabId: string;
  css?: import('@src/types/plugin/css').TabCss;
};
export type TabCssClearResult = {
  success: boolean;
  tabId: string;
};
export type TabCssToggleResult = {
  success: boolean;
  tabId: string;
  enabled: boolean;
};
export type TabCssSetResult = {
  success: boolean;
  tabId: string;
  css?: import('@src/types/plugin/css').TabCss;
};
export type TabCssActivateResult = {
  success: boolean;
  code?: CssHistoryErrorCode;
  tabId: string;
  css?: import('@src/types/plugin/css').TabCss;
};
export type TabCssExportResult = {
  success: boolean;
  code?: 'NO_TAB_CSS' | 'IO_ERROR';
  error?: string;
  path?: string;
};

// 탭별 노트 트랙 설정 타입
export type TabNoteResponse = {
  tabId: string;
  settings: import('@src/types/settings/noteSettings').TabNoteSettings | null;
};
export type TabNoteClearResult = {
  success: boolean;
  tabId: string;
};
export type TabNoteSetResult = {
  success: boolean;
  tabId: string;
  settings?: import('@src/types/settings/noteSettings').TabNoteSettings;
};

export type JsTogglePayload = { enabled: boolean };
export type JsSetContentResult = { success: boolean; error?: string };
export type JsPluginError = { path: string; error: string };
export type JsLoadResult = {
  success: boolean;
  added: JsPlugin[];
  errors?: JsPluginError[];
};
export type JsReloadResult = {
  updated: JsPlugin[];
  errors?: JsPluginError[];
};
export type JsRemoveResult = {
  success: boolean;
  removedId?: string;
  error?: string;
};
export type JsPluginUpdateResult = {
  success: boolean;
  plugin?: JsPlugin;
  error?: string;
};

export type KeysModeResponse = { success: boolean; mode: string };
export type KeysResetAllResponse = {
  keys: KeyMappings;
  positions: KeyPositions;
  customTabs: CustomTab[];
  selectedKeyType: string;
};
export type CustomTabResult = { result?: CustomTab; error?: string };
export type CustomTabDeleteResult = {
  success: boolean;
  selected: string;
  error?: string;
};
export type KeyCounterUpdate = {
  mode: string;
  key: string;
  count: number;
  sessionId: string;
  revision: number;
};

export type PresetOperationResult = { success: boolean; error?: string };

export type PresetSnapshot = {
  keys: KeyMappings;
  positions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
  customTabs: CustomTab[];
  selectedKeyType: string;
  tabNoteOverrides: import('@src/types/settings/noteSettings').TabNoteOverrides;
};
export type AppAutoUpdateResult = {
  previousVersion: string;
  updatedTo: string;
  downloadUrl: string;
};

export type BridgeMessage<T = unknown> = { type: string; data?: T };
export type BridgeMessageListener<T = unknown> = (data: T) => void;
export type BridgeAnyListener = (type: string, data: unknown) => void;
export type WindowTarget = 'main' | 'overlay';

// UI Plugin 컨텍스트 메뉴 types
export type KeyMenuContext = {
  keyCode: string;
  index: number;
  position: KeyPosition;
  mode: string;
};

export type GridMenuContext = {
  position: { dx: number; dy: number };
  mode: string;
};

export type PluginMenuItem<TContext = unknown> = {
  id: string;
  label: string;
  disabled?: boolean | ((context: TContext) => boolean);
  visible?: boolean | ((context: TContext) => boolean);
  position?: 'top' | 'bottom';
  onClick: (context: TContext) => void | Promise<void>;
};

export type PluginMenuItemInternal<TContext = unknown> =
  PluginMenuItem<TContext> & {
    pluginId: string;
    fullId: string;
  };

export interface DisplayElementInstance {
  readonly id: string;
  setState(updates: Record<string, unknown>): void;
  setData(updates: Record<string, unknown>): void;
  getState(): Record<string, unknown>;
  setText(selector: string, text: string): void;
  setHTML(selector: string, html: string): void;
  setStyle(selector: string, styles: Record<string, string>): void;
  addClass(selector: string, ...classNames: string[]): void;
  removeClass(selector: string, ...classNames: string[]): void;
  toggleClass(selector: string, className: string): void;
  query(selector: string): Element | ShadowRoot | null;
  update(updates: Partial<PluginDisplayElement>): void;
  remove(): void;
}

// UI Plugin Display Element types
export type PluginDisplayElementActionContext = {
  element: PluginDisplayElement;
  actions: Record<string, (...args: unknown[]) => unknown>;
};

export type PluginDisplayElementContextMenu = {
  enableDelete?: boolean;
  deleteLabel?: string; // 삭제 메뉴 텍스트 (기본: "삭제")
  customItems?: PluginMenuItem<PluginDisplayElementActionContext>[];
};

/**
 * 요소 크기 변경 시 기준점 (앵커)
 * - top-left: 좌상단 기준 (기본값)
 * - top-center: 상단 중앙 기준
 * - top-right: 우상단 기준
 * - center-left: 좌측 중앙 기준
 * - center: 정중앙 기준
 * - center-right: 우측 중앙 기준
 * - bottom-left: 좌하단 기준
 * - bottom-center: 하단 중앙 기준
 * - bottom-right: 우하단 기준
 */
export type ElementResizeAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type PluginDisplayElement = {
  id: string;
  html: string;
  position: {
    x: number;
    y: number;
  };
  anchor?: {
    keyCode: string;
    offset?: { x: number; y: number };
  };
  /**
   * 요소 크기 변경 시 기준점
   * @default "top-left"
   */
  resizeAnchor?: ElementResizeAnchor;
  draggable?: boolean;
  zIndex?: number;
  scoped?: boolean;
  className?: string;
  style?: Record<string, string>;
  estimatedSize?: { width: number; height: number };
  onClick?: string | (() => void | Promise<void>); // 이벤트 핸들러 ID 또는 함수 (메인 윈도우에서만)
  onPositionChange?:
    | string
    | ((position: { x: number; y: number }) => void | Promise<void>); // 위치 변경 핸들러 ID 또는 함수 (메인 윈도우에서만)
  onDelete?: string | (() => void | Promise<void>); // 삭제 핸들러 ID 또는 함수 (메인 윈도우에서만)
  contextMenu?: PluginDisplayElementContextMenu;
  definitionId?: string;
  settings?: Record<string, unknown>;
  state?: Record<string, unknown>;
  tabId?: string; // 탭 ID (4key, 5key, custom-tab-id 등)
};

export type PluginMessages = Record<string, Record<string, unknown>>;
export type PluginI18nParams = Record<string, string | number>;
export type PluginTranslateFn = (
  key: string,
  params?: PluginI18nParams,
  fallback?: string,
) => string;

export interface PluginDefinitionContextMenuItem {
  label: string;
  action?: string; // name of the exposed action to call
  onClick?: (
    context: PluginDisplayElementActionContext,
  ) => void | Promise<void>;
  disabled?:
    | boolean
    | ((context: PluginDisplayElementActionContext) => boolean);
  visible?: boolean | ((context: PluginDisplayElementActionContext) => boolean);
  position?: 'top' | 'bottom';
}

export type PluginValueSettingType =
  | 'boolean'
  | 'color'
  | 'number'
  | 'string'
  | 'select';

// divider 타입은 section 도입과 함께 제거 — 기존 플러그인의 divider는
// 정규화에서 미지원 타입으로 조용히 제외됨 (fail-closed)
export type PluginLayoutSettingType = 'section';

export type PluginSettingType =
  | PluginValueSettingType
  | PluginLayoutSettingType;

export type PluginSettingSchema =
  | {
      type: 'section';
      label?: string;
      visible?: boolean | ((settings: Record<string, unknown>) => boolean);
    }
  | {
      type: PluginValueSettingType;
      default: string | number | boolean;
      label: string;
      min?: number; // for number
      max?: number; // for number
      step?: number; // for number
      options?: { label: string; value: string | number | boolean }[]; // for select
      placeholder?: string; // for string/number
      visible?: boolean | ((settings: Record<string, unknown>) => boolean);
    };

export interface PluginDefinitionHookContext {
  setState: (updates: Record<string, unknown>) => void;
  getSettings: () => Record<string, unknown>;
  /**
   * Set the resize anchor for this element instance
   * @param anchor - The anchor position for resize operations
   *
   * When the element's size changes, the position will be adjusted
   * to keep the specified anchor point fixed.
   *
   * @example
   * setAnchor("center"); // Keep center position fixed when resizing
   * setAnchor("bottom-right"); // Keep bottom-right corner fixed
   */
  setAnchor: (anchor: ElementResizeAnchor) => void;
  /**
   * Get the current resize anchor for this element instance
   * @returns The current anchor position
   */
  getAnchor: () => ElementResizeAnchor;
  /**
   * Register event hooks
   * @param event - Event type: 'key' (mapped key events) or 'rawKey' (all raw input events)
   * @param callback - Event handler
   *
   * 'key' event payload: { key: string, state: 'DOWN' | 'UP', mode: string }
   * 'rawKey' event payload: { device: 'keyboard' | 'mouse' | 'gamepad' | 'unknown', label: string, labels: string[], state: 'DOWN' | 'UP' }
   */
  onHook: (
    event: 'key' | 'rawKey',
    callback: (...args: unknown[]) => void,
  ) => void;
  expose: (actions: Record<string, (...args: unknown[]) => unknown>) => void;
  locale: string;
  t: PluginTranslateFn;
  onLocaleChange: (listener: (locale: string) => void) => Unsubscribe;
  /**
   * Register a listener for settings changes
   * @param listener - Callback function that receives new and old settings
   *
   * Called when any setting value changes. Use this to react to setting changes
   * that require re-fetching data or re-initializing resources.
   *
   * @example
   * onSettingsChange((newSettings, oldSettings) => {
   *   if (newSettings.nickname !== oldSettings.nickname) {
   *     fetchUserData(newSettings.nickname);
   *   }
   * });
   */
  onSettingsChange: (
    listener: (
      newSettings: Record<string, unknown>,
      oldSettings: Record<string, unknown>,
    ) => void,
  ) => void;
}

export interface PluginDefinition {
  name: string;
  /**
   * 최대 인스턴스(패널) 개수 제한
   * - 미지정 또는 0: 무제한 (기본값)
   * - 양수: 해당 개수로 제한
   */
  maxInstances?: number;
  /**
   * 그리드에서 크기 조절 가능 여부
   * @default false
   */
  resizable?: boolean;
  /**
   * 설정 변경 시 유지할 축
   * resizable이 true일 때만 적용됨
   * - 'width': 가로 크기 유지, 세로는 콘텐츠 따라감
   * - 'height': 세로 크기 유지, 가로는 콘텐츠 따라감
   * - 'both': 둘 다 유지 (기본값)
   * - 'none': 둘 다 콘텐츠 따라감
   * @default 'both'
   */
  preserveAxis?: 'width' | 'height' | 'both' | 'none';
  /**
   * 요소 크기 변경 시 기준점 (기본값)
   * 인스턴스별로 setAnchor()를 통해 오버라이드 가능
   * @default "top-left"
   */
  resizeAnchor?: ElementResizeAnchor;
  contextMenu?: {
    create?: string; // 그리드 메뉴 라벨 (예: "KPS 패널 생성")
    delete?: string; // 요소 메뉴 라벨 (예: "KPS 패널 삭제")
    items?: PluginDefinitionContextMenuItem[];
  };
  /**
   * 메뉴 predicate가 참조할 오버레이 상태 키 (옵트인 저빈도 동기화)
   * 선언된 키의 setState 변경만 메인 윈도우로 전달되어 contextMenu.items의
   * visible/disabled 평가 시 element.state에 병합됨 — 고빈도 상태(bars 등)는
   * 선언하지 않는 한 절대 전송되지 않음. 프리뷰(previewState 기반 state)는 불변
   */
  contextMenuStateKeys?: string[];
  /**
   * 설정 UI 표시 방식
   * - "panel": 속성 패널 (기본값)
   * - "modal": 기존 모달
   */
  settingsUI?: 'panel' | 'modal';
  settings?: Record<string, PluginSettingSchema>;
  messages?: PluginMessages;
  template: (
    state: Record<string, unknown>,
    settings: Record<string, unknown>,
    helpers: DisplayElementTemplateHelpers,
  ) => DisplayElementTemplateResult | string;
  previewState?: Record<string, unknown>;
  onMount?: (context: PluginDefinitionHookContext) => void | (() => void);
}

export interface PluginDefinitionInternal extends PluginDefinition {
  id: string;
  pluginId: string;
}

// ========== 분리 패널 read-model 투영 ==========

/**
 * visible을 main이 현재 settings로 평가한 boolean으로 치환한 스키마
 * 함수 필드가 없어 창 경계 직렬화 가능
 */
export type PluginResolvedSettingSchema =
  | {
      type: 'section';
      label?: string;
      visible: boolean;
    }
  | {
      type: PluginValueSettingType;
      default: string | number | boolean;
      label: string;
      min?: number;
      max?: number;
      step?: number;
      options?: { label: string; value: string | number | boolean }[];
      placeholder?: string;
      visible: boolean;
    };

/**
 * 분리 패널로 push되는 definition 투영
 * template·hook·컨텍스트 메뉴 콜백 등 함수 필드 제외
 */
export type PluginDefinitionView = {
  definitionId: string;
  name: string;
  resizable?: boolean;
  preserveAxis?: 'width' | 'height' | 'both' | 'none';
  resizeAnchor?: ElementResizeAnchor;
  settingsUI?: 'panel' | 'modal';
  resolvedSettingsSchema: Record<string, PluginResolvedSettingSchema>;
  messages?: PluginMessages;
};

/** 분리 패널 편집 UI가 실제로 소비하는 요소 필드만 담은 read-model */
export type PluginPanelElementView = Pick<
  PluginDisplayElementInternal,
  | 'id'
  | 'fullId'
  | 'pluginId'
  | 'definitionId'
  | 'position'
  | 'settings'
  | 'measuredSize'
  | 'estimatedSize'
  | 'resizeAnchor'
  | 'zIndex'
  | 'hidden'
  | 'width'
  | 'height'
  | 'tabId'
>;

/**
 * main → panel 플러그인 read-model 스냅샷
 * backend modelRevision은 RPC 충돌 게이트, pushSeq는 패널의 역행 push 차단 기준
 */
export type PluginPanelModelSnapshot = {
  /** backend canonical plugin_model_revision - RPC expectedModelRevision 도메인 */
  modelRevision: number;
  /** push 순서 전용 단조 시퀀스 - 역전된 낡은 push 무시 기준 (revision과 별개) */
  pushSeq: number;
  /** main authority generation - 패널이 첫 mutation 전에 설치 */
  authorityGeneration: number;
  elements: PluginPanelElementView[];
  definitions: PluginDefinitionView[];
  /** fullId → key별 visibility (main이 요소별 현재 settings로 평가, 스키마 본문은 definition view 1회) */
  elementVisibility: Record<string, Record<string, boolean>>;
};

// ========== defineSettings API ==========

/**
 * 플러그인 전역 설정 정의
 */
export interface PluginSettingsDefinition {
  /** 설정 스키마 (defineElement의 settings와 동일한 형식) */
  settings: Record<string, PluginSettingSchema>;
  /** 다국어 메시지 번들 */
  messages?: PluginMessages;
  /**
   * 설정 UI 표시 방식
   * - "panel": 속성 패널 (기본값)
   * - "modal": 기존 모달
   */
  settingsUI?: 'panel' | 'modal';
  /** 설정 변경 시 호출되는 콜백 */
  onChange?: (
    newSettings: Record<string, unknown>,
    oldSettings: Record<string, unknown>,
  ) => void;
}

/**
 * defineSettings 반환값 - 설정 관리 인터페이스
 */
export interface PluginSettingsInstance {
  /** 현재 설정값 조회 */
  get(): Record<string, unknown>;
  /** 설정값 변경 */
  set(updates: Record<string, unknown>): Promise<void>;
  /** 설정 노브로그 열기 */
  open(): Promise<boolean>;
  /** 설정을 기본값으로 초기화 */
  reset(): Promise<void>;
  /**
   * 설정 변경 구독
   * @param listener - 설정 변경 시 호출되는 콜백
   * @returns 구독 해제 함수
   */
  subscribe(
    listener: (
      newSettings: Record<string, unknown>,
      oldSettings: Record<string, unknown>,
    ) => void,
  ): Unsubscribe;
}

// =========================================

export type PluginDisplayElementInternal = PluginDisplayElement & {
  pluginId: string;
  fullId: string;
  measuredSize?: { width: number; height: number };
  /** 레이어 표시 여부 (true면 숨김) */
  hidden?: boolean;
  /** 리사이즈 시 사용되는 명시적 너비 */
  width?: number;
  /** 리사이즈 시 사용되는 명시적 높이 */
  height?: number;
  /** 레이어 그룹 ID */
  groupId?: string;
  // 자동 생성된 핸들러 ID (함수가 전달된 경우)
  _onClickId?: string;
  _onPositionChangeId?: string;
  _onDeleteId?: string;
};

// Intentionally open interface – acts as a structural marker for
// template return values that are rendered as React elements.
// Consumers cast the value to ReactNode before rendering.
// Using Record<string, unknown> would break React element assignability.
export type DisplayElementTemplateResult = Record<string, never>;

export interface DisplayElementTemplateHelpers {
  html(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): DisplayElementTemplateResult;
  styleMap(
    styles: Record<string, string | number | undefined | null>,
  ): Record<string, string | number | undefined | null>;
  css(
    strings: TemplateStringsArray,
    ...values: (string | number | undefined | null)[]
  ): string;
  locale: string;
  t: PluginTranslateFn;
}

export type DisplayElementTemplateFunction = (
  state: Record<string, unknown>,
  helpers?: DisplayElementTemplateHelpers,
) => string | DisplayElementTemplateResult;

export type DisplayElementTemplateValueResolver = (
  state: Record<string, unknown>,
  helpers: DisplayElementTemplateHelpers,
) => unknown;

export type DisplayElementTemplateFactoryValue =
  | DisplayElementTemplateValueResolver
  | DisplayElementTemplateResult
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | Array<unknown>;

export type DisplayElementTemplateFactory = (
  strings: TemplateStringsArray,
  ...values: DisplayElementTemplateFactoryValue[]
) => DisplayElementTemplateFunction;

export type DisplayElementTemplate = DisplayElementTemplateFunction;

export type PluginDisplayElementConfig = Omit<PluginDisplayElement, 'id'> & {
  state?: Record<string, unknown>;
  template?: DisplayElementTemplateFunction;
};

export type Unsubscribe = () => void;

export type ReadyUnsubscribe = Unsubscribe & {
  ready: Promise<void>;
};

// UI Components Options
export interface ButtonOptions {
  variant?: 'primary' | 'danger' | 'secondary';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: string | (() => void | Promise<void>);
  id?: string;
}

export interface CheckboxOptions {
  checked?: boolean;
  onChange?: string | ((checked: boolean) => void | Promise<void>);
  id?: string;
}

export interface InputOptions {
  type?: 'text' | 'number' | 'color';
  placeholder?: string;
  value?: string | number;
  disabled?: boolean;
  onInput?: string | ((value: string) => void | Promise<void>);
  onChange?: string | ((value: string) => void | Promise<void>);
  id?: string;
  width?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface DropdownOption {
  label: string;
  value: string;
}

export interface DropdownOptions {
  options: DropdownOption[];
  selected?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: string | ((value: string) => void | Promise<void>);
  id?: string;
}

export interface PanelOptions {
  title?: string;
  width?: number;
}

export interface DMNoteAPI {
  app: {
    bootstrap(): Promise<BootstrapPayload>;
    autoUpdate(tag: string): Promise<AppAutoUpdateResult>;
    openExternal(url: string): Promise<void>;
    restart(): Promise<void>;
    quit(): Promise<void>;
  };
  window: {
    type: 'main' | 'overlay';
    minimize(): Promise<void>;
    close(): Promise<void>;
    showMain(): Promise<void>;
    openDevtoolsAll?(): Promise<void>;
  };
  settings: {
    get(): Promise<SettingsState>;
    update(patch: SettingsPatchInput): Promise<SettingsState>;
    onChanged(listener: (diff: SettingsDiff) => void): Unsubscribe;
  };
  editor: {
    get(): Promise<EditorGetResult>;
    commit(request: EditorCommitRequest): Promise<EditorCommitResult>;
    onCommitted(listener: (event: EditorCommittedV1) => void): ReadyUnsubscribe;
  };
  keys: {
    get(): Promise<KeyMappings>;
    getCounters(): Promise<KeyCounters>;
    // multiKey: 멀티 키 슬롯 지원 선언. 현재 매핑에 멀티 슬롯이 있는데
    // 선언 없이 쓰면 MULTI_KEY_UNSUPPORTED로 거절됨
    update(
      mappings: KeyMappings,
      options?: { multiKey?: boolean },
    ): Promise<KeyMappings>;
    updateWithPositions(
      mappings: KeyMappings,
      positions: KeyPositions,
      options?: { multiKey?: boolean },
    ): Promise<{ keys: KeyMappings; positions: KeyPositions }>;
    getPositions(): Promise<KeyPositions>;
    updatePositions(positions: KeyPositions): Promise<KeyPositions>;
    setMode(mode: string): Promise<KeysModeResponse>;
    resetAll(): Promise<KeysResetAllResponse>;
    resetMode(mode: string): Promise<KeysModeResponse>;
    setCounters(counters: KeyCounters): Promise<KeyCounters>;
    onChanged(listener: (keys: KeyMappings) => void): Unsubscribe;
    onPositionsChanged(
      listener: (positions: KeyPositions) => void,
    ): Unsubscribe;
    onModeChanged(listener: (payload: ModeChangePayload) => void): Unsubscribe;
    onKeyState(listener: (payload: KeyStatePayload) => void): ReadyUnsubscribe;
    onKeysReset(
      listener: (payload: KeysResetPayload) => void,
    ): ReadyUnsubscribe;
    onRawInput(listener: (payload: RawInputPayload) => void): Unsubscribe;
    resetCounters(): Promise<KeyCounters>;
    resetCountersMode(mode: string): Promise<KeyCounters>;
    resetSingleCounter(mode: string, key: string): Promise<KeyCounters>;
    onCounterChanged(
      listener: (payload: KeyCounterUpdate) => void,
    ): Unsubscribe;
    onCountersChanged(listener: (payload: KeyCounters) => void): Unsubscribe;
    customTabs: {
      list(): Promise<CustomTab[]>;
      create(name: string): Promise<CustomTabResult>;
      delete(id: string): Promise<CustomTabDeleteResult>;
      select(id: string): Promise<CustomTabDeleteResult>;
      restore(customTabs: CustomTab[], selectedKeyType: string): Promise<void>;
      onChanged(
        listener: (payload: CustomTabsChangePayload) => void,
      ): Unsubscribe;
    };
  };
  statItems: {
    getPositions(): Promise<StatItemPositions>;
    updatePositions(positions: StatItemPositions): Promise<StatItemPositions>;
    onPositionsChanged(
      listener: (positions: StatItemPositions) => void,
    ): Unsubscribe;
  };
  graphItems: {
    getPositions(): Promise<GraphItemPositions>;
    updatePositions(positions: GraphItemPositions): Promise<GraphItemPositions>;
    onPositionsChanged(
      listener: (positions: GraphItemPositions) => void,
    ): Unsubscribe;
  };
  knobItems: {
    getPositions(): Promise<KnobItemPositions>;
    updatePositions(positions: KnobItemPositions): Promise<KnobItemPositions>;
    onPositionsChanged(
      listener: (positions: KnobItemPositions) => void,
    ): Unsubscribe;
  };
  layerGroups: {
    get(): Promise<LayerGroups>;
    update(groups: LayerGroups): Promise<LayerGroups>;
    onChanged(listener: (groups: LayerGroups) => void): Unsubscribe;
  };
  overlay: {
    get(): Promise<OverlayState>;
    setVisible(visible: boolean): Promise<void>;
    setLock(locked: boolean): Promise<void>;
    setAnchor(anchor: string): Promise<string>;
    resize(payload: {
      width: number;
      height: number;
      anchor?: string;
      contentTopOffset?: number;
      // 4변 마진 계약. 부재 시 contentTopOffset 경로로 동작
      contentMargins?: {
        top: number;
        bottom: number;
        left: number;
        right: number;
      };
      fixedPositionDeltaX?: number;
      fixedPositionDeltaY?: number;
    }): Promise<OverlayBounds>;
    onVisibility(
      listener: (payload: OverlayVisibilityPayload) => void,
    ): Unsubscribe;
    onLock(listener: (payload: OverlayLockPayload) => void): Unsubscribe;
    onAnchor(listener: (payload: OverlayAnchorPayload) => void): Unsubscribe;
    onResized(listener: (payload: OverlayResizePayload) => void): Unsubscribe;
  };
  css: {
    get(): Promise<CustomCss>;
    getUse(): Promise<boolean>;
    toggle(enabled: boolean): Promise<CssTogglePayload>;
    load(): Promise<CssLoadResult>;
    setContent(content: string): Promise<CssSetContentResult>;
    reset(): Promise<void>;
    historyGet(): Promise<CustomCssHistoryItem[]>;
    historyActivate(path: string): Promise<CssActivateResult>;
    historyRemove(path: string): Promise<CustomCssHistoryItem[]>;
    onUse(listener: (payload: CssTogglePayload) => void): Unsubscribe;
    onContent(listener: (payload: CustomCss) => void): Unsubscribe;
    // 탭별 CSS API
    tab: {
      getAll(): Promise<import('@src/types/plugin/css').TabCssOverrides>;
      get(tabId: string): Promise<TabCssResponse>;
      load(tabId: string): Promise<TabCssLoadResult>;
      clear(tabId: string): Promise<TabCssClearResult>;
      set(
        tabId: string,
        css: import('@src/types/plugin/css').TabCss | null,
      ): Promise<TabCssSetResult>;
      toggle(tabId: string, enabled: boolean): Promise<TabCssToggleResult>;
      activateHistory(
        tabId: string,
        path: string,
      ): Promise<TabCssActivateResult>;
      export(tabId: string): Promise<TabCssExportResult>;
      onChanged(listener: (payload: TabCssResponse) => void): Unsubscribe;
    };
  };
  noteTab: {
    getAll(): Promise<
      import('@src/types/settings/noteSettings').TabNoteOverrides
    >;
    get(tabId: string): Promise<TabNoteResponse>;
    set(
      tabId: string,
      settings:
        | import('@src/types/settings/noteSettings').TabNoteSettings
        | null,
    ): Promise<TabNoteSetResult>;
    clear(tabId: string): Promise<TabNoteClearResult>;
    onChanged(listener: (payload: TabNoteResponse) => void): Unsubscribe;
    onChangedAll(
      listener: (
        payload: import('@src/types/settings/noteSettings').TabNoteOverrides,
      ) => void,
    ): Unsubscribe;
  };
  font: {
    load(): Promise<FontLoadResult>;
  };
  image: {
    load(): Promise<ImageLoadResult>;
  };
  sound: {
    load(): Promise<SoundLoadResult>;
    list(): Promise<SoundListItem[]>;
    rename(soundPath: string, displayName: string): Promise<SoundRenameResult>;
    remove(soundPath: string): Promise<SoundDeleteResult>;
    setHidden(
      soundPath: string,
      hidden: boolean,
    ): Promise<SoundSetHiddenResult>;
    /** @deprecated setHidden의 역논리 별칭 — enabled = !hidden */
    setEnabled(
      soundPath: string,
      enabled: boolean,
    ): Promise<SoundSetEnabledResult>;
    saveProcessedWav(
      wavBase64: string,
      fileName?: string,
      originalBase64?: string,
      originalExtension?: string,
      trimStartRatio?: number,
      trimEndRatio?: number,
    ): Promise<SoundSaveProcessedWavResult>;
    loadOriginal(soundPath: string): Promise<SoundLoadOriginalResult>;
    updateProcessedWav(
      soundPath: string,
      wavBase64: string,
      trimStartRatio?: number,
      trimEndRatio?: number,
      displayName?: string,
    ): Promise<SoundUpdateProcessedWavResult>;
    setLatencyLogging(enabled: boolean): Promise<void>;
  };
  counterAnimation: {
    list(): Promise<CounterAnimationListResponse>;
    create(
      request: CounterAnimationCreateRequest,
    ): Promise<CounterAnimationUpsertResponse>;
    update(
      request: CounterAnimationUpdateRequest,
    ): Promise<CounterAnimationUpsertResponse>;
    remove(id: string): Promise<CounterAnimationDeleteResponse>;
    onChanged(
      listener: (payload: CounterAnimationListResponse) => void,
    ): Unsubscribe;
  };
  js: {
    get(): Promise<CustomJs>;
    getUse(): Promise<boolean>;
    toggle(enabled: boolean): Promise<JsTogglePayload>;
    load(): Promise<JsLoadResult>;
    reload(): Promise<JsReloadResult>;
    remove(id: string): Promise<JsRemoveResult>;
    setPluginEnabled(
      id: string,
      enabled: boolean,
    ): Promise<JsPluginUpdateResult>;
    setContent(content: string): Promise<JsSetContentResult>;
    reset(): Promise<void>;
    onUse(listener: (payload: JsTogglePayload) => void): Unsubscribe;
    onState(listener: (payload: CustomJs) => void): Unsubscribe;
  };
  presets: {
    save(): Promise<PresetOperationResult>;
    load(): Promise<PresetOperationResult>;
    saveTab(): Promise<PresetOperationResult>;
    loadTab(): Promise<PresetOperationResult>;
    onSnapshot(listener: (snapshot: PresetSnapshot) => void): Unsubscribe;
  };
  bridge: {
    send(type: string, data?: unknown): Promise<void>;
    sendTo(target: WindowTarget, type: string, data?: unknown): Promise<void>;
    on<T = unknown>(
      type: string,
      listener: BridgeMessageListener<T>,
    ): Unsubscribe;
    once<T = unknown>(
      type: string,
      listener: BridgeMessageListener<T>,
    ): Unsubscribe;
    onAny(listener: BridgeAnyListener): Unsubscribe;
    off(type: string, listener?: BridgeMessageListener): void;
  };
  i18n: {
    getLocale(): Promise<string>;
    onLocaleChange(listener: (locale: string) => void): Unsubscribe;
  };
  stats: {
    /**
     * 키 입력 통계를 구독합니다.
     * 50ms 간격으로 콜백이 호출됩니다.
     * @param listener - 통계 데이터를 받을 콜백 함수
     * @returns 구독 해제 함수
     */
    subscribe(listener: (stats: KeyStatsPayload) => void): Unsubscribe;
    /**
     * 현재 통계값을 즉시 조회합니다.
     * @returns 현재 통계 데이터
     */
    get(): KeyStatsPayload;
    /**
     * KPS 관련 통계를 초기화합니다.
     * total은 카운터 기반이므로 초기화되지 않습니다.
     */
    reset(): void;
  };
  plugin: {
    storage: {
      get<T = unknown>(key: string): Promise<T | null>;
      set(key: string, value: unknown): Promise<void>;
      remove(key: string): Promise<void>;
      clear(): Promise<void>;
      keys(): Promise<string[]>;
      hasData(prefix: string): Promise<boolean>;
      clearByPrefix(prefix: string): Promise<number>;
    };
    registerCleanup(cleanup: () => void): void;
    defineElement(definition: PluginDefinition): void;
    defineSettings(
      definition: PluginSettingsDefinition,
    ): PluginSettingsInstance;
  };
  ui: {
    contextMenu: {
      addKeyMenuItem(item: PluginMenuItem<KeyMenuContext>): string;
      addGridMenuItem(item: PluginMenuItem<GridMenuContext>): string;
      removeMenuItem(fullId: string): void;
      updateMenuItem(
        fullId: string,
        updates: Partial<PluginMenuItem<unknown>>,
      ): void;
      clearMyMenuItems(): void;
    };
    displayElement: {
      html(
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): DisplayElementTemplateResult;
      template: DisplayElementTemplateFactory;
      add(element: PluginDisplayElementConfig): DisplayElementInstance;
      get(fullId: string): DisplayElementInstance | undefined;
      setState(
        target: string | DisplayElementInstance,
        updates: Record<string, unknown>,
      ): void;
      setData(
        target: string | DisplayElementInstance,
        updates: Record<string, unknown>,
      ): void;
      setText(
        target: string | DisplayElementInstance,
        selector: string,
        text: string,
      ): void;
      setHTML(
        target: string | DisplayElementInstance,
        selector: string,
        html: string,
      ): void;
      setStyle(
        target: string | DisplayElementInstance,
        selector: string,
        styles: Record<string, string>,
      ): void;
      addClass(
        target: string | DisplayElementInstance,
        selector: string,
        ...classNames: string[]
      ): void;
      removeClass(
        target: string | DisplayElementInstance,
        selector: string,
        ...classNames: string[]
      ): void;
      toggleClass(
        target: string | DisplayElementInstance,
        selector: string,
        className: string,
      ): void;
      query(
        target: string | DisplayElementInstance,
        selector: string,
      ): Element | ShadowRoot | null;
      update(
        target: string | DisplayElementInstance,
        updates: Partial<PluginDisplayElement>,
      ): void;
      remove(target: string | DisplayElementInstance): void;
      clearMyElements(): void;
    };
    dialog: {
      alert(message: string, options?: { confirmText?: string }): Promise<void>;
      confirm(
        message: string,
        options?: {
          confirmText?: string;
          cancelText?: string;
          danger?: boolean;
        },
      ): Promise<boolean>;
      custom(
        html: string,
        options?: {
          confirmText?: string;
          cancelText?: string;
          showCancel?: boolean;
        },
      ): Promise<boolean>;
    };
    components: {
      button(text: string, options?: ButtonOptions): string;
      checkbox(options?: CheckboxOptions): string;
      input(options?: InputOptions): string;
      dropdown(options: DropdownOptions): string;
      panel(content: string, options?: PanelOptions): string;
      formRow(label: string, component: string): string;
    };
    pickColor(options: {
      initialColor: string;
      onColorChange: (color: string) => void;
      position?: { x: number; y: number };
      id?: string;
      referenceElement?: HTMLElement;
      onClose?: () => void;
      onColorChangeComplete?: (color: string) => void;
    }): void;
  };
}
