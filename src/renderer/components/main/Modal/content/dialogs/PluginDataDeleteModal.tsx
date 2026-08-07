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
    <Modal
      onClick={onClose}
      ariaLabel={t('settings.pluginDataDeleteTitle')}
      contentMountStrategy="after-paint"
    >
      <div
        className="flex flex-col w-[380px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 p-[14px] gap-[12px]"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-label text-fg !leading-[1.5]">
          {t('settings.pluginDataDeleteMessage', { name: pluginName })}
        </span>

        {/* 경고 카드 */}
        <div className="flex items-start gap-[8px] p-[12px] bg-fill-faint rounded-surface">
          <span className="text-label text-warning mt-[6px]">⚠️</span>
          <span className="text-label text-fg !leading-[1.2]">
            {t('settings.pluginDataDeleteWarning')}
          </span>
        </div>

        <div className="flex items-center gap-[8px]">
          <button
            className="flex-1 h-[30px] bg-danger border-[1px] border-danger-active rounded-surface text-label text-fg hover:bg-danger-active transition-colors duration-fast"
            onClick={onDeleteWithData}
          >
            {t('settings.deleteWithData')}
          </button>
          <button
            className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
            onClick={onDeletePluginOnly}
          >
            {t('settings.deletePluginOnly')}
          </button>
          <button
            className="h-[30px] px-[12px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
