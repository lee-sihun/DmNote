import React from "react";
import Modal from "../Modal";

export default function Alert({
  isOpen,
  message,
  type = "alert", // "alert" or "confirm"
  confirmText = "확인",
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;

  const isConfirm = type === "confirm";

  return (
    <Modal onClick={onCancel}>
      <div
        className="flex flex-col justify-between p-[20px] gap-[19px] bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 메시지 텍스트 */}
        <div className="max-w-[235.5px] text-center text-[#FFFFFF] text-style-3 !leading-[20px]">
          {message}
        </div>

        {/* 버튼들 */}
        <div className="flex gap-[10.5px]">
          <button
            onClick={onConfirm}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            {confirmText}
          </button>
          {isConfirm && (
            <button
              onClick={onCancel}
              className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
            >
              취소
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
