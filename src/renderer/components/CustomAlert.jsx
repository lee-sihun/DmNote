import React from "react";

export default function CustomAlert({
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
    <div
      className="fixed top-[41px] left-[1px] flex items-center justify-center w-[896px] h-[451px] bg-[#000000] bg-opacity-[0.31] backdrop-blur-[37.5px] rounded-b-[6px] z-50"
      onClick={onCancel}
    >
      <div
        className="flex flex-col justify-between w-[423px] h-auto p-[56px] pb-[50px] bg-[#1C1E25] border border-[#3B4049] rounded-[9px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 메시지 텍스트 */}
        <div className="text-white text-[19px] font-medium leading-[24px] text-center mb-[40px]">
          {message}
        </div>

        {/* 버튼들 */}
        <div className="flex gap-[16.5px]">
          <button
            onClick={onConfirm}
            className="flex-1 h-[31.5px] px-[24px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
          >
            {confirmText}
          </button>
          {isConfirm && (
            <button
              onClick={onCancel}
              className="flex-1 h-[31.5px] px-[24px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
            >
              취소
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
