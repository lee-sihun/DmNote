import { useKeyStore } from "@stores/useKeyStore";

const TabTool = () => {
  const keyTypes = ["4key", "5key", "6key", "8key"];
  const { selectedKeyType, setSelectedKeyType } = useKeyStore();

  return (
    <div className="flex items-center h-[40px] p-[5px] bg-[#0E0E11] rounded-[7px] gap-[5px]">
      {keyTypes.map((keyType) => (
        <Button
          key={keyType}
          text={keyType.replace("key", "버튼")}
          isSelected={selectedKeyType === keyType}
          onClick={() => setSelectedKeyType(keyType)}
        />
      ))}
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
        isSelected ? "bg-[#2A2A31]" : "bg-[#0E0E11] hover:bg-[#1E1E22]"
      }`}
      onClick={onClick}
    >
      <span className="text-style-4 text-[#DBDEE8]">{text}</span>
    </button>
  );
};

export default TabTool;
