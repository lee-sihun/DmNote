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
};

export function setupPluginDropdownInteractions(
  root: HTMLElement | ShadowRoot | null,
) {
  if (!root) return () => {};

  const openMenus = new Set<DropdownMenuElement>();
  let isCleaningUp = false;

  const closeMenu = (menu: DropdownMenuElement) => {
    if (!openMenus.has(menu)) return;

    const dropdown = menu.__pluginDropdown as DropdownContainerElement | null;

    menu.classList.add('hidden');
    menu.classList.remove('flex');
    resetMenuStyles(menu);
    restoreMenuToDropdown(menu);

    if (dropdown) {
      dropdown.__pluginDropdownMenuRef = null;
    }
    const arrow = dropdown?.querySelector('svg');
    if (arrow) arrow.style.transform = 'rotate(0deg)';

    openMenus.delete(menu);
  };

  const closeAllMenus = () => {
    Array.from(openMenus).forEach((menu) => closeMenu(menu));
  };

  const measureAndPositionMenu = (
    menu: DropdownMenuElement,
    toggleBtn: HTMLElement,
    dropdown: HTMLElement,
  ) => {
    const dropdownRect = dropdown.getBoundingClientRect();
    menu.style.width = `${dropdownRect.width}px`;

    requestAnimationFrame(() => {
      const buttonRect = toggleBtn.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const menuWidth = menu.offsetWidth;
      const menuHeight = menu.offsetHeight;

      let left = buttonRect.left;
      if (left + menuWidth > viewportWidth - VIEWPORT_PADDING) {
        left = viewportWidth - menuWidth - VIEWPORT_PADDING;
      }
      left = Math.max(VIEWPORT_PADDING, left);

      let top = buttonRect.bottom + MENU_MARGIN;
      if (top + menuHeight > viewportHeight - VIEWPORT_PADDING) {
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
    menu.style.zIndex = '10020';
    menu.style.maxHeight = '220px';
    menu.style.overflowY = 'auto';
    menu.style.boxShadow = '0px 12px 30px rgba(0, 0, 0, 0.45)';
    menu.style.borderRadius = '7px';
    menu.dataset.pluginDropdownPortal = 'true';

    openMenus.add(menu);

    const arrow = dropdown.querySelector('svg');
    if (arrow) arrow.style.transform = 'rotate(180deg)';

    measureAndPositionMenu(menu, toggleBtn, dropdown);
  };

  const handleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const toggleBtn = target.closest(
      '[data-dropdown-toggle]',
    ) as HTMLElement | null;

    if (toggleBtn && root.contains(toggleBtn)) {
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

        if (openMenus.has(menu)) {
          closeMenu(menu);
        } else {
          openMenu(dropdown, menu, toggleBtn);
        }
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
        if (display) {
          display.textContent = menuItem.textContent?.trim() || value;
        }
        const changeEvent = new Event('change', { bubbles: true });
        dropdown.dispatchEvent(changeEvent);
      }

      closeMenu(menu);
      return;
    }

    if (openMenus.size && !target.closest('.plugin-dropdown')) {
      closeAllMenus();
    }
  };

  const handleScrollOrResize = () => {
    if (openMenus.size) {
      closeAllMenus();
    }
  };

  document.addEventListener('click', handleClick, true);
  document.addEventListener('scroll', handleScrollOrResize, true);
  window.addEventListener('resize', handleScrollOrResize);

  let observer: MutationObserver | null = null;

  const cleanup = () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    closeAllMenus();
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize);
    observer?.disconnect();
    observer = null;
  };

  observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      cleanup();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  return cleanup;
}
