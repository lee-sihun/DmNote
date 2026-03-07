/**
 * macOS 네이티브 커서 스타일을 동적으로 생성하는 유틸리티
 * Tauri IPC를 통해 시스템 커서 설정(크기, 색상)을 가져와 적용합니다.
 */

import { invoke } from '@tauri-apps/api/core';
import { isMac } from '../core/platform';

/** 커서 설정 응답 타입 */
export interface CursorSettings {
  /** 커서 크기 배율 (1.0 ~ 4.0) */
  size: number;
  /** 기본 픽셀 크기 (24px - macOS 기본 커서 크기) */
  base_size: number;
  /** 채우기 색상 (HEX) */
  fill_color: string;
  /** 테두리 색상 (HEX) */
  outline_color: string;
  /** macOS 플랫폼 여부 */
  is_macos: boolean;
}

/** 커서 타입 */
export type CursorType =
  | 'ns-resize'
  | 'ew-resize'
  | 'nwse-resize'
  | 'nesw-resize';

/** 캐시된 커서 설정 */
let cachedSettings: CursorSettings | null = null;
/** 캐시된 커서 URL 맵 */
let cachedCursors: Map<CursorType, string> | null = null;
/** 초기화 Promise */
let initPromise: Promise<void> | null = null;
const CURSOR_VAR_PREFIX = '--dmn-cursor-';
const CURSOR_BODY_CLASS = 'dmn-custom-cursor';
const CURSOR_OVERLAY_ID = 'dmn-cursor-overlay';
const DEFAULT_CURSOR_BASE_SIZE = 24;

interface CursorOverlayState {
  hoverType: CursorType | null;
  lockedType: CursorType | null;
  activeType: CursorType | null;
  renderKey: string | null;
  hotspot: number;
  root: HTMLDivElement | null;
  lastPointer: { x: number; y: number } | null;
  rafId: number | null;
  listenerAttached: boolean;
}

const overlayState: CursorOverlayState = {
  hoverType: null,
  lockedType: null,
  activeType: null,
  renderKey: null,
  hotspot: 0,
  root: null,
  lastPointer: null,
  rafId: null,
  listenerAttached: false,
};

const getDefaultCursorSettings = (): CursorSettings => ({
  size: 1.0,
  base_size: DEFAULT_CURSOR_BASE_SIZE,
  fill_color: '#000000',
  outline_color: '#FFFFFF',
  is_macos: isMac(),
});

/**
 * 시스템 커서 설정을 Tauri에서 가져옵니다.
 */
export async function fetchCursorSettings(): Promise<CursorSettings> {
  try {
    const settings = await invoke<CursorSettings>('get_cursor_settings');
    return settings;
  } catch {
    return getDefaultCursorSettings();
  }
}

/**
 * apple_cursor 원본 SVG 커서를 생성합니다.
 * https://github.com/ful1e5/apple_cursor
 *
 * 커서 크기는 시스템 설정에 따라 동적으로 변합니다.
 * SVG의 viewBox 스케일링으로 어떤 크기에서도 선명하게 렌더링됩니다.
 */
