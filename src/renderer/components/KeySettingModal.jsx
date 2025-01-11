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
    <div 
      className="fixed top-[41px] left-[1px] flex items-center justify-center w-[896px] h-[451px] bg-[#000000] bg-opacity-[0.31] backdrop-blur-[37.5px] rounded-b-[6px]"
      onClick={onClose}
    >
      <div 
        className="flex flex-col items-center justify-center w-[334.5px] p-[25px] bg-[#1C1E25] border border-[#3B4049] rounded-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex justify-between w-full align-center'>
          <p className="text-white text-[13.5px] font-extrabold leading-[24.5px]">키 매핑</p>
          <button 
            onClick={() => setIsListening(true)}
            className="flex items-center h-[24.6px] px-[9px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#989BA6] text-[13.5px] font-extrabold"
          >
            {isListening ? "Press any key" : displayKey || "Click to set key"}
          </button>
        </div>
        <div className="flex w-full justify-between h-[31.5px] mt-[30.25px] gap-[15px]">
          <button 
            onClick={handleSubmit}
            className="flex-1 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-semibold"
          >
            저장
          </button>
          <button 
            onClick={onClose}
            className="flex-1 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-semibold"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}