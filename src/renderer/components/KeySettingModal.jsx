import React, { useEffect, useState, useRef } from 'react';
import { getKeyInfo, getKeyInfoByGlobalKey } from "@utils/KeyMaps";

export default function KeySettingModal({ keyData, onClose, onSave }) {
  const [key, setKey] = useState(keyData.key);
  const [displayKey, setDisplayKey] = useState(getKeyInfoByGlobalKey(key).displayName);
  const [isListening, setIsListening] = useState(false);
  const [activeImage, setActiveImage] = useState(keyData.activeImage || '');
  const [inactiveImage, setInactiveImage] = useState(keyData.inactiveImage || '');

  const activeInputRef = useRef(null);
  const inactiveInputRef = useRef(null);

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
    onSave({
      key,
      activeImage,
      inactiveImage
    });
  };

  const handleImageSelect = (e, isActive) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // 키 크기에 맞게 캔버스 설정
          const width = keyData.width;
          canvas.width = width; 
          canvas.height = 60; 
          
          ctx.drawImage(img, 0, 0, width, 60);
          
          // WebP 포맷으로 변환 및 압축
          const optimizedImageUrl = canvas.toDataURL('image/webp', 0.8);
          if (isActive) {
            setActiveImage(optimizedImageUrl);
          } else {
            setInactiveImage(optimizedImageUrl);
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
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
        <div className='flex justify-between w-full mt-[18px]'>
          <div className='flex items-center justify-between w-[122px]'>
            <p className="text-white text-[13.5px] font-extrabold leading-[24.5px]">비활성 상태</p>
            <input
              type="file"
              accept="image/*"
              ref={inactiveInputRef}
              className="hidden"
              onChange={(e) => handleImageSelect(e, false)}
            />
            <button 
              className="key-bg flex w-[39px] h-[39px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049]"
              onClick={() => inactiveInputRef.current.click()}
              style={{ backgroundImage: inactiveImage ? `url(${inactiveImage})` : 'none', backgroundSize: 'cover' }}
            >
            </button>
          </div>
          <div className='flex items-center justify-between w-[122px]'>
            <p className="text-white text-[13.5px] font-extrabold leading-[24.5px]">활성 상태</p>
            <input
              type="file"
              accept="image/*"
              ref={activeInputRef}
              className="hidden"
              onChange={(e) => handleImageSelect(e, true)}
            />
            <button 
              className="key-bg flex w-[39px] h-[39px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049]"
              onClick={() => activeInputRef.current.click()}
              style={{ backgroundImage: activeImage ? `url(${activeImage})` : 'none', backgroundSize: 'cover' }}
            >
            </button>
          </div>
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