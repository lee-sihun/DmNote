import React from 'react';
import ManagerModalLayout from '@components/main/Modal/ManagerModalLayout';
import Checkbox from '@components/main/common/Checkbox';
import TrashIcon from '@assets/svgs/trash.svg';

interface Plugin {
  id: string;
  name: string;
  enabled: boolean;
  path?: string;
}

interface PendingPluginAction {
  id: string;
  op: string;
}

interface PluginManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: () => void;
  onToggle: (pluginId: string, enabled: boolean) => void;
  onRemove: (pluginId: string) => void;
  plugins: Plugin[];
  isAdding: boolean;
  pendingPluginAction: PendingPluginAction | null;
  t: (key: string, params?: Record<string, string>) => string;
}

export const PluginManagerModal = ({
  isOpen,
  onClose,
  onAdd,
  onToggle,
  onRemove,
  plugins,
  isAdding,
  pendingPluginAction,
  t,
}: PluginManagerModalProps) => (
  <ManagerModalLayout
    isOpen={isOpen}
    onClose={onClose}
    contentDeps={[plugins.length]}
    footer={
      <>
        <button
          className={`flex items-center justify-center w-[150px] h-[30px] rounded-md text-style-3 text-fg transition-colors ${
            isAdding
              ? 'bg-white/[0.04] cursor-not-allowed opacity-50'
              : 'bg-white/[0.07] hover:bg-white/[0.1]'
          }`}
          onClick={onAdd}
          disabled={isAdding}
        >
          {isAdding
            ? t('settings.adding')
            : `${t('settings.loadJs')} (${plugins.length})`}
        </button>
        <button
          className="flex items-center justify-center w-[75px] h-[30px] bg-white/[0.07] rounded-md text-style-3 text-fg hover:bg-white/[0.1] transition-colors"
          onClick={onClose}
        >
          {t('common.ok')}
        </button>
      </>
    }
  >
    {plugins.length === 0 ? (
      <div className="flex items-center justify-center py-[10px] px-[12px] text-style-2 text-white">
        {t('settings.noPlugins')}
      </div>
    ) : (
      plugins.map((plugin: Plugin) => {
        const isPending =
          pendingPluginAction && pendingPluginAction.id === plugin.id;
        const isRemovePending =
          isPending && pendingPluginAction.op === 'remove';
        return (
          <div
            key={plugin.id}
            className="flex items-center justify-between"
            style={{ transform: 'translateZ(0)' }}
          >
            <div className="flex items-center gap-[10px] h-[23px]">
              <button
                className={`flex items-center justify-center transition-colors ${
                  isRemovePending
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:opacity-80'
                }`}
                onClick={() => {
                  if (!isRemovePending) onRemove(plugin.id);
                }}
                disabled={!!isRemovePending}
                aria-label={t('settings.removePlugin')}
                title={t('settings.removePlugin')}
              >
                <TrashIcon className="w-[14px] h-[15px]" />
              </button>
              <span className="text-white text-style-2">{plugin.name}</span>
            </div>
            <div className="flex items-center justify-center w-[27px] h-[21px]">
              <Checkbox
                checked={plugin.enabled}
                onChange={() => {
                  if (pendingPluginAction) return;
                  onToggle(plugin.id, !plugin.enabled);
                }}
              />
            </div>
          </div>
        );
      })
    )}
  </ManagerModalLayout>
);