function createCursorSvgMarkup(
  type: CursorType,
  settings: CursorSettings,
): { svg: string; cursorSize: number; hotspot: number } {
  const { fill_color, outline_color, size, base_size } = settings;

  // 실제 커서 크기 (기본 24px * 크기 배율)
  // 브라우저 최대 지원 크기는 128px이므로 제한
  const cursorSize = Math.min(128, Math.round(base_size * size));
  const hotspot = Math.round(cursorSize / 2);
  const shadowLayers = [
    { dy: 4, opacity: 0.18 },
    { dy: 8, opacity: 0.12 },
    { dy: 12, opacity: 0.06 },
  ];

  let outlinePath: string;
  let fillPath: string;

  // apple_cursor 원본 디자인 (257x257 viewBox)
  // outline = #0000FF → outline_color
  // fill = #00FF00 → fill_color
  switch (type) {
    case 'ew-resize':
      // left_side.svg - 좌우 양방향 화살표
      outlinePath = `M82.3713 105.66L82.0812 59.2437L13.1138 128.426L82.9513 198.475L82.6435 151.846L149.457 152.218L172.669 152.375L172.952 199.029L242.133 129.848L172.074 59.7891L172.348 106.205L82.3713 105.66Z`;
      fillPath = `M70.88 117.54L70.8749 87.536L29.52 129.154L70.8889 170.752L70.892 140.527L184.137 140.505L184.133 170.763L225.759 129.137L184.136 87.5139L184.124 117.534L70.88 117.54Z`;
      break;
    case 'ns-resize':
      // top_side.svg - 상하 양방향 화살표
      outlinePath = `M104.667 174.388L58.251 174.679L127.433 243.646L197.483 173.808L150.853 174.116L151.225 107.303L151.382 84.0906L198.036 83.8073L128.856 14.6265L58.7964 84.6856L105.212 84.4119L104.667 174.388Z`;
      fillPath = `M116.547 185.88L86.5436 185.885L128.161 227.24L169.76 185.871L139.534 185.868L139.512 72.6232L169.77 72.6264L128.145 31.0006L86.5215 72.6239L116.542 72.6353L116.547 185.88Z`;
      break;
    case 'nwse-resize':
      // bottom_right_corner.svg - 북서-남동 대각선
      outlinePath = `M112.146 80.5377L144.762 47.5115L47.0757 47.6633L46.9258 146.578L79.6801 113.389L126.661 160.896L142.964 177.421L110.175 210.61L208.011 210.61V111.532L175.384 144.546L112.146 80.5377Z`;
      fillPath = `M95.6259 80.8019L116.838 59.5825L58.1678 59.7682L58.0054 118.435L79.3802 97.0647L159.472 177.125L138.074 198.519L196.941 198.519V139.654L175.706 160.874L95.6259 80.8019Z`;
      break;
    case 'nesw-resize':
      // bottom_left_corner.svg - 북동-남서 대각선
      outlinePath = `M143.59 80.5377L110.974 47.5115L208.661 47.6633L208.81 146.578L176.056 113.389L129.075 160.896L112.773 177.421L145.561 210.61L47.7251 210.61V111.532L80.3526 144.546L143.59 80.5377Z`;
      fillPath = `M160.109 80.8019L138.897 59.5825L197.568 59.7682L197.73 118.435L176.355 97.0647L96.2637 177.125L117.662 198.519L58.7939 198.519L58.794 139.654L80.0295 160.874L160.109 80.8019Z`;
      break;
  }

  const shadowPaths = shadowLayers
    .map(
      (layer) =>
        `<path fill-rule="evenodd" clip-rule="evenodd" d="${outlinePath}" fill="#000000" fill-opacity="${layer.opacity}" transform="translate(0 ${layer.dy})"/>`,
    )
    .join('');

  // SVG 생성 - 동적 크기, 257x257 viewBox로 선명도 유지 (apple_cursor 원본)
  const svg = `<svg width="${cursorSize}" height="${cursorSize}" viewBox="0 0 257 257" fill="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision"><g>${shadowPaths}<path fill-rule="evenodd" clip-rule="evenodd" d="${outlinePath}" fill="${outline_color}"/><path fill-rule="evenodd" clip-rule="evenodd" d="${fillPath}" fill="${fill_color}"/></g></svg>`;
  return { svg, cursorSize, hotspot };
}

function createCursorSvg(type: CursorType, settings: CursorSettings): string {
  const { svg, hotspot } = createCursorSvgMarkup(type, settings);
  const encoded = encodeURIComponent(svg);
  return `url("data:image/svg+xml,${encoded}") ${hotspot} ${hotspot}, ${type}`;
}

function cursorVarName(type: CursorType): string {
  return `${CURSOR_VAR_PREFIX}${type}`;
}

function applyCursorCssVariables(cursors: Map<CursorType, string>): void {
  if (typeof document === 'undefined') return;
  const rootStyle = document.documentElement.style;
  for (const [type, value] of cursors.entries()) {
    rootStyle.setProperty(cursorVarName(type), value);
  }
}

function ensureOverlayRoot(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (overlayState.root) return overlayState.root;

  const root = document.createElement('div');
  root.id = CURSOR_OVERLAY_ID;
  root.setAttribute('aria-hidden', 'true');
  root.style.position = 'fixed';
  root.style.left = '0';
  root.style.top = '0';
  root.style.width = '0';
  root.style.height = '0';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '2147483647';
  root.style.transform = 'translate3d(0, 0, 0)';
  root.style.willChange = 'transform';
  root.style.display = 'none';

  document.body?.appendChild(root);
  overlayState.root = root;
  return root;
}

function setBodyCursorHidden(hidden: boolean): void {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (!body) return;
  body.classList.toggle(CURSOR_BODY_CLASS, hidden);
}

