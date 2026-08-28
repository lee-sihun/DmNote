import { useKeyStore } from '@stores/data/useKeyStore';
import TabGridIcon from './icons/TabGridIcon';
import { useTranslation } from '@contexts/useTranslation';
import { useIconMotion } from '@hooks/useIconMotion';
import { useState, useRef } from 'react';
import FloatingPopup from '../Modal/FloatingPopup';
import { CANVAS_POPUP_CHROME_CLASS } from '../Modal/popupChrome';
import TabList from '../Modal/content/settings/TabList';

const TabTool = () => {
  const keyTypes = ['4key', '5key', '6key', '8key'];
  const { t } = useTranslation();
  const { selectedKeyType, setSelectedKeyType, isBootstrapped } = useKeyStore();
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const gridButtonRef = useRef(null);
  const isCustomSelected = !keyTypes.includes(selectedKeyType);
  const { motionProps } = useIconMotion();

  return (
    <div className="flex gap-[8px]">
      <div className="flex items-center h-[40px] p-[5px] bg-fill-faint rounded-surface gap-[4px]">
        {keyTypes.map((keyType) => {
          const num = keyType.replace('key', '');
          const label = t(`mode.button${num}`);
          return (
            <Button
              key={keyType}
              text={label}
              isSelected={selectedKeyType === keyType}
              disabled={!isBootstrapped}
              onClick={() => {
                if (!isBootstrapped) return;
                setSelectedKeyType(keyType);
              }}
            />
          );
        })}
      </div>
      <button
        ref={gridButtonRef}
        type="button"
        aria-label={t('tabs.title')}
        title={t('tabs.title')}
        className="flex items-center justify-center w-[40px] h-[40px] p-[5px] bg-fill-faint rounded-surface"
        onClick={() => {
          if (!isBootstrapped) return;
          setIsPopupOpen((prev) => !prev);
        }}
        disabled={!isBootstrapped}
        {...motionProps}
      >
        <div
          className={`w-[30px] h-[30px] flex items-center justify-center rounded-md transition-colors duration-fast ${
            isCustomSelected
              ? 'bg-fill-hover text-fg'
              : 'text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover'
          } ${!isBootstrapped ? 'opacity-40' : ''}`}
        >
          <TabGridIcon />
        </div>
      </button>
      <FloatingPopup
        // TabList가 자기 흐름에서 이름·삭제 모달을 연다 - 덮임 자동 닫힘이 그 모달까지
        // 언마운트한다. 이 팝업은 툴바 서브트리 안(z 40 < 모달 50)이라 잠금 시 inert·딤
        // 처리되므로 유령이 되지 않는다 (PickerSurface와 같은 근거)
        closeOnModalCover={false}
        open={isPopupOpen && isBootstrapped}
        ariaLabel={t('tabs.title')}
        referenceRef={gridButtonRef}
        placement="bottom"
        initialFocus="surface"
        onClose={() => setIsPopupOpen(false)}
        contentMountStrategy="after-paint"
        // 글래스와 모션은 팝업 표면이 소유 - ListPopup과 같은 구조.
        // 담는 것이 메뉴 행뿐이라 표면도 메뉴 계열을 그대로 쓴다.
        // 패딩 5px = 갭 4px + inset 링 1px 보정 - 링이 패딩 최외곽을 덮어
        // 같은 값이면 가장자리만 1px 좁아 보인다
        className={`dmn-motion flex flex-col gap-[4px] w-[180px] p-[5px] ${CANVAS_POPUP_CHROME_CLASS} rounded-surface`}
      >
        <TabList />
      </FloatingPopup>
    </div>
  );
};

interface ButtonProps {
  text: string;
  isSelected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

const Button = ({
  text,
  isSelected = false,
  onClick,
  disabled,
}: ButtonProps) => {
  return (
    <button
      type="button"
      className={`flex items-center h-[30px] px-[10px] rounded-md transition-colors duration-fast ${
        isSelected
          ? 'bg-fill-hover text-fg'
          : 'text-fg-muted hover:bg-fill hover:text-fg'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="text-label">{text}</span>
    </button>
  );
};

export default TabTool;
