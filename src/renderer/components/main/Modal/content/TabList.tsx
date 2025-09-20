import { useEffect, useMemo, useState } from "react";
import PlusIcon from "@assets/svgs/plus2.svg";
import MinusIcon from "@assets/svgs/minus.svg";
import { useKeyStore } from "@stores/useKeyStore";
import Alert from "./Alert.jsx";
import TabNameModal from "./TabNameModal";
import { useTranslation } from "react-i18next";

type TabListProps = {
  onClose?: () => void;
};

const TabList = ({ onClose }: TabListProps) => {
  const {
    customTabs,
    selectedKeyType,
    setSelectedKeyType,
    refreshCustomTabs,
    addCustomTab,
    deleteSelectedCustomTab,
  } = useKeyStore();
  const { t } = useTranslation();

  const [isLoaded, setIsLoaded] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);

  useEffect(() => {
    refreshCustomTabs().finally(() => setIsLoaded(true));
  }, [refreshCustomTabs]);

  const isCustomSelected = useMemo(() => {
    return !["4key", "5key", "6key", "8key"].includes(selectedKeyType);
  }, [selectedKeyType]);

  const maxReached = customTabs.length >= 5;

  const handleCreate = async (name: string) => {
    const res = await addCustomTab(name);
    if (!res?.error) {
      onClose?.();
    }
    return res;
  };

  const handleSelect = async (id: string) => {
    await setSelectedKeyType(id);
    onClose?.();
  };

  return (
    <div className="flex flex-col items-center justify-center max-w-[154px] bg-[#1A191E] rounded-[7px] border border-[#2A2A30]">
      <div className="min-h-[39px] w-full border-b-[1px] border-[#2A2A30] flex flex-col items-center justify-center p-[8px] gap-[8px]">
        {customTabs.length === 0 ? (
          <span className="text-style-2 text-[#DBDEE8]">{t("tabs.empty")}</span>
        ) : (
          <div className="flex flex-col w-[154px] gap-[6px] items-center">
            {[...customTabs]
              .slice()
              .reverse()
              .map((tab) => (
                <button
                  key={tab.id}
                  className={`w-[138px] h-[24px] flex items-center justify-center rounded-[7px] text-style-2 text-[#DBDEE8] hover:bg-[#26262C] active:bg-[#2A2A31] ${
                    selectedKeyType === tab.id ? "bg-[#26262C]" : ""
                  }`}
                  onClick={() => handleSelect(tab.id)}
                >
                  {tab.name}
                </button>
              ))}
          </div>
        )}
      </div>
      <div className="flex flex-row p-[8px] w-[154px] gap-[8px]">
        {!maxReached && (
          <button
            className="flex flex-1 items-center justify-center max-w-[138px] h-[22px] rounded-[7px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941]"
            onClick={() => setShowNameModal(true)}
          >
            <PlusIcon />
          </button>
        )}
        {customTabs.length > 0 && (
          <button
            className={`flex flex-1 items-center justify-center max-w-[138px] h-[22px] rounded-[7px] ${
              isCustomSelected
                ? "bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929]"
                : "bg-[#2A2A30] opacity-50 cursor-not-allowed"
            }`}
            disabled={!isCustomSelected}
            onClick={() => setAskDelete(true)}
          >
            <MinusIcon />
          </button>
        )}
      </div>

      {/* 이름 입력 모달 */}
      <TabNameModal
        isOpen={showNameModal}
        onClose={() => setShowNameModal(false)}
        onSubmit={handleCreate}
        existingNames={customTabs.map((t) => t.name)}
      />

      {/* 삭제 확인 */}
      <Alert
        isOpen={askDelete}
        type="confirm"
        message={t("tabs.deleteConfirm", {
          name: customTabs.find((t) => t.id === selectedKeyType)?.name || "",
        })}
        confirmText={t("tabs.delete")}
        onConfirm={async () => {
          setAskDelete(false);
          await deleteSelectedCustomTab();
          onClose?.();
        }}
        onCancel={() => setAskDelete(false)}
      />
    </div>
  );
};

export default TabList;
