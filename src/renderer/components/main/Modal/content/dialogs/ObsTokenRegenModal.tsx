import React from 'react';
import Modal from '@components/main/Modal/Modal';

interface ObsTokenRegenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
}

export function ObsTokenRegenModal({
  isOpen,
  onClose,
  onConfirm,
  t,
}: ObsTokenRegenModalProps) {
  if (!isOpen) return null;

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col w-[380px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] p-[20px] gap-[16px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-[8px]">
          <span className="text-style-3 text-[#FFFFFF] !leading-[1.5]">
            {t('settings.obsTokenRegenMessage')}
          </span>
        </div>

        <div className="flex flex-col gap-[8px] p-[12px] bg-[#141318] border-[1px] border-[#2F2E36] rounded-[8px]">
          <span className="text-style-2 text-[#D1D5DB] !leading-[1.4]">
            {t('settings.obsTokenRegenWarning')}
          </span>
        </div>

        <div className="flex items-center gap-[8px]">
          <button
            className="flex-1 h-[30px] bg-[#DC2626] border-[1px] border-[#991B1B] rounded-[7px] text-style-3 text-[#FFFFFF] hover:bg-[#B91C1C] transition-colors"
            onClick={onConfirm}
          >
            {t('settings.obsTokenRegenConfirm')}
          </button>
          <button
            className="flex-1 h-[30px] bg-[#2A2A31] rounded-[7px] text-style-3 text-[#DBDEE8] hover:bg-[#34343c] transition-colors"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
