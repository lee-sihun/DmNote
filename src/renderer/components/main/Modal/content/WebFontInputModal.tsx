import React, { useState, useCallback } from "react";
import Modal from "@components/main/Modal/Modal";
import { extractFontFamilyFromCSS } from "@src/types/fonts";

interface WebFontInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (css: string, displayName: string) => void;
  t: (key: string, options?: Record<string, string>) => string;
}

export default function WebFontInputModal({
  isOpen,
  onClose,
  onSubmit,
  t,
}: WebFontInputModalProps) {
  const [cssInput, setCssInput] = useState("");
  const trimmedCSS = cssInput.trim();
  const hasInput = trimmedCSS.length > 0;
  const hasFontFace = trimmedCSS.includes("@font-face");
  const extractedFontFamily = extractFontFamilyFromCSS(trimmedCSS);
  const hasFontFamily = !!extractedFontFamily;
  const canSubmit = hasFontFace && hasFontFamily;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) {
      return;
    }

    onSubmit(trimmedCSS, extractedFontFamily || "");
    setCssInput("");
  }, [canSubmit, extractedFontFamily, onSubmit, trimmedCSS]);

  const handleClose = useCallback(() => {
    setCssInput("");
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <Modal onClick={handleClose}>
      <div
        className="flex flex-col bg-[#1A191E] rounded-[13px] border-[1px] border-[#2A2A30] p-[20px] gap-[19px]"
        onClick={(event) => event.stopPropagation()}
      >
        <textarea
          autoFocus
          value={cssInput}
          onChange={(e) => setCssInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={`${t("webFontInput.cssLabel") || "@font-face CSS"}

@font-face {
  font-family: 'FontName';
          src: url('https://...') format('woff2');
  font-weight: 400;
}`}
          aria-label="@font-face CSS input"
          className="w-full h-[220px] px-[12px] py-[10px] bg-[#2A2A30] rounded-[7px] border-[1px] text-[#DBDEE8] text-style-4 placeholder-[#6F6E7A] outline-none resize-none font-mono transition-colors border-[#3A3943] focus:border-[#459BF8]"
          spellCheck={false}
        />

        <div className="flex items-center justify-end gap-[10.5px]">
          <button
            className={`w-[150px] h-[30px] rounded-[7px] text-style-3 text-[#DCDEE7] transition-colors ${
              canSubmit
                ? "bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941]"
                : "bg-[#222228] cursor-not-allowed opacity-50"
            }`}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {t("webFontInput.submit") || "추가"}
          </button>
          <button
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3 transition-colors"
            onClick={handleClose}
          >
            {t("common.cancel") || "취소"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
