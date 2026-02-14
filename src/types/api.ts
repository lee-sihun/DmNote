import { BootstrapPayload } from "@src/types/app";
import { CustomCss } from "@src/types/css";
import { CustomJs, JsPlugin } from "@src/types/js";
import {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
} from "@src/types/keys";
import type { StatItemPositions } from "@src/types/statItems";
import {
  SettingsDiff,
  SettingsPatchInput,
  SettingsState,
} from "@src/types/settings";

export type ModeChangePayload = { mode: string };
export type CustomTabsChangePayload = {
  customTabs: CustomTab[];
  selectedKeyType: string;
};
export type KeyStatePayload = { key: string; state: string; mode: string };
export type InputDevice = "keyboard" | "mouse" | "gamepad" | "unknown";
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
export type OverlayState = BootstrapPayload["overlay"];
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

// 탭별 CSS 타입
export type TabCssResponse = {
  tabId: string;
  css: import("@src/types/css").TabCss | null;
};
export type TabCssLoadResult = {
  success: boolean;
  error?: string;
  tabId: string;
  css?: import("@src/types/css").TabCss;
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
  css?: import("@src/types/css").TabCss;
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
export type KeyCounterUpdate = { mode: string; key: string; count: number };

export type PresetOperationResult = { success: boolean; error?: string };

export type BridgeMessage<T = any> = { type: string; data?: T };
export type BridgeMessageListener<T = any> = (data: T) => void;
export type BridgeAnyListener = (type: string, data: any) => void;
export type WindowTarget = "main" | "overlay";

// UI Plugin 컨텍스트 메뉴 types
export type KeyMenuContext = {
  keyCode: string;
  index: number;
  position: any; // KeyPosition from keys.ts
  mode: string;
};

export type GridMenuContext = {
  position: { dx: number; dy: number };
  mode: string;
};

export type PluginMenuItem<TContext = any> = {
  id: string;
  label: string;
  disabled?: boolean | ((context: TContext) => boolean);
  visible?: boolean | ((context: TContext) => boolean);
  position?: "top" | "bottom";
  onClick: (context: TContext) => void | Promise<void>;
};

export type PluginMenuItemInternal<TContext = any> =
  PluginMenuItem<TContext> & {
    pluginId: string;
    fullId: string;
  };

export interface DisplayElementInstance {
  readonly id: string;
  setState(updates: Record<string, any>): void;
  setData(updates: Record<string, any>): void;
  getState(): Record<string, any>;
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
  actions: Record<string, (...args: any[]) => any>;
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
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

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
  settings?: Record<string, any>;
  state?: Record<string, any>;
  tabId?: string; // 탭 ID (4key, 5key, custom-tab-id 등)
};

export type PluginMessages = Record<string, Record<string, any>>;
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
  position?: "top" | "bottom";
}

export type PluginSettingType =
  | "boolean"
  | "color"
  | "number"
  | "string"
  | "select"
  | "divider";

export type PluginSettingSchema =
  | {
      type: "divider";
      label?: string;
    }
  | {
      type: Exclude<PluginSettingType, "divider">;
      default: any;
      label: string;
      min?: number; // for number
      max?: number; // for number
      step?: number; // for number
      options?: { label: string; value: any }[]; // for select
      placeholder?: string; // for string/number
    };

export interface PluginDefinitionHookContext {
  setState: (updates: Record<string, any>) => void;
  getSettings: () => Record<string, any>;
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
  onHook: (event: "key" | "rawKey", callback: (...args: any[]) => void) => void;
  expose: (actions: Record<string, (...args: any[]) => any>) => void;
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
      newSettings: Record<string, any>,
      oldSettings: Record<string, any>,
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
  preserveAxis?: "width" | "height" | "both" | "none";
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
   * 설정 UI 표시 방식
   * - "panel": 속성 패널 (기본값)
   * - "modal": 기존 모달
   */
  settingsUI?: "panel" | "modal";
  settings?: Record<string, PluginSettingSchema>;
  messages?: PluginMessages;
  template: (
    state: Record<string, any>,
    settings: Record<string, any>,
    helpers: DisplayElementTemplateHelpers,
  ) => DisplayElementTemplateResult | string;
  previewState?: Record<string, any>;
  onMount?: (context: PluginDefinitionHookContext) => void | (() => void);
}

