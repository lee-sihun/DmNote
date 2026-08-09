/* eslint-disable react-hooks/set-state-in-effect */
import { usePressAction } from '@hooks/usePressAction';
import React, { useEffect, useRef, useState } from 'react';
import Modal from '../../Modal';
import { useModalPresence } from '@hooks/ui/usePopupPresence';
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setError(null);
      setIsSubmitting(false);
      submittingRef.current = false;
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
    if (submittingRef.current) return;
    const err = validate(name.trim());
    if (err) {
      setError(err);
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
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
    } catch (submitError) {
      console.error('Failed to create custom tab', submitError);
      setError(t('tabs.errors.createFail'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // IME 조합 종료·onChange flush와의 경합으로 첫 click이 유실되는 것을 방어
  const submitPress = usePressAction(handleSubmit);
  const cancelPress = usePressAction(onClose);

  // 퇴장 모션이 도는 동안 DOM을 유지한다
  const { mounted, state: motionState } = useModalPresence(isOpen);

  if (!mounted) return null;

  return (
    <Modal
      motionState={motionState}
      onClick={onClose}
      ariaLabel={t('tabs.createTitle')}
      contentMountStrategy="after-paint"
    >
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
          {error && <div className="text-danger-fg text-body">{error}</div>}
        </div>
        <div className="flex gap-[8px]">
          <button
            disabled={isSubmitting}
            className="flex-[2] h-[30px] bg-accent-deep hover:bg-accent-deep-hover active:bg-accent-deep-active rounded-surface text-accent-fg text-label transition-colors duration-fast"
            {...submitPress}
          >
            {t('tabs.create')}
          </button>
          <button
            disabled={isSubmitting}
            className="flex-1 h-[30px] bg-fill hover:bg-fill-hover active:bg-fill-active rounded-surface text-fg-muted hover:text-fg text-label transition-colors duration-fast"
            {...cancelPress}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default TabNameModal;
