import React, { useEffect, useState } from 'react';
import { getKeyInfo, getKeyInfoByGlobalKey } from "@utils/KeyMaps";

export default function KeySettingModal({ keyData, onClose, onSave }) {
  const [key, setKey] = useState(keyData.key);
  const [displayKey, setDisplayKey] = useState(getKeyInfoByGlobalKey(key).displayName);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (isListening) {
        e.preventDefault();
        setKey(getKeyInfo(e.code, e.key).globalKey);
        setDisplayKey(getKeyInfo(e.code, e.key).displayName);
        setIsListening(false);
      }
    }

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isListening]);

  const handleSubmit = () => {
    onSave(key);
  };

  return (
    <div className="fixed top-[41px] left-[1px] flex items-center justify-center w-[896px] h-[451px] bg-[#000000] bg-opacity-[0.31] backdrop-blur-[37.5px] rounded-b-[6px]">
      <div className="flex flex-col items-center justify-center p-[25px] bg-[#1C1E25] border border-[#3B4049] rounded-[6px]">
        <button 
          onClick={() => setIsListening(true)}
          className="flex items-center h-[25px] px-[9px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#989BA6] text-[13.5px] font-extrabold"
        >
          {isListening ? "Press any key..." : displayKey || "Click to set key"}
        </button>
        <div className="flex mt-2">
          <button 
            onClick={handleSubmit}
            className="px-4 py-2 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#989BA6] text-[13.5px] font-extrabold"
          >
            저장
          </button>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#989BA6] text-[13.5px] font-extrabold"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}