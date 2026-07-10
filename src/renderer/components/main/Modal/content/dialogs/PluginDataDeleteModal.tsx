import React from 'react';
import Modal from '@components/main/Modal/Modal';

interface PluginDataDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeleteWithData: () => void;
  onDeletePluginOnly: () => void;
  pluginName: string;
  t: (key: string, params?: Record<string, string>) => string;
}

export function PluginDataDeleteModal({
  isOpen,
  onClose,
  onDeleteWithData,
  onDeletePluginOnly,
  pluginName,
  t,
}: PluginDataDeleteModalProps) {
  if (!isOpen) return null;

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col w-[380px] bg-glass-heavy backdrop-blur-[32px] rounded-[14px] shadow-elevation-3 p-[20px] gap-[16px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-[8px]">
          {/* <span className="text-style-3 text-fg">
            {t("settings.pluginDataDeleteTitle")}
          </span> */}
          <span className="text-style-3 text-fg !leading-[1.5]">
            {t('settings.pluginDataDeleteMessage', { name: pluginName })}
          </span>
        </div>

        <div className="flex flex-col gap-[8px] p-[12px] bg-inset rounded-[8px]">
          <div className="flex items-start gap-[8px]">
            <span className="text-style-3 text-warning mt-[6px]">⚠️</span>
            <span className="text-style-2 text-fg !leading-[1.2]">
              {t('settings.pluginDataDeleteWarning')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-[8px]">
          <button
            className="flex-1 h-[30px] bg-danger border-[1px] border-danger-active rounded-md text-style-3 text-fg hover:bg-danger-active transition-colors"
            onClick={onDeleteWithData}
          >
            {t('settings.deleteWithData')}
          </button>
          <button
            className="flex-1 h-[30px] bg-white/[0.07] rounded-md text-style-3 text-fg hover:bg-white/[0.1] transition-colors"
            onClick={onDeletePluginOnly}
          >
            {t('settings.deletePluginOnly')}
          </button>
          <button
            className="h-[30px] px-[12px] bg-white/[0.07] rounded-md text-style-3 text-fg hover:bg-white/[0.1] transition-colors"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
