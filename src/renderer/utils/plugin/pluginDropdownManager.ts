import { clampToViewport } from '@utils/ui/popupGeometry';
import {
  hasModalLayerAbove,
  isTopmostPopupLayer,
  registerPopupLayer,
  subscribeModalLayerActivity,
} from '@components/main/Modal/popupLayer';

type DropdownMenuElement = HTMLElement & {
  __pluginPlaceholder?: HTMLElement | null;
  __pluginDropdown?: HTMLElement | null;
};

type DropdownContainerElement = HTMLElement & {
  __pluginDropdownMenuRef?: DropdownMenuElement | null;
};

const VIEWPORT_PADDING = 8;
const MENU_MARGIN = 4;

const restoreMenuToDropdown = (menu: DropdownMenuElement) => {
  const placeholder = menu.__pluginPlaceholder;
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.insertBefore(menu, placeholder);
    placeholder.remove();
  }
  menu.__pluginPlaceholder = null;
  menu.__pluginDropdown = null;
};

const resetMenuStyles = (menu: DropdownMenuElement) => {
  menu.style.position = '';
  menu.style.left = '';
  menu.style.top = '';
  menu.style.width = '';
  menu.style.maxHeight = '';
  menu.style.overflowY = '';
  menu.style.zIndex = '';
  menu.style.boxShadow = '';
  menu.style.borderRadius = '';
  menu.dataset.pluginDropdownPortal = 'false';
  delete menu.dataset.dmnPopupSubmenu;
};

type DropdownRoot = HTMLElement | ShadowRoot;

const registeredRoots = new Map<DropdownRoot, number>();
const openMenus = new Set<DropdownMenuElement>();
// 열린 메뉴의 팝업 레이어 해제 - Dropdown/FloatingPopup과 같은 스택에 서서 Escape
// 소유권과 모달 덮임 판정을 공유한다 (z 60이라 모달 위에 남는 유일한 표면이었다)
const menuLayerReleases = new WeakMap<DropdownMenuElement, () => void>();
let unsubscribeModalActivity: (() => void) | null = null;
let observer: MutationObserver | null = null;
let listenersAttached = false;

const rootContains = (root: DropdownRoot, node: Node) => root.contains(node);
const isRootConnected = (root: DropdownRoot) =>
  root instanceof ShadowRoot ? root.host.isConnected : root.isConnected;

const closeMenu = (menu: DropdownMenuElement) => {
  if (!openMenus.has(menu)) return;
  menuLayerReleases.get(menu)?.();
  menuLayerReleases.delete(menu);
  const dropdown = menu.__pluginDropdown as DropdownContainerElement | null;
  menu.classList.add('hidden');
  menu.classList.remove('flex');
  resetMenuStyles(menu);
  restoreMenuToDropdown(menu);
  if (dropdown) dropdown.__pluginDropdownMenuRef = null;
  const arrow = dropdown?.querySelector('svg');
  if (arrow) arrow.style.transform = 'rotate(0deg)';
  openMenus.delete(menu);
};

const closeAllMenus = () => {
  [...openMenus].forEach(closeMenu);
};

const measureAndPositionMenu = (
  menu: DropdownMenuElement,
  toggleBtn: HTMLElement,
  dropdown: HTMLElement,
) => {
  menu.style.width = `${dropdown.getBoundingClientRect().width}px`;
  requestAnimationFrame(() => {
    if (!openMenus.has(menu) || !toggleBtn.isConnected) return;
    const buttonRect = toggleBtn.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const left = clampToViewport(
      buttonRect.left,
      menuWidth,
      window.innerWidth,
      VIEWPORT_PADDING,
    );
    // 아래 공간이 부족하면 트리거 위로 펼친다
    const below = buttonRect.bottom + MENU_MARGIN;
    const top =
      below + menuHeight > window.innerHeight - VIEWPORT_PADDING
        ? Math.max(VIEWPORT_PADDING, buttonRect.top - menuHeight - MENU_MARGIN)
        : below;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });
};

const openMenu = (
  dropdown: DropdownContainerElement,
  menu: DropdownMenuElement,
  toggleBtn: HTMLElement,
) => {
  closeAllMenus();
  const placeholder = document.createElement('div');
  placeholder.style.display = 'none';
  placeholder.setAttribute('data-plugin-dropdown-placeholder', 'true');
  dropdown.insertBefore(placeholder, menu);
  menu.__pluginPlaceholder = placeholder;
  menu.__pluginDropdown = dropdown;
  dropdown.__pluginDropdownMenuRef = menu;
  document.body.appendChild(menu);
  menu.classList.remove('hidden');
  menu.classList.add('flex');
  menu.style.position = 'fixed';
  menu.style.zIndex = 'var(--z-chrome-submenu)';
  menu.style.maxHeight = '200px';
  menu.style.overflowY = 'auto';
  menu.dataset.pluginDropdownPortal = 'true';
  menu.dataset.dmnPopupSubmenu = 'true';
  openMenus.add(menu);
  menuLayerReleases.set(menu, registerPopupLayer(menu));
  const arrow = dropdown.querySelector('svg');
  if (arrow) arrow.style.transform = 'rotate(180deg)';
  measureAndPositionMenu(menu, toggleBtn, dropdown);
};

