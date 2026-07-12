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
    <Modal onClick={onClose} ariaLabel={t('tabs.createTitle')}>
      <div
        className="flex flex-col w-[280px] p-[14px] gap-[12px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-title text-fg">{t('tabs.createTitle')}</div>
        {/* 인풋·에러 묶음 — 에러는 인풋에 밀착 */}
        <div className="flex flex-col gap-[6px]">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            className="w-full min-w-0 h-[30px] px-[12px] rounded-surface bg-inset text-fg text-body focus:shadow-focus-ring"
            placeholder={t('tabs.name.placeholder')}
          />
          {error && <div className="text-danger text-body">{error}</div>}
        </div>
        <div className="flex gap-[8px]">
          <button
            className="flex-[2] h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast"
            onClick={handleSubmit}
          >
            {t('tabs.create')}
          </button>
          <button
            className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
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
