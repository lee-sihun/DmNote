import { useKeyStore } from '@stores/data/useKeyStore';
import GridIcon from '@assets/svgs/grid.svg';
import { useTranslation } from '@contexts/useTranslation';
import { useState, useRef } from 'react';
import FloatingPopup from '../Modal/FloatingPopup';
import TabList from '../Modal/content/settings/TabList';

const TabTool = () => {
  const keyTypes = ['4key', '5key', '6key', '8key'];
  const { t } = useTranslation();
  const { selectedKeyType, setSelectedKeyType, isBootstrapped } = useKeyStore();
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const gridButtonRef = useRef(null);
  const isCustomSelected = !keyTypes.includes(selectedKeyType);

  return (
    <div className="flex gap-[8px]">
      <div className="flex items-center h-[40px] p-[5px] bg-fill rounded-surface gap-[4px]">
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
        className="flex items-center justify-center w-[40px] h-[40px] p-[5px] bg-fill rounded-surface"
        onClick={() => {
          if (!isBootstrapped) return;
          setIsPopupOpen((prev) => !prev);
        }}
        disabled={!isBootstrapped}
      >
        <div
          className={`w-[30px] h-[30px] flex items-center justify-center rounded-md transition-colors duration-fast ${
            isCustomSelected
              ? 'bg-surface-active text-fg'
              : 'text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover'
          } ${!isBootstrapped ? 'opacity-40' : ''}`}
        >
          <GridIcon />
        </div>
      </button>
      <FloatingPopup
        open={isPopupOpen && isBootstrapped}
        referenceRef={gridButtonRef}
        placement="bottom"
        onClose={() => setIsPopupOpen(false)}
      >
        <TabList onClose={() => setIsPopupOpen(false)} />
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
          ? 'bg-surface-active text-fg'
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
