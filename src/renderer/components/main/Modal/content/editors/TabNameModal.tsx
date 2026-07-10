/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState } from 'react';
import Modal from '../../Modal';
import { useTranslation } from '@contexts/useTranslation';

interface TabNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    name: string,
  ) => Promise<{ error?: string } | void> | { error?: string } | void;
  existingNames?: string[];
}

const TabNameModal = ({
  isOpen,
  onClose,
  onSubmit,
  existingNames = [],
}: TabNameModalProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setError(null);
    }
  }, [isOpen]);

  const validate = (() => {
    return (v: string) => {
      if (!v || !v.trim()) return t('tabs.name.required');
      if (v.length > 10) return t('tabs.name.max');
      if (['4key', '5key', '6key', '8key'].includes(v))
        return t('tabs.name.reserved');
      if (existingNames.includes(v)) return t('tabs.name.duplicate');
      return null;
    };
  })();

  const handleSubmit = async () => {
    const err = validate(name.trim());
    if (err) {
      setError(err);
      return;
    }
    const res = await onSubmit(name.trim());
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      const map: Record<string, string> = {
        'max-reached': t('tabs.errors.max'),
        'duplicate-name': t('tabs.name.duplicate'),
        'invalid-name': t('tabs.errors.invalid'),
      };
      setError(map[res.error] || t('tabs.errors.createFail'));
      return;
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col justify-between w-[280px] p-[20px] gap-[19px] bg-elevated rounded-xl border-[1px] border-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-style-3 text-fg">
          {t('tabs.createTitle')}
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
          className="w-full min-w-0 h-[30px] px-[12px] rounded-md bg-inset text-fg text-style-3 border-[1px] border-line focus:border-accent"
          placeholder={t('tabs.name.placeholder')}
        />
        {error && (
          <div className="text-danger text-style-1 my-[-12px]">{error}</div>
        )}
        <div className="flex gap-[8px]">
          <button
            className="flex-1 h-[30px] bg-accent hover:bg-accent-hover active:bg-accent-active rounded-lg text-accent-fg text-label transition-colors duration-fast"
            onClick={handleSubmit}
          >
            {t('tabs.create')}
          </button>
          <button
            className="w-[75px] h-[30px] bg-white/[0.05] hover:bg-white/[0.08] active:bg-white/[0.11] rounded-lg text-fg-muted hover:text-fg text-label transition-colors duration-fast"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default TabNameModal;
