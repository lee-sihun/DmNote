import { useKeyStore } from "@stores/useKeyStore";
import GridIcon from "@assets/svgs/grid.svg";
import { useTranslation } from "react-i18next";
import { useState, useRef } from "react";
import FloatingPopup from "../modal/FloatingPopup";
import TabList from "../modal/content/TabList";

const TabTool = () => {
  const keyTypes = ["4key", "5key", "6key", "8key"];
  const { t } = useTranslation();
  const { selectedKeyType, setSelectedKeyType } = useKeyStore();
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const gridButtonRef = useRef(null);
  const isCustomSelected = !keyTypes.includes(selectedKeyType);

  return (
    <div className="flex gap-[10px]">
      <div className="flex items-center h-[40px] p-[5px] bg-button-primary rounded-[7px] gap-[5px]">
        {keyTypes.map((keyType) => {
          const num = keyType.replace("key", "");
          const label = t(`mode.button${num}`);
          return (
            <Button
              key={keyType}
              text={label}
              isSelected={selectedKeyType === keyType}
              onClick={() => setSelectedKeyType(keyType)}
            />
          );
        })}
      </div>
      <button
        ref={gridButtonRef}
        className="flex items-center justify-center w-[40px] h-[40px] bg-button-primary rounded-[7px]"
        onClick={() => {
          setIsPopupOpen((prev) => !prev);
        }}
      >
        <div
          className={`w-[30px] h-[30px] flex items-center justify-center rounded-[7px] transition-colors ${
            isCustomSelected
              ? "bg-button-active"
              : "hover:bg-button-hover active:bg-button-active"
          }`}
        >
          <GridIcon />
        </div>
      </button>
      <FloatingPopup
        open={isPopupOpen}
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
}

const Button = ({ text, isSelected = false, onClick }: ButtonProps) => {
  return (
    <button
      type="button"
      className={`flex items-center h-[30px] px-[8px] rounded-[7px] transition-colors ${
        isSelected
          ? "bg-button-active"
          : "bg-button-primary hover:bg-button-hover"
      }`}
      onClick={onClick}
    >
      <span className="text-style-4 text-[#DBDEE8]">{text}</span>
    </button>
  );
};

export default TabTool;
