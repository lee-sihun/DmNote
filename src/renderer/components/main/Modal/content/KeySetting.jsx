import React, { useEffect, useState, useRef } from "react";
import { getKeyInfo, getKeyInfoByGlobalKey } from "@utils/KeyMaps";
import { useSettingsStore } from "@stores/useSettingsStore";
import Modal from "../Modal";
import { useTranslation } from "react-i18next";

export default function KeySetting({
  keyData,
  onClose,
  onSave,
  skipAnimation = false,
}) {
  const { t } = useTranslation();
  const {
    useCustomCSS,
    setUseCustomCSS,
    setCustomCSSContent,
    setCustomCSSPath,
    noteEffect,
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

  const [isFocused, setIsFocused] = useState(false);
  const [displayNoteOpacity, setDisplayNoteOpacity] = useState(
    keyData.noteOpacity ? `${keyData.noteOpacity}%` : "80%"
  );

  const [widthFocused, setWidthFocused] = useState(false);
  const [heightFocused, setHeightFocused] = useState(false);
  const [colorFocused, setColorFocused] = useState(false);

  const activeInputRef = useRef(null);
  const inactiveInputRef = useRef(null);
  const initialSkipRef = useRef(skipAnimation);

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

  useEffect(() => {
    if (!isFocused) {
      setDisplayNoteOpacity(`${noteOpacity}%`);
    }
  }, [noteOpacity, isFocused]);

  const handleSubmit = () => {
    onSave({
      key,
      activeImage,
      inactiveImage,
      width: parseInt(width),
      height: parseInt(height),
      noteColor,
      noteOpacity,
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
    const value = e.target.value.toUpperCase();
    setNoteColor("#" + value);
  };

  const handleColorBlur = (e) => {
    const inputValue = e.target.value.toUpperCase();
    const fullColor = "#" + inputValue;
    if (!isValidColor(fullColor)) {
      setNoteColor("#FFFFFF"); // 잘못된 값이면 기본값으로 복원
    }
  };

  return (
    <Modal onClick={onClose} animate={!initialSkipRef.current}>
      <div
        className="flex flex-col items-center justify-center p-[20px] bg-[#1A191E] rounded-[13px] gap-[19px] border-[1px] border-[#2A2A30]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">
            {t("keySetting.keyMapping")}
          </p>
          <button
            onClick={() => setIsListening(true)}
            className={`flex items-center justify-center h-[23px] min-w-[0px] px-[8.5px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
              isListening ? "border-[#459BF8]" : "border-[#3A3943]"
            } text-[#DBDEE8] text-style-2`}
          >
            {isListening
              ? t("keySetting.pressAnyKey")
              : displayKey || t("keySetting.clickToSet")}
          </button>
        </div>
        <div className="flex justify-between w-full items-center">
          <p className="text-white text-style-2">{t("keySetting.keySize")}</p>
          <div className="flex items-center gap-[10.5px]">
            <div
              className={`relative w-[48px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
                widthFocused ? "border-[#459BF8]" : "border-[#3A3943]"
              }`}
            >
              <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-[#97999E] text-style-1 pointer-events-none">
                X
              </span>
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
                onFocus={() => setWidthFocused(true)}
                onBlur={(e) => {
                  setWidthFocused(false);
                  if (
                    e.target.value === "" ||
                    isNaN(parseInt(e.target.value))
                  ) {
                    setWidth(60);
                  }
                }}
                className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-[#DBDEE8] text-left"
              />
            </div>
            <div
              className={`relative w-[48px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
                heightFocused ? "border-[#459BF8]" : "border-[#3A3943]"
              }`}
            >
              <span className="absolute left-[5px] top-[50%] transform -translate-y-1/2 text-[#97999E] text-style-1 pointer-events-none">
                Y
              </span>
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
                onFocus={() => setHeightFocused(true)}
                onBlur={(e) => {
                  setHeightFocused(false);
                  if (
                    e.target.value === "" ||
                    isNaN(parseInt(e.target.value))
                  ) {
                    setHeight(60);
                  }
                }}
                className="absolute left-[20px] top-[-1px] h-[23px] w-[26px] bg-transparent text-style-4 text-[#DBDEE8] text-left"
              />
            </div>
          </div>
        </div>
        {/* 노트 관련 UI: noteEffect가 true일 때만 렌더링 */}
        {noteEffect && (
          <>
            <div className="flex justify-between w-full items-center">
              <p className="text-white text-style-2">
                {t("keySetting.noteColor")}
              </p>
              <div
                className={`relative w-[76px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] ${
                  colorFocused ? "border-[#459BF8]" : "border-[#3A3943]"
                }`}
              >
                <div
                  className="absolute left-[6px] top-[4.5px] w-[11px] h-[11px] rounded-[2px] border border-[#3A3943]"
                  style={{ backgroundColor: noteColor }}
                ></div>
                <input
                  type="text"
                  value={noteColor.replace(/^#/, "")}
                  onChange={handleColorChange}
                  onFocus={() => setColorFocused(true)}
                  onBlur={(e) => {
                    setColorFocused(false);
                    handleColorBlur(e);
                  }}
                  placeholder="FFF"
                  className="absolute left-[20px] top-[-1px] h-[23px] w-[50px] bg-transparent text-style-1 text-[#DBDEE8] text-center"
                />
              </div>
            </div>
            {/* 노트 투명도 설정 추가 */}
            <div className="flex justify-between w-full items-center">
              <p className="text-white text-style-2">
                {t("keySetting.noteOpacity")}
              </p>
              <input
                type="text"
                value={displayNoteOpacity}
                onChange={(e) => {
                  const newValue = e.target.value.replace(/[^0-9]/g, "");
                  if (newValue === "") {
                    setDisplayNoteOpacity("");
                  } else {
                    const numValue = parseInt(newValue);
                    if (!isNaN(numValue)) {
                      setDisplayNoteOpacity(newValue);
                    }
                  }
                }}
                onFocus={() => {
                  setIsFocused(true);
                  setDisplayNoteOpacity(noteOpacity.toString());
                }}
                onBlur={(e) => {
                  setIsFocused(false);
                  const inputValue = e.target.value.replace(/[^0-9]/g, "");
                  if (inputValue === "" || isNaN(parseInt(inputValue))) {
                    setNoteOpacity(80);
                  } else {
                    const numValue = parseInt(inputValue);
                    setNoteOpacity(Math.min(Math.max(numValue, 0), 100));
                  }
                }}
                className="text-center w-[47px] h-[23px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
              />
            </div>
          </>
        )}
        {/* 입력/대기 이미지 */}
        <div className="flex justify-between w-full items-center">
          <div className="flex items-center justify-between gap-[20px]">
            <p className="text-white text-style-2">
              {t("keySetting.inactiveState")}
            </p>
            <input
              type="file"
              accept="image/*"
              ref={inactiveInputRef}
              className="hidden"
              onChange={(e) => handleImageSelect(e, false)}
            />
            <button
              className="key-bg flex w-[30px] h-[30px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943]"
              onClick={() => inactiveInputRef.current.click()}
              style={{
                backgroundImage: inactiveImage
                  ? `url(${inactiveImage})`
                  : "none",
                backgroundSize: "cover",
                width: "30px",
                height: "30px",
              }}
            ></button>
          </div>
          <div className="flex items-center justify-between gap-[20px]">
            <p className="text-white text-style-2">
              {t("keySetting.activeState")}
            </p>
            <input
              type="file"
              accept="image/*"
              ref={activeInputRef}
              className="hidden"
              onChange={(e) => handleImageSelect(e, true)}
            />
            <button
              className="key-bg flex w-[30px] h-[30px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943]"
              onClick={() => activeInputRef.current.click()}
              style={{
                backgroundImage: activeImage ? `url(${activeImage})` : "none",
                backgroundSize: "cover",
                width: "30px",
                height: "30px",
              }}
            ></button>
          </div>
        </div>
        {/* 클래스 이름 - 커스텀 CSS 활성화 시에만 표시 */}
        {useCustomCSS && (
          <div className="flex justify-between w-full items-center">
            <p className="text-white text-style-2">
              {t("keySetting.className")}
            </p>
            <input
              key="classNameUnified"
              type="text"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="className"
              className="text-center w-[90px] h-[23px] p-[6px] bg-[#2A2A30] rounded-[7px] border-[1px] border-[#3A3943] focus:border-[#459BF8] text-style-4 text-[#DBDEE8]"
            />
          </div>
        )}
        {/* 저장/취소 버튼 */}
        <div className="flex gap-[10.5px]">
          <button
            onClick={handleSubmit}
            className="w-[150px] h-[30px] bg-[#2A2A30] hover:bg-[#303036] active:bg-[#393941] rounded-[7px] text-[#DCDEE7] text-style-3"
          >
            {t("keySetting.save")}
          </button>
          <button
            onClick={onClose}
            className="w-[75px] h-[30px] bg-[#3C1E1E] hover:bg-[#442222] active:bg-[#522929] rounded-[7px] text-[#E6DBDB] text-style-3"
          >
            {t("keySetting.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
