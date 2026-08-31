import { usePressAction } from '@hooks/usePressAction';
import React, { useEffect, useRef, useState } from 'react';
import Modal from '../../Modal';
import { useModalPresence } from '@hooks/ui/usePopupPresence';
import { useFieldError } from '@hooks/ui/useFieldError';
import { useTranslation } from '@contexts/useTranslation';

interface TabNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    name: string,
  ) => Promise<{ error?: string } | void> | { error?: string } | void;
  existingNames?: string[];
  /** 이름 변경 모드에서 입력에 미리 채울 현재 이름 */
  initialName?: string;
  mode?: 'create' | 'rename';
}

const TabNameModal = ({
  isOpen,
  onClose,
  onSubmit,
  existingNames = [],
  initialName = '',
  mode = 'create',
}: TabNameModalProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { active, shaking, raise, clear, handleAnimationEnd } = useFieldError();

  // 이름 검사와 백엔드 거절이 모두 여기로 모인다.
  // 같은 이유로 다시 막혀도 매번 링과 흔들기를 새로 걸어야 눌린 게 반영됐다는 걸 알 수 있다
  const raiseError = (message: string) => {
    setError(message);
    raise();
  };

  const isRename = mode === 'rename';
  const titleKey = isRename ? 'tabs.renameTitle' : 'tabs.createTitle';

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setError(null);
      setIsSubmitting(false);
      submittingRef.current = false;
      // 퇴장 모션 동안 DOM이 남아 있어 홀드가 끝나기 전에 다시 열릴 수 있다
      clear();
    }
  }, [isOpen, initialName, clear]);

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
      raiseError(err);
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
          'name-too-long': t('tabs.name.max'),
          'reserved-name': t('tabs.name.reserved'),
        };
        raiseError(
          map[res.error] ||
            t(isRename ? 'tabs.errors.renameFail' : 'tabs.errors.createFail'),
        );
        return;
      }
      onClose();
    } catch (submitError) {
      console.error('Failed to submit custom tab name', submitError);
      raiseError(
        t(isRename ? 'tabs.errors.renameFail' : 'tabs.errors.createFail'),
      );
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
      ariaLabel={t(titleKey)}
      contentMountStrategy="after-paint"
    >
      <div
        className="flex flex-col w-[280px] p-[14px] gap-[12px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-title text-fg">{t(titleKey)}</div>
        {/* 인풋·에러 묶음 — 에러는 인풋에 밀착 */}
        <div className="flex flex-col gap-[6px]">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            // 오류 링은 포커스 링을 대체한다. 둘을 겹치면 같은 자리에서 색이 섞인다.
            // 이 입력은 autoFocus라 겹치면 오류 링이 아예 보이지 않는다
            className={`w-full min-w-0 h-[30px] px-[12px] rounded-surface bg-inset text-fg text-body ${
              active ? 'shadow-danger-ring' : 'focus:shadow-focus-ring'
            } ${shaking ? 'dmn-field-shake' : ''}`}
            onAnimationEnd={handleAnimationEnd}
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
            {t(isRename ? 'tabs.rename' : 'tabs.create')}
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
