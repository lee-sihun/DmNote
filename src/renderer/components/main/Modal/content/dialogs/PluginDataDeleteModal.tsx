import React, { useState } from 'react';
import Modal from '@components/main/Modal/Modal';
import { SettingToggleRow } from '@components/main/common/SettingRow';
import { useModalPresence } from '@hooks/ui/usePopupPresence';

interface PluginDataDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (withData: boolean) => void;
  pluginName: string;
  t: (key: string, params?: Record<string, string>) => string;
}

export function PluginDataDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  pluginName,
  t,
}: PluginDataDeleteModalProps) {
  // 퇴장 모션이 도는 동안 DOM을 유지한다
  const { mounted, state: motionState } = useModalPresence(isOpen);
  const [withData, setWithData] = useState(false);
  // 노브를 끄는 동안의 위치까지 반영한 값 - 설명 문구 전용
  const [preview, setPreview] = useState(false);

  // 파괴 범위는 열 때마다 안전한 쪽에서 시작한다. effect가 아니라 렌더 중 조정이라
  // 한 번 더 도는 렌더로 끝나고 연쇄가 없다
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setWithData(false);
      setPreview(false);
    }
  }

  if (!mounted) return null;

  const message = t('settings.pluginDataDeleteMessage', { name: pluginName });

  return (
    <Modal
      motionState={motionState}
      onClick={onClose}
      ariaLabel={t('settings.pluginDataDeleteTitle')}
      contentMountStrategy="after-paint"
    >
      {/* 내용에 맞춰 자라되 상한을 둔다 - 긴 이름은 접히지 않고 말줄임된다 */}
      <div
        className="flex flex-col w-fit min-w-[360px] max-w-[440px] bg-glass-heavy backdrop-glass rounded-modal shadow-elevation-3 p-[14px] gap-[12px]"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-label text-fg truncate" title={message}>
          {message}
        </span>

        {/* 범위 선택은 버튼이 아니라 토글이 받는다 - 삭제 자체는 이미 확정이라
            남은 질문이 하나뿐이고, 버튼은 앱 표준인 삭제·취소 둘로 남는다 */}
        <div className="bg-fill-faint rounded-surface px-[12px]">
          <SettingToggleRow
            label={t('settings.pluginDataDeleteToggle')}
            checked={withData}
            onToggle={() => setWithData((current) => !current)}
            onDisplayChange={setPreview}
          />
        </div>

        {/* 노브가 가리키는 쪽을 따라간다 - 손을 떼기 전에 결과를 읽을 수 있다.
            앞부분은 두 상태가 같은 말이라 고정하고 바뀌는 꼬리만 교체한다 -
            안 그러면 같은 글자가 이유 없이 흔들린다.
            로케일 문장은 "명사구 + 서술부"로 갈리는 것이 전제다 */}
        <span
          className={`text-body transition-colors duration-fast ${
            preview ? 'text-warning' : 'text-fg-faint'
          }`}
        >
          {t('settings.pluginDataScope')}
          <span className="dmn-text-swap" data-state={preview ? 'on' : 'off'}>
            {/* 겹쳐둔 두 꼬리 중 비활성 쪽은 보조기술에서 뺀다 - 안 그러면 두 문장이 이어 읽힌다 */}
            <span data-text="off" aria-hidden={preview}>
              {t('settings.pluginDataKeepTail')}
            </span>
            <span data-text="on" aria-hidden={!preview}>
              {t('settings.pluginDataWipeTail')}
            </span>
          </span>
        </span>

        <div className="flex gap-[8px]">
          <button
            className="flex-[2] h-[30px] bg-danger-muted hover:bg-danger-muted-hover active:bg-danger-muted-active text-danger-fg rounded-surface text-label transition-colors duration-fast"
            onClick={() => onConfirm(withData)}
          >
            {t('contextMenu.delete')}
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
}
