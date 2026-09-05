import { createPortal } from 'react-dom';
import { useRef, useState, type MouseEvent, type RefObject } from 'react';
import ListPopup, { type ListItem } from '../main/Modal/ListPopup';
import { usePopupPresence } from '@hooks/ui/usePopupPresence';
import { useKeyStore } from '@stores/data/useKeyStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { commitStableLayerZOrder } from '@src/renderer/editor/runtime/layerZOrderIntent';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import type {
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';
import { sendBridgeMessageBestEffort } from '@utils/plugin/bridgeMessages';
import { evaluatePluginMenuItems } from '@utils/plugin/pluginElementContextMenu';
import { translatePluginMessage } from '@utils/plugin/pluginI18n';
import {
  getPluginMenuRuntimeState,
  normalizeStateKeys,
} from '@utils/plugin/pluginMenuRuntimeState';

interface SelectionContextMenuPayload {
  elementId: string;
  clientX: number;
  clientY: number;
  referenceElement: HTMLDivElement | null;
}

interface UsePluginElementContextMenuProps {
  element: PluginDisplayElementInternal;
  definition: PluginDefinitionInternal | undefined;
  windowType: 'main' | 'overlay';
  locale: string;
  containerRef: RefObject<HTMLDivElement | null>;
  onSelectionContextMenu?: (payload: SelectionContextMenuPayload) => boolean;
  t: (key: string) => string;
}

const observePluginAction = (result: unknown, label: string) => {
  if (
    typeof result === 'object' &&
    result !== null &&
    'then' in result &&
    typeof result.then === 'function'
  ) {
    void Promise.resolve(result).catch((error) =>
      console.error(`[PluginElement] ${label} failed`, error),
    );
  }
};

const createActionsProxy = (elementId: string) =>
  new Proxy(
    {},
    {
      get: (_target, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]) => {
          sendBridgeMessageBestEffort(
            'overlay',
            'plugin:displayElement:invokeAction',
            {
              elementId,
              action: prop,
              args,
            },
          );
        };
      },
    },
  );

export const usePluginElementContextMenu = ({
  element,
  definition,
  windowType,
  locale,
  containerRef,
  onSelectionContextMenu,
  t,
}: UsePluginElementContextMenuProps) => {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  // 표시와 index 디스패치가 동일 배열을 보도록 열림 시점 항목 동결
  const [frozenCustomItems, setFrozenCustomItems] =
    useState<
      NonNullable<PluginDisplayElementInternal['contextMenu']>['customItems']
    >(undefined);
  const [menuPredicateErrors] = useState(() => new Set<string>());
  const deleteInFlightRef = useRef(false);
  const contextMenuPresence = usePopupPresence(contextMenuOpen);

  const pluginTranslate = (
    key: string,
    params?: Record<string, string | number>,
    fallback?: string,
  ) =>
    translatePluginMessage({
      messages: definition?.messages,
      locale,
      key,
      params,
      fallback,
    });

  const deletePluginElement = () => {
    if (deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    try {
      if (element.onDelete && typeof element.onDelete === 'string') {
        const handler = (window as unknown as Record<string, unknown>)[
          element.onDelete
        ];
        if (typeof handler === 'function') {
          observePluginAction(handler(), 'onDelete');
        }
      }
    } catch (error) {
      console.error('[PluginElement] onDelete failed', error);
    }
    try {
      if (window.api?.ui?.displayElement) {
        window.api.ui.displayElement.remove(element.fullId);
      } else {
        usePluginDisplayElementStore.getState().removeElement(element.fullId);
      }
    } catch (error) {
      deleteInFlightRef.current = false;
      console.error('[PluginElement] remove failed', error);
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (windowType !== 'main') {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const handledBySelectionMenu =
      onSelectionContextMenu?.({
        elementId: element.fullId,
        clientX: event.clientX,
        clientY: event.clientY,
        referenceElement: containerRef.current,
      }) === true;
    if (handledBySelectionMenu || !element.contextMenu) return;

    setFrozenCustomItems(element.contextMenu.customItems ?? []);
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
    setContextMenuOpen(true);
  };

  const contextMenuItems: ListItem[] = (() => {
    if (!contextMenuPresence.mounted || !element.contextMenu) return [];

    const { enableDelete = true, deleteLabel = '삭제' } = element.contextMenu;
    const customItems =
      frozenCustomItems ?? element.contextMenu.customItems ?? [];
    const menuStateKeys = normalizeStateKeys(definition?.contextMenuStateKeys);
    const menuElement =
      menuStateKeys.length > 0
        ? {
            ...element,
            state: {
              ...element.state,
              ...getPluginMenuRuntimeState(element.fullId, menuStateKeys),
            },
          }
        : element;
    const { top, bottom } = evaluatePluginMenuItems(
      customItems,
      { element: menuElement, actions: createActionsProxy(element.fullId) },
      (label) => pluginTranslate(label, undefined, label),
      (index, kind, error) => {
        const errorKey = `${element.fullId}:${index}:${kind}`;
        if (menuPredicateErrors.has(errorKey)) return;
        menuPredicateErrors.add(errorKey);
        console.error(
          `[Plugin ${element.pluginId}] Failed to evaluate context menu "${kind}" for item ${index}:`,
          error,
        );
      },
    );
    const items: ListItem[] = [...top];
    if (enableDelete) {
      items.push({
        id: 'delete',
        label: pluginTranslate(deleteLabel, undefined, deleteLabel),
      });
    }
    items.push(
      { id: 'bringToFront', label: t('contextMenu.bringToFront') },
      { id: 'sendToBack', label: t('contextMenu.sendToBack') },
    );
    items.push(...bottom);
    return items;
  })();

  const handleContextMenuSelect = (itemId: string) => {
    const commitLayerOrder = (
      action: 'front' | 'forward' | 'backward' | 'back',
    ) => {
      void commitStableLayerZOrder({
        mode: element.tabId ?? useKeyStore.getState().selectedKeyType,
        targets: [{ type: 'plugin', id: element.fullId }],
        action,
      }).catch(reportElementOpError);
    };

    if (itemId === 'delete') {
      deletePluginElement();
    } else if (itemId === 'bringToFront') {
      commitLayerOrder('front');
    } else if (itemId === 'bringForward') {
      commitLayerOrder('forward');
    } else if (itemId === 'sendBackward') {
      commitLayerOrder('backward');
    } else if (itemId === 'sendToBack') {
      commitLayerOrder('back');
    } else if (itemId.startsWith('custom-')) {
      const index = parseInt(itemId.replace('custom-', ''), 10);
      const customItem = frozenCustomItems?.[index];
      if (!customItem) return;
      try {
        observePluginAction(
          customItem.onClick({
            element,
            actions: createActionsProxy(element.fullId),
          }),
          `context action ${index}`,
        );
      } catch (error) {
        console.error(`[PluginElement] context action ${index} failed`, error);
      }
    }
  };

  const contextMenu =
    windowType === 'main' && element.contextMenu && contextMenuPresence.mounted
      ? createPortal(
          <ListPopup
            open={contextMenuOpen}
            ariaLabel={t('common.more')}
            position={contextMenuPosition}
            onClose={() => setContextMenuOpen(false)}
            items={contextMenuItems}
            onSelect={handleContextMenuSelect}
          />,
          document.body,
        )
      : null;

  return { contextMenu, deletePluginElement, handleContextMenu };
};
