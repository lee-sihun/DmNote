import React, { useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import { useTranslation } from "react-i18next";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<any> | any;
  existingNames?: string[];
};

export default function TabNameModal({
  isOpen,
  onClose,
  onSubmit,
  existingNames = [],
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setError(null);
    }
  }, [isOpen]);

  const validate = useMemo(() => {
    return (v: string) => {
      if (!v || !v.trim()) return t("tabs.name.required");
      if (v.length > 10) return t("tabs.name.max");
      if (["4key", "5key", "6key", "8key"].includes(v))
        return t("tabs.name.reserved");
      if (existingNames.includes(v)) return t("tabs.name.duplicate");
      return null;
    };
  }, [existingNames]);

  const handleSubmit = async () => {
    const err = validate(name.trim());
    if (err) {
      setError(err);
      return;
    }
    const res = await onSubmit(name.trim());
    if (res?.error) {
      const map: Record<string, string> = {
        "max-reached": t("tabs.errors.max"),
        "duplicate-name": t("tabs.name.duplicate"),
        "invalid-name": t("tabs.errors.invalid"),
      };
      setError(map[res.error] || t("tabs.errors.createFail"));
      return;
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal onClick={onClose}>
      <div
        className="flex flex-col justify-between p-[20px] gap-[19px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-style-3 text-[#FFFFFF]">
          {t("tabs.createTitle")}
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          className="w-full h-[30px] px-[12px] rounded-[7px] bg-[#2A2A30] text-[#DCDEE7] text-style-3 border-[1px] border-[#3A3943] focus:border-[#459BF8]"
          placeholder={t("tabs.name.placeholder")}
        />
        {error && (
          <div className="text-[#ED6A5E] text-style-1 my-[-12px]">{error}</div>
        )}
        <div className="flex gap-[8px] justify-end">
          <button
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
            onClick={handleSubmit}
          >
            {t("tabs.create")}
          </button>
          <button
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
