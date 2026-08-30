import { useEffect, useRef } from 'react';
import { LogicalPosition, PhysicalPosition } from '@tauri-apps/api/dpi';
import { Menu } from '@tauri-apps/api/menu';
import {
  currentMonitor,
  getCurrentWindow,
  Window as TauriWindow,
} from '@tauri-apps/api/window';
import { appApi, windowApi } from '@api/modules/appApi';
import { overlayApi } from '@api/modules/overlayApi';
import { settingsApi } from '@api/modules/settingsApi';
import { subscribeHitContextMenu } from './useOverlayHitRegions';
import type { CustomTab } from '@src/types/key/keys';

interface UseOverlayContextMenuRuntimeOptions {
  alwaysOnTop: boolean;
  trayEnabled: boolean;
  setAlwaysOnTop: (value: boolean) => void;
  selectedKeyType: string;
  customTabs: CustomTab[];
  setSelectedKeyType: (keyType: string) => void;
  t: (key: string) => string;
}

export const useOverlayContextMenuRuntime = ({
  alwaysOnTop,
  trayEnabled,
  setAlwaysOnTop,
  selectedKeyType,
  customTabs,
  setSelectedKeyType,
  t,
}: UseOverlayContextMenuRuntimeOptions) => {
  const resolveCanOpenMainSettings = async () => {
    if (!trayEnabled) {
      return false;
    }

    try {
      const mainWindow = await TauriWindow.getByLabel('main');
      if (!mainWindow) {
        return false;
      }
      const isMainVisible = await mainWindow.isVisible();
      return !isMainVisible;
    } catch (error) {
      console.error('Failed to resolve main window visibility', error);
      return false;
    }
  };

  // 탭 목록 (기본 탭 + 커스텀 탭)
  const BUILTIN_TABS = ['4key', '5key', '6key', '8key'].map((id) => {
    const num = id.replace('key', '');
    return { id, name: t(`mode.button${num}`) };
  });

  const closeOverlayWindow = async () => {
    try {
      await overlayApi.setVisible(false);
    } catch (error) {
      console.error('Failed to close overlay window', error);
    }
  };

  const toggleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      await settingsApi.update({ alwaysOnTop: next });
    } catch (error) {
      console.error('Failed to toggle always-on-top', error);
      setAlwaysOnTop(!next);
    }
  };

  const openSettingsWindow = async () => {
    try {
      await windowApi.showMain();
    } catch (error) {
      console.error('Failed to open settings window', error);
    }
  };

  const quitApplication = async () => {
    try {
      await appApi.quit();
    } catch (error) {
      console.error('Failed to quit application', error);
    }
  };

  const snapToNearestEdge = async () => {
    try {
      const win = getCurrentWindow();
      const [monitor, pos, size] = await Promise.all([
        currentMonitor(),
        win.outerPosition(),
        win.outerSize(),
      ]);
      if (!monitor) return;

      // 화면 끝 기준 - 오버레이는 항상 위 표시라 독·작업 표시줄 위에 그려진다
      const monitorPos = monitor.position;
      const monitorSize = monitor.size;

      // 창의 중심 좌표
      const centerX = pos.x + size.width / 2;
      const centerY = pos.y + size.height / 2;

      // 모니터의 중심 좌표
      const monitorCenterX = monitorPos.x + monitorSize.width / 2;
      const monitorCenterY = monitorPos.y + monitorSize.height / 2;

      // 가장 가까운 모서리 결정
      const snapLeft = centerX < monitorCenterX;
      const snapTop = centerY < monitorCenterY;

      // 창이 화면보다 크면 우·하단 정렬 값이 시작점보다 앞서므로 좌·상단으로 고정
      const newX = snapLeft
        ? monitorPos.x
        : Math.max(monitorPos.x, monitorPos.x + monitorSize.width - size.width);
      const newY = snapTop
        ? monitorPos.y
        : Math.max(
            monitorPos.y,
            monitorPos.y + monitorSize.height - size.height,
          );

      await win.setPosition(new PhysicalPosition(newX, newY));
    } catch (error) {
      console.error('Failed to snap overlay to edge', error);
    }
  };

  const openOverlayContextMenuAtImpl = useRef<
    (x: number, y: number) => Promise<void>
  >(async () => {});
  const contextMenuOpenRef = useRef(false);
  openOverlayContextMenuAtImpl.current = async (x: number, y: number) => {
    const canOpenMainSettings = await resolveCanOpenMainSettings();
    const allTabs = [
      ...BUILTIN_TABS,
      ...customTabs.map((tab) => ({ id: tab.id, name: tab.name })),
    ];

    let menu: Menu | null = null;
    try {
      menu = await Menu.new({
        items: [
          {
            id: 'toggleAlwaysOnTop',
            text: t('settings.alwaysOnTop'),
            checked: alwaysOnTop,
            action: () => {
              void toggleAlwaysOnTop();
            },
          },
          { item: 'Separator' },
          {
            id: 'selectTab',
            text: t('contextMenu.selectTab'),
            items: allTabs.map((tab) => ({
              id: `selectTab-${tab.id}`,
              text: tab.name,
              checked: tab.id === selectedKeyType,
              action: () => {
                setSelectedKeyType(tab.id);
              },
            })),
          },
          {
            id: 'closeOverlay',
            text: t('tooltip.overlayClose'),
            action: () => {
              void closeOverlayWindow();
            },
          },
          {
            id: 'snapToEdge',
            text: t('contextMenu.snapToEdge'),
            action: () => {
              void snapToNearestEdge();
            },
          },
          { item: 'Separator' },
          {
            id: 'openSettingsWindow',
            text: t('tooltip.settings'),
            enabled: canOpenMainSettings,
            action: () => {
              void openSettingsWindow();
            },
          },
          { item: 'Separator' },
          {
            id: 'quitApplication',
            text: t('contextMenu.quitApp'),
            action: () => {
              void quitApplication();
            },
          },
        ],
      });

      await menu.popup(
        new LogicalPosition(Math.round(x), Math.round(y)),
        getCurrentWindow(),
      );
    } catch (error) {
      console.error('Failed to open native overlay context menu', error);
    } finally {
      if (menu) {
        await menu.close().catch(() => {});
      }
    }
  };
  const openOverlayContextMenuAt = async (x: number, y: number) => {
    if (contextMenuOpenRef.current) return;
    contextMenuOpenRef.current = true;
    try {
      await openOverlayContextMenuAtImpl.current(x, y);
    } finally {
      contextMenuOpenRef.current = false;
    }
  };

  // 본체 창은 상시 클릭 통과라 웹뷰가 우클릭을 못 받는다 - 히트 창이 emit한
  // 좌표로 기존 네이티브 메뉴를 연다
  useEffect(() => {
    const unsubscribe = subscribeHitContextMenu(({ x, y }) => {
      void openOverlayContextMenuAt(x, y);
    });
    return () => {
      unsubscribe();
    };
  }, []);
};
