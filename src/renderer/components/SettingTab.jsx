import React, { useEffect, useState } from "react";
import { useSettingsStore } from "@stores/useSettingsStore";
import Github from "@assets/svgs/github.svg";
import Bug from "@assets/svgs/Bug.svg";

export default function SettingTab() {
  const {
    hardwareAcceleration,
    setHardwareAcceleration,
    alwaysOnTop,
    setAlwaysOnTop,
    // showKeyCount,
    // setShowKeyCount,
    overlayLocked,
    setOverlayLocked,
    angleMode,
    setAngleMode,
  } = useSettingsStore();
  const ipcRenderer = window.electron.ipcRenderer;

  const ANGLE_OPTIONS = [
    {
      value: "d3d11",
      label: "Direct3D 11",
    },
    {
      value: "d3d9",
      label: "Direct3D 9",
    },
    {
      value: "gl",
      label: "OpenGL",
    },
  ];

  useEffect(() => {
    const updateHandler = (_, value) => {
      setHardwareAcceleration(value);
    };

    const alwaysOnTopHandler = (_, value) => {
      setAlwaysOnTop(value);
    };

    // const showKeyCountHandler = (_, value) => {
    //   setShowKeyCount(value);
    // };

    const overlayLockHandler = (_, value) => {
      setOverlayLocked(value);
    };

    ipcRenderer.send("get-hardware-acceleration");
    ipcRenderer.on("update-hardware-acceleration", updateHandler);

    ipcRenderer.send("get-always-on-top");
    ipcRenderer.on("update-always-on-top", alwaysOnTopHandler);

    // ipcRenderer.send('get-show-key-count');
    // ipcRenderer.on('update-show-key-count', showKeyCountHandler);

    ipcRenderer.send("get-overlay-lock");
    ipcRenderer.on("update-overlay-lock", overlayLockHandler);

    ipcRenderer.invoke("get-angle-mode").then((mode) => {
      setAngleMode(mode);
    });

    return () => {
      ipcRenderer.removeAllListeners("update-hardware-acceleration");
      ipcRenderer.removeAllListeners("update-always-on-top");
      // ipcRenderer.removeAllListeners('update-show-key-count');
      ipcRenderer.removeAllListeners("update-overlay-lock");
    };
  }, []);

  const handleHardwareAccelerationChange = async () => {
    const newState = !hardwareAcceleration;

    if (
      window.confirm(
        "설정을 적용하려면 앱을 재시작해야 합니다. 지금 재시작하시겠습니까?"
      )
    ) {
      setHardwareAcceleration(newState);
      await ipcRenderer.invoke("toggle-hardware-acceleration", newState);
      ipcRenderer.send("restart-app");
    }
  };

  const handleAlwaysOnTopChange = () => {
    const newState = !alwaysOnTop;
    setAlwaysOnTop(newState);
    ipcRenderer.send("toggle-always-on-top", newState);
  };

  // 키 카운트 On/Off 핸들러
  // const handleKeyCountToggle = () => {
  //   const newState = !showKeyCount;
  //   setShowKeyCount(newState);
  //   ipcRenderer.send('toggle-show-key-count', newState);
  // };

  // 키 카운트 초기화 핸들러
  // const handleResetKeyCount = () => {
  //   ipcRenderer.send('reset-key-count');
  // };

  // 오버레이 창 고정 핸들러
  const handleOverlayLockChange = () => {
    const newState = !overlayLocked;
    setOverlayLocked(newState);
    ipcRenderer.send("toggle-overlay-lock", newState);
  };

  // 그래픽 렌더링 모드 변경 핸들러
  const handleAngleModeChange = async (e) => {
    const newMode = e.target.value;

    if (
      window.confirm(
        "설정을 적용하려면 앱을 재시작해야 합니다. 지금 재시작하시겠습니까?"
      )
    ) {
      setAngleMode(newMode);
      ipcRenderer.send("set-angle-mode", newMode);
      ipcRenderer.send("restart-app");
    }
  };

  return (
    <div className="flex flex-col w-full h-full p-[18px] gap-[18px]">
      <div className="w-full bg-[#1C1E25] rounded-[6px] px-[18px]">
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-medium w-[153px] text-white text-[13.5px]">
            오버레이 창 고정
          </p>
          <Checkbox
            checked={overlayLocked}
            onChange={handleOverlayLockChange}
          />
        </div>
        <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-medium w-[153px] text-white text-[13.5px]">
            항상 위에 표시
          </p>
          <Checkbox checked={alwaysOnTop} onChange={handleAlwaysOnTopChange} />
        </div>
        <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-medium w-[153px] text-white text-[13.5px]">
            하드웨어 가속 활성화
          </p>
          <Checkbox
            checked={hardwareAcceleration}
            onChange={handleHardwareAccelerationChange}
          />
        </div>
        {/* <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-medium w-[153px] text-white text-[13.5px]">
            키 입력 카운트 표시
            <a 
              className="text-[#419DFF] cursor-pointer "
              onClick={handleResetKeyCount}
            > [초기화]</a>
          </p>
          <Checkbox 
            checked={showKeyCount}
            onChange={handleKeyCountToggle}
          />
        </div> */}
      </div>
      <div className="w-full bg-[#1C1E25] rounded-[6px] px-[18px]">
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[26px]">
          <p className="text-center font-medium w-[153px] text-white text-[13.5px]">
            그래픽 렌더링 옵션
          </p>
          <div className="flex items-center gap-[40px]">
            {ANGLE_OPTIONS.map((option) => (
              <Radio
                key={option.value}
                name="angle"
                value={option.value}
                checked={angleMode === option.value}
                onChange={handleAngleModeChange}
              >
                {option.label}
              </Radio>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

function Checkbox({ checked, onChange }) {
  const [isChecked, setIsChecked] = useState(checked);

  useEffect(() => {
    setIsChecked(checked);
  }, [checked]);

  return (
    <div
      className={`relative w-[27px] h-[16px] rounded-[75px] cursor-pointer transition-colors duration-75 
        ${isChecked ? "bg-[#493C1D]" : "bg-[#3B4049]"}`}
      onClick={onChange}
    >
      <div
        className={`absolute w-[12px] h-[12px] rounded-[75px] top-[2px] transition-all duration-75 ease-in-out 
          ${
            isChecked ? "left-[13px] bg-[#FFB400]" : "left-[2px] bg-[#989BA6]"
          }`}
      />
    </div>
  );
}

function Radio({ value, name, checked, onChange, children }) {
  return (
    <label className="flex items-center cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        className="hidden"
        checked={checked}
        onChange={onChange}
      />
      <span className="w-[15px] h-[15px] inline-block mr-[10px] rounded-full bg-[#3B4049] border border-[#989BA6] flex-shrink-0 relative">
        <span
          className={`
            absolute inset-0 rounded-full transform transition-all duration-200
            ${
              checked
                ? "bg-[#FFB400] scale-[0.5]"
                : "bg-transparent scale-[0.3]"
            }
          `}
        />
      </span>
      <span className="text-[13.5px] font-medium text-white leading-[15px] text-center">
        {children}
      </span>
    </label>
  );
}

function Footer() {
  const ipcRenderer = window.electron.ipcRenderer;

  const handleClick = (link) => {
    ipcRenderer.send("open-external", link);
  };

  return (
    <div className="flex flex-col w-full h-full gap-[18px] justify-between">
      <div className="flex w-full gap-[18px]">
        <button
          onClick={() =>
            handleClick("https://github.com/lee-sihun/djmax-keyviewer")
          }
          className="flex flex-1 items-center justify-center gap-[7.5px] w-full h-[31px] bg-[#1C1E25] rounded-[6px] border border-[#3F444D]"
        >
          <object
            type="image/svg+xml"
            data={Github}
            className="pointer-events-none"
          />
          <p className="text-white text-[15px] leading-[16.5px] truncate">
            Github
          </p>
        </button>
        <button
          onClick={() =>
            handleClick("https://github.com/lee-sihun/djmax-keyviewer/issues")
          }
          className="flex flex-1 items-center justify-center gap-[7.5px] w-full h-[31.5px] bg-[#1C1E25] rounded-[6px] border border-[#3F444D]"
        >
          <object
            type="image/svg+xml"
            data={Bug}
            className="pointer-events-none"
          />
          <p className="text-white text-[15px] leading-[16.5px] truncate">
            Bug Report
          </p>
        </button>
      </div>
      <div className="flex-col w-full gap-[4px] justify-center items-center">
        <p className="text-[#D8DADF] text-[10.5px] text-center">
          본 프로그램은 NEOWIZ 또는 DJMAX RESPECT V 공식 개발사와 아무런 관련이
          없습니다.
        </p>
        <p className="text-[#989BA6] text-[10.5px] text-center">(Ver 1.0.4)</p>
      </div>
    </div>
  );
}
