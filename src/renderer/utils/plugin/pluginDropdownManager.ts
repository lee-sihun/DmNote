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
let observer: MutationObserver | null = null;
let listenersAttached = false;

const rootContains = (root: DropdownRoot, node: Node) => root.contains(node);
const isRootConnected = (root: DropdownRoot) =>
  root instanceof ShadowRoot ? root.host.isConnected : root.isConnected;

const closeMenu = (menu: DropdownMenuElement) => {
  if (!openMenus.has(menu)) return;
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
    let left = buttonRect.left;
    if (left + menuWidth > window.innerWidth - VIEWPORT_PADDING) {
      left = window.innerWidth - menuWidth - VIEWPORT_PADDING;
    }
    left = Math.max(VIEWPORT_PADDING, left);
    let top = buttonRect.bottom + MENU_MARGIN;
    if (top + menuHeight > window.innerHeight - VIEWPORT_PADDING) {
      top = Math.max(
        VIEWPORT_PADDING,
        buttonRect.top - menuHeight - MENU_MARGIN,
      );
    }
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
  menu.style.zIndex = '60';
  menu.style.maxHeight = '200px';
  menu.style.overflowY = 'auto';
  menu.dataset.pluginDropdownPortal = 'true';
  menu.dataset.dmnPopupSubmenu = 'true';
  openMenus.add(menu);
  const arrow = dropdown.querySelector('svg');
  if (arrow) arrow.style.transform = 'rotate(180deg)';
  measureAndPositionMenu(menu, toggleBtn, dropdown);
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
  event.preventDefault();
  closeAllMenus();
};

const detachGlobalListeners = () => {
  if (!listenersAttached) return;
  closeAllMenus();
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
