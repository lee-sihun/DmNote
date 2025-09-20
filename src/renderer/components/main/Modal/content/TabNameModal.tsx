import React, { useEffect, useMemo, useState } from "react";
import Modal from "../Modal";

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
      if (!v || !v.trim()) return "이름을 입력하세요";
      if (v.length > 10) return "10자 이하로 입력하세요";
      if (["4key", "5key", "6key", "8key"].includes(v))
        return "기본 탭 이름은 사용할 수 없습니다";
      if (existingNames.includes(v)) return "이미 존재하는 이름입니다";
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
        "max-reached": "추가 탭은 최대 5개까지입니다",
        "duplicate-name": "이미 존재하는 이름입니다",
        "invalid-name": "올바르지 않은 이름입니다",
      };
      setError(map[res.error] || "생성에 실패했습니다");
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
        <div className="text-style-3 text-[#FFFFFF]">탭 생성</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          className="w-full h-[30px] px-[12px] rounded-[7px] bg-[#2A2A30] text-[#DCDEE7] text-style-3 border-[1px] border-[#3A3943] focus:border-[#459BF8]"
          placeholder="예: 내 커스텀"
        />
        {error && (
          <div className="text-[#ED6A5E] text-style-1 my-[-12px]">{error}</div>
        )}
        <div className="flex gap-[8px] justify-end">
          <button
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
            onClick={handleSubmit}
          >
            생성하기
          </button>
          <button
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
            onClick={onClose}
          >
            취소
          </button>
        </div>
      </div>
    </Modal>
  );
}
