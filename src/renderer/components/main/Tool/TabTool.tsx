import { useKeyStore } from "@stores/useKeyStore";
import { useTranslation } from "react-i18next";

const TabTool = () => {
  const keyTypes = ["4key", "5key", "6key", "8key"];
  const { t } = useTranslation();
  const { selectedKeyType, setSelectedKeyType } = useKeyStore();

  return (
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