function applyOverlayPosition(): void {
  const root = overlayState.root;
  const pointer = overlayState.lastPointer;
  if (!root || !pointer) return;

  const x = Math.round(pointer.x - overlayState.hotspot);
  const y = Math.round(pointer.y - overlayState.hotspot);
  root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function scheduleOverlayPosition(): void {
  if (overlayState.rafId !== null) return;
  overlayState.rafId = window.requestAnimationFrame(() => {
    overlayState.rafId = null;
    applyOverlayPosition();
  });
}

function handlePointerMove(event: MouseEvent): void {
  overlayState.lastPointer = { x: event.clientX, y: event.clientY };
  scheduleOverlayPosition();
}

function handleWindowBlur(): void {
  overlayState.hoverType = null;
  overlayState.lockedType = null;
  updateOverlay();
}

function attachPointerListener(): void {
  if (overlayState.listenerAttached || typeof document === 'undefined') return;
  document.addEventListener('mousemove', handlePointerMove, { passive: true });
  window.addEventListener('blur', handleWindowBlur);
  overlayState.listenerAttached = true;
}

function detachPointerListener(): void {
  if (!overlayState.listenerAttached || typeof document === 'undefined') return;
  document.removeEventListener('mousemove', handlePointerMove);
  window.removeEventListener('blur', handleWindowBlur);
  overlayState.listenerAttached = false;
  if (overlayState.rafId !== null) {
    window.cancelAnimationFrame(overlayState.rafId);
    overlayState.rafId = null;
  }
}

function updateOverlay(event?: MouseEvent | PointerEvent): void {
  if (!isMac()) return;

  const desiredType = overlayState.lockedType ?? overlayState.hoverType;
  if (!desiredType) {
    const root = overlayState.root;
    if (root) {
      root.style.display = 'none';
    }
    overlayState.activeType = null;
    setBodyCursorHidden(false);
    detachPointerListener();
    return;
  }

  const root = ensureOverlayRoot();
  if (!root) return;

  const settings = cachedSettings ?? getDefaultCursorSettings();
  const renderKey = `${desiredType}|${settings.size}|${settings.base_size}|${settings.fill_color}|${settings.outline_color}`;

  if (overlayState.renderKey !== renderKey) {
    const { svg, cursorSize, hotspot } = createCursorSvgMarkup(
      desiredType,
      settings,
    );
    root.innerHTML = svg;
    root.style.width = `${cursorSize}px`;
    root.style.height = `${cursorSize}px`;
    overlayState.hotspot = hotspot;
    overlayState.renderKey = renderKey;
  }

  overlayState.activeType = desiredType;
  root.style.display = 'block';
  setBodyCursorHidden(true);
  attachPointerListener();

  if (event) {
    overlayState.lastPointer = { x: event.clientX, y: event.clientY };
    applyOverlayPosition();
  } else {
    scheduleOverlayPosition();
  }
}

function refreshOverlayAppearance(): void {
  if (!overlayState.hoverType && !overlayState.lockedType) {
    return;
  }
  updateOverlay();
}

/**
 * 커서 시스템을 초기화합니다.
 * 앱 시작 시 한 번 호출하여 설정을 캐싱합니다.
 */
export async function initializeCursorSystem(): Promise<void> {
  if (!isMac()) {
    cachedSettings = null;
    cachedCursors = null;
    return;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    cachedSettings = await fetchCursorSettings();
    cachedCursors = new Map();

    const cursorTypes: CursorType[] = [
      'ns-resize',
      'ew-resize',
      'nwse-resize',
      'nesw-resize',
    ];
    for (const type of cursorTypes) {
      const cursorUrl = createCursorSvg(type, cachedSettings);
      cachedCursors.set(type, cursorUrl);
    }
    applyCursorCssVariables(cachedCursors);
    refreshOverlayAppearance();
  })();

  return initPromise;
}

/**
 * 커서 설정을 다시 가져와 캐시를 갱신합니다.
 * 시스템 설정 변경 시 호출합니다.
 */
export async function refreshCursorSettings(): Promise<void> {
  initPromise = null;
  await initializeCursorSystem();
}

/**
 * macOS 커스텀 커서 오버레이를 호버 상태로 표시합니다.
 */
export function setCustomCursorHover(
  cursorType: CursorType | null,
  event?: MouseEvent | PointerEvent,
): void {
  if (!isMac()) return;
  overlayState.hoverType = cursorType;
  updateOverlay(event);
}

/**
 * macOS 커스텀 커서를 잠금(드래그 중) 상태로 고정합니다.
 */
export function lockCustomCursor(
  cursorType: CursorType,
  event?: MouseEvent | PointerEvent,
): void {
  if (!isMac()) return;
  overlayState.lockedType = cursorType;
  updateOverlay(event);
}

/**
 * macOS 커스텀 커서 잠금을 해제합니다.
 */
export function unlockCustomCursor(event?: MouseEvent | PointerEvent): void {
  if (!isMac()) return;
  overlayState.lockedType = null;
  updateOverlay(event);
}

/**
 * 플랫폼에 맞는 커서 스타일을 반환합니다.
 * - macOS: 시스템 설정을 반영한 커스텀 SVG 커서
 * - Windows/Linux: 기본 CSS 커서
 */
export function getCursor(cursorType: CursorType): string {
  if (!isMac()) {
    return cursorType;
  }

  return `var(${cursorVarName(cursorType)}, ${cursorType})`;
}

/**
 * 현재 캐시된 커서 설정을 반환합니다.
 */
export function getCachedSettings(): CursorSettings | null {
  return cachedSettings;
}

/**
 * 커서 시스템 초기화 여부를 반환합니다.
 */
export function isCursorSystemInitialized(): boolean {
  return cachedCursors !== null;
}
