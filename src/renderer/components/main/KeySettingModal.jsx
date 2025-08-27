import React, { useEffect, useState, useRef } from "react";
import { getKeyInfo, getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { ReactComponent as TrashIcon } from "@assets/svgs/trash.svg";
import { useSettingsStore } from "@stores/useSettingsStore";

export default function KeySettingModal({
  keyData,
  onClose,
  onSave,
  onDelete,
}) {
  const {
    useCustomCSS,
    setUseCustomCSS,
    setCustomCSSContent,
    setCustomCSSPath,
  } = useSettingsStore();
  const [key, setKey] = useState(keyData.key);
  const [displayKey, setDisplayKey] = useState(
    getKeyInfoByGlobalKey(key).displayName
  );
  const [isListening, setIsListening] = useState(false);
  const [activeImage, setActiveImage] = useState(keyData.activeImage || "");
  const [inactiveImage, setInactiveImage] = useState(
    keyData.inactiveImage || ""
  );
  const [width, setWidth] = useState(keyData.width || 60);
  const [height, setHeight] = useState(keyData.height || 60);
  const [noteColor, setNoteColor] = useState(keyData.noteColor || "#FFFFFF");
  const [noteOpacity, setNoteOpacity] = useState(keyData.noteOpacity || 80);

  const [className, setClassName] = useState(keyData.className || "");

  const activeInputRef = useRef(null);
  const inactiveInputRef = useRef(null);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (isListening) {
        e.preventDefault();
        let code = e.code;
        if (e.key === "Shift") {
          code = e.location === 1 ? "ShiftLeft" : "ShiftRight";
        }
        setKey(getKeyInfo(code, e.key).globalKey);
        setDisplayKey(getKeyInfo(code, e.key).displayName);
        setIsListening(false);
      }
    };

    // Early CSS sync (모달이 SettingTab 방문 전에 열릴 경우)
    const ipcRenderer = window.electron?.ipcRenderer;
    if (ipcRenderer) {
      ipcRenderer
        .invoke("get-use-custom-css")
        .then((enabled) => {
          if (typeof enabled === "boolean") setUseCustomCSS(enabled);
        })
        .catch(() => {});
      ipcRenderer
        .invoke("get-custom-css")
        .then((data) => {
          if (data) {
            if (data.content) setCustomCSSContent(data.content);
            if (data.path) setCustomCSSPath(data.path);
          }
        })
        .catch(() => {});
    }

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [isListening, setUseCustomCSS, setCustomCSSContent, setCustomCSSPath]);

  const handleSubmit = () => {
    onSave({
      key,
      activeImage,
      inactiveImage,
      width: parseInt(width),
      height: parseInt(height),
      noteColor,
      noteOpacity: parseInt(noteOpacity),
      className,
    });
  };

  const handleImageSelect = (e, isActive) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        // const img = new Image();
        // img.onload = () => {
        //   const canvas = document.createElement('canvas');
        //   const ctx = canvas.getContext('2d', { alpha: true });

        //   // 키 크기에 맞게 캔버스 설정
        //   const width = keyData.width;
        //   canvas.width = width;
        //   canvas.height = 60;

        //   // 이미지 렌더링 품질 설정
        //   ctx.imageSmoothingEnabled = true;
        //   ctx.imageSmoothingQuality = 'high';

        //   // 투명도 유지를 위한 설정
        //   ctx.clearRect(0, 0, width, height);

        //   // 이미지 리사이징 (Bicubic 알고리즘 사용)
        //   ctx.drawImage(img, 0, 0, width, 60);

        //   // WebP 포맷으로 변환 및 압축
        //   const optimizedImageUrl = canvas.toDataURL('image/webp', 1.0);

        //   if (isActive) {
        //     setActiveImage(optimizedImageUrl);
        //   } else {
        //     setInactiveImage(optimizedImageUrl);
        //   }
        // };
        // img.src = e.target.result;
        if (isActive) {
          setActiveImage(e.target.result);
        } else {
          setInactiveImage(e.target.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // 색상 값 검증 함수
  const isValidColor = (color) => {
    const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    return hexPattern.test(color);
  };

  const handleColorChange = (e) => {
    const value = e.target.value;
    setNoteColor(value);
  };

  const handleColorBlur = (e) => {
    const value = e.target.value;
    if (!isValidColor(value)) {
      setNoteColor("#FFFFFF"); // 잘못된 값이면 기본값으로 복원
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
        <div className="flex justify-between w-full align-center">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            키 매핑
          </p>
          <button
            onClick={() => setIsListening(true)}
            className="flex items-center h-[24.6px] px-[9px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#fff] text-[13.5px] font-medium"
          >
            {isListening ? "Press any key" : displayKey || "Click to set key"}
          </button>
        </div>
        <div className="flex justify-between w-full mt-[18px]">
          <div className="flex items-center justify-between w-[122px]">
            <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
              대기 상태
            </p>
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
              style={{
                backgroundImage: inactiveImage
                  ? `url(${inactiveImage})`
                  : "none",
                backgroundSize: "cover",
                width: "39px",
                height: "39px",
              }}
            ></button>
          </div>
          <div className="flex items-center justify-between w-[122px]">
            <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
              입력 상태
            </p>
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
              style={{
                backgroundImage: activeImage ? `url(${activeImage})` : "none",
                backgroundSize: "cover",
                width: "39px",
                height: "39px",
              }}
            ></button>
          </div>
        </div>
        <div className="flex justify-between w-full mt-[18px]">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            키 사이즈
          </p>
          <div className="flex items-center gap-[10px]">
            <input
              type="number"
              value={width}
              onChange={(e) => {
                const newValue = e.target.value;
                if (newValue === "") {
                  setWidth("");
                } else {
                  const numValue = parseInt(newValue);
                  if (!isNaN(numValue)) {
                    setWidth(Math.min(Math.max(numValue, 1), 999));
                  }
                }
              }}
              onBlur={(e) => {
                if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                  setWidth(60);
                }
              }}
              className="text-center w-[40px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
            />
            <p className="text-[#989BA6] text-[13.5px] font-medium mt-[2px]">X</p>
            <input
              type="number"
              value={height}
              onChange={(e) => {
                const newValue = e.target.value;
                if (newValue === "") {
                  setHeight("");
                } else {
                  const numValue = parseInt(newValue);
                  if (!isNaN(numValue)) {
                    setHeight(Math.min(Math.max(numValue, 1), 999));
                  }
                }
              }}
              onBlur={(e) => {
                if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                  setHeight(60);
                }
              }}
              className="text-center w-[40px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
            />
          </div>
        </div>
        <div className="flex justify-between w-full mt-[18px]">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            노트 색상
          </p>
          <div className="flex items-center gap-[10px]">
            <div
              className="w-[24px] h-[24px] border border-[#3B4049] rounded-[4px]"
              style={{ backgroundColor: noteColor }}
            ></div>
            <input
              type="text"
              value={noteColor}
              onChange={handleColorChange}
              onBlur={handleColorBlur}
              placeholder="#FFFFFF"
              className="text-center w-[80px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[13px] font-medium"
            />
          </div>
        </div>

        {/* 노트 투명도 설정 추가 */}
        <div className="flex justify-between w-full mt-[18px]">
          <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
            노트 투명도
          </p>
          <div className="flex items-center gap-[10px]">
            <input
              type="number"
              value={noteOpacity}
              onChange={(e) => {
                const newValue = e.target.value;
                if (newValue === "") {
                  setNoteOpacity("");
                } else {
                  const numValue = parseInt(newValue);
                  if (!isNaN(numValue)) {
                    setNoteOpacity(Math.min(Math.max(numValue, 0), 100));
                  }
                }
              }}
              onBlur={(e) => {
                if (e.target.value === "" || isNaN(parseInt(e.target.value))) {
                  setNoteOpacity(80);
                }
              }}
              className="text-center w-[50px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
            />
            <p className="text-[#989BA6] text-[13.5px] font-medium">%</p>
          </div>
        </div>

        {/* 클래스 이름 - 커스텀 CSS 활성화 시에만 표시 */}
        {useCustomCSS && (
          <div className="flex justify-between w-full mt-[18px] items-center">
            <p className="text-white text-[13.5px] font-medium leading-[24.5px]">
              클래스 이름
            </p>
            <input
              key="classNameUnified"
              type="text"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="className"
              className="text-center w-[114px] h-[24.6px] p-[6px] bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[13px] font-medium"
            />
          </div>
        )}

        <div className="flex w-full justify-between h-[31.5px] mt-[30.25px] gap-[8px]">
          <button
            onClick={handleSubmit}
            className="flex-1 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
          >
            저장
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-[#101216] rounded-[6px] border-[0.5px] border-[#3B4049] text-[#FFFFFF] text-[15px] font-medium"
          >
            취소
          </button>
          <button
            onClick={onDelete}
            className="flex justify-center items-center w-[42px] bg-[#271213] border border-[#4D3F40] rounded-[6px]"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