export interface PluginDefinitionInternal extends PluginDefinition {
  id: string;
  pluginId: string;
}

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
  settingsUI?: "panel" | "modal";
  /** 설정 변경 시 호출되는 콜백 */
  onChange?: (
    newSettings: Record<string, any>,
    oldSettings: Record<string, any>,
  ) => void;
}

/**
 * defineSettings 반환값 - 설정 관리 인터페이스
 */
export interface PluginSettingsInstance {
  /** 현재 설정값 조회 */
  get(): Record<string, any>;
  /** 설정값 변경 */
  set(updates: Record<string, any>): Promise<void>;
  /** 설정 다이얼로그 열기 */
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
      newSettings: Record<string, any>,
      oldSettings: Record<string, any>,
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
  // 자동 생성된 핸들러 ID (함수가 전달된 경우)
  _onClickId?: string;
  _onPositionChangeId?: string;
  _onDeleteId?: string;
};

export interface DisplayElementTemplateResult {
  // ReactNode or similar
  [key: string]: any;
}

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
  state: Record<string, any>,
  helpers?: DisplayElementTemplateHelpers,
) => string | DisplayElementTemplateResult;

export type DisplayElementTemplateValueResolver = (
  state: Record<string, any>,
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
  | Record<string, any>
  | Array<any>;

export type DisplayElementTemplateFactory = (
  strings: TemplateStringsArray,
  ...values: DisplayElementTemplateFactoryValue[]
) => DisplayElementTemplateFunction;

export type DisplayElementTemplate = DisplayElementTemplateFunction;

export type PluginDisplayElementConfig = Omit<PluginDisplayElement, "id"> & {
  state?: Record<string, any>;
  template?: DisplayElementTemplateFunction;
};

export type Unsubscribe = () => void;

// UI Components Options
export interface ButtonOptions {
  variant?: "primary" | "danger" | "secondary";
  size?: "small" | "medium" | "large";
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
  type?: "text" | "number" | "color";
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
    openExternal(url: string): Promise<void>;
    restart(): Promise<void>;
  };
  window: {
    type: "main" | "overlay";
    minimize(): Promise<void>;
    close(): Promise<void>;
    openDevtoolsAll?(): Promise<void>;
  };
  settings: {
    get(): Promise<SettingsState>;
    update(patch: SettingsPatchInput): Promise<SettingsState>;
    onChanged(listener: (diff: SettingsDiff) => void): Unsubscribe;
  };
  keys: {
    get(): Promise<KeyMappings>;
    update(mappings: KeyMappings): Promise<KeyMappings>;
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
    onKeyState(listener: (payload: KeyStatePayload) => void): Unsubscribe;
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
    onUse(listener: (payload: CssTogglePayload) => void): Unsubscribe;
    onContent(listener: (payload: CustomCss) => void): Unsubscribe;
    // 탭별 CSS API
    tab: {
      getAll(): Promise<import("@src/types/css").TabCssOverrides>;
      get(tabId: string): Promise<TabCssResponse>;
      load(tabId: string): Promise<TabCssLoadResult>;
      clear(tabId: string): Promise<TabCssClearResult>;
      set(
        tabId: string,
        css: import("@src/types/css").TabCss | null,
      ): Promise<TabCssSetResult>;
      toggle(tabId: string, enabled: boolean): Promise<TabCssToggleResult>;
      onChanged(listener: (payload: TabCssResponse) => void): Unsubscribe;
    };
  };
  font: {
    load(): Promise<FontLoadResult>;
  };
  image: {
    load(): Promise<ImageLoadResult>;
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
  };
  bridge: {
    send(type: string, data?: any): Promise<void>;
    sendTo(target: WindowTarget, type: string, data?: any): Promise<void>;
    on<T = any>(type: string, listener: BridgeMessageListener<T>): Unsubscribe;
    once<T = any>(
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
      get<T = any>(key: string): Promise<T | null>;
      set(key: string, value: any): Promise<void>;
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
        updates: Partial<PluginMenuItem<any>>,
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
        updates: Record<string, any>,
      ): void;
      setData(
        target: string | DisplayElementInstance,
        updates: Record<string, any>,
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