// 모달이 위에 덮이면 닫는다 - 모달 안(dmn.ui.dialog.custom)에서 연 메뉴는 모달보다
// 뒤에 등록되므로 유지되고, 그 위에 또 모달이 뜨면 닫힌다 (스택 순서 판정)
const closeMenusCoveredByModal = () => {
  [...openMenus].forEach((menu) => {
    if (hasModalLayerAbove(menu)) closeMenu(menu);
  });
};

const belongsToRegisteredRoot = (node: Node) =>
  [...registeredRoots.keys()].some((root) => rootContains(root, node));

const handleClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const toggleBtn = target.closest(
    '[data-dropdown-toggle]',
  ) as HTMLElement | null;
  if (toggleBtn && belongsToRegisteredRoot(toggleBtn)) {
    const dropdown = toggleBtn.closest(
      '.plugin-dropdown',
    ) as DropdownContainerElement | null;
    const menu = dropdown
      ? (dropdown.querySelector(
          '[data-dropdown-menu]',
        ) as DropdownMenuElement | null) ??
        dropdown.__pluginDropdownMenuRef ??
        null
      : null;
    if (dropdown && menu) {
      event.preventDefault();
      event.stopPropagation();
      if (openMenus.has(menu)) closeMenu(menu);
      else openMenu(dropdown, menu, toggleBtn);
    }
    return;
  }

  const menuItem = target.closest(
    '[data-dropdown-menu] button',
  ) as HTMLElement | null;
  if (menuItem) {
    const menu = menuItem.closest(
      '[data-dropdown-menu]',
    ) as DropdownMenuElement | null;
    if (!menu || !openMenus.has(menu)) return;
    event.preventDefault();
    event.stopPropagation();
    const dropdown = menu.__pluginDropdown;
    const display = dropdown?.querySelector(
      '[data-dropdown-toggle] span',
    ) as HTMLElement | null;
    const value = menuItem.getAttribute('data-value') ?? '';
    if (dropdown) {
      dropdown.setAttribute('data-selected', value);
      if (display) display.textContent = menuItem.textContent?.trim() || value;
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeMenu(menu);
    return;
  }

  if (openMenus.size && !target.closest('.plugin-dropdown')) closeAllMenus();
};

const handleScrollOrResize = () => {
  if (openMenus.size) closeAllMenus();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !openMenus.size) {
    return;
  }
  // 위에 모달이 있으면 Escape 소유권은 그쪽 - 한 번에 한 겹씩 닫힌다
  const topmost = [...openMenus].some((menu) => isTopmostPopupLayer(menu));
  if (!topmost) return;
  event.preventDefault();
  closeAllMenus();
};

const detachGlobalListeners = () => {
  if (!listenersAttached) return;
  closeAllMenus();
  unsubscribeModalActivity?.();
  unsubscribeModalActivity = null;
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('scroll', handleScrollOrResize, true);
  window.removeEventListener('resize', handleScrollOrResize);
  observer?.disconnect();
  observer = null;
  listenersAttached = false;
};

const unregisterRoot = (root: DropdownRoot, allRegistrations = false) => {
  const count = registeredRoots.get(root);
  if (!count) return;
  if (!allRegistrations && count > 1) registeredRoots.set(root, count - 1);
  else registeredRoots.delete(root);
  [...openMenus].forEach((menu) => {
    const dropdown = menu.__pluginDropdown;
    if (dropdown && rootContains(root, dropdown)) closeMenu(menu);
  });
  if (registeredRoots.size === 0) detachGlobalListeners();
};

const attachGlobalListeners = () => {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeydown);
  unsubscribeModalActivity = subscribeModalLayerActivity(
    closeMenusCoveredByModal,
  );
  document.addEventListener('scroll', handleScrollOrResize, true);
  window.addEventListener('resize', handleScrollOrResize);
  observer = new MutationObserver(() => {
    [...registeredRoots.keys()].forEach((root) => {
      if (!isRootConnected(root)) unregisterRoot(root, true);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
};

export function setupPluginDropdownInteractions(root: DropdownRoot | null) {
  if (!root) return () => {};
  registeredRoots.set(root, (registeredRoots.get(root) ?? 0) + 1);
  attachGlobalListeners();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unregisterRoot(root);
  };
}
