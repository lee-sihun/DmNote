import React, { useEffect, useState } from "react";
import { useSettingsStore } from "@stores/useSettingsStore";

export default function SettingTab() {
  const { 
    hardwareAcceleration, 
    setHardwareAcceleration,
    alwaysOnTop,
    setAlwaysOnTop 
  } = useSettingsStore();
  const ipcRenderer = window.electron.ipcRenderer;

  useEffect(() => {
    const updateHandler = (_, value) => {
      setHardwareAcceleration(value);
    };

    const alwaysOnTopHandler = (_, value) => {
      setAlwaysOnTop(value);
    };

    ipcRenderer.send('get-hardware-acceleration');
    ipcRenderer.on('update-hardware-acceleration', updateHandler);

    ipcRenderer.send('get-always-on-top');
    ipcRenderer.on('update-always-on-top', alwaysOnTopHandler);

    return () => {
      ipcRenderer.removeAllListeners('update-hardware-acceleration');
      ipcRenderer.removeAllListeners('update-always-on-top');
    };
  }, []);

  const handleHardwareAccelerationChange = async () => {
    const newState = !hardwareAcceleration;

    if (window.confirm('설정을 적용하려면 앱을 재시작해야 합니다. 지금 재시작하시겠습니까?')) {
      setHardwareAcceleration(newState);
      await ipcRenderer.invoke('toggle-hardware-acceleration', newState);
      ipcRenderer.send('restart-app');
    }
  };

  const handleAlwaysOnTopChange = () => {
    const newState = !alwaysOnTop;
    setAlwaysOnTop(newState);
    ipcRenderer.send('toggle-always-on-top', newState);
  };

  return (
    <div className="flex flex-col w-full h-full p-[18px]">
      <div className="w-full bg-[#1C1E25] rounded-[6px] px-[18px]">
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-medium w-[153px] text-white text-[13.5px]">항상 위에 표시</p>
          <Checkbox
            checked={alwaysOnTop}
            onChange={handleAlwaysOnTopChange} 
          />
        </div>
        <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-medium w-[153px] text-white text-[13.5px]">하드웨어 가속 활성화</p>
          <Checkbox 
            checked={hardwareAcceleration} 
            onChange={handleHardwareAccelerationChange}
          />
        </div>
        <div className="w-full h-[0.75px] bg-[#3C4049]" />
        <div className="flex items-center justify-between h-[51px] w-full pl-[117px] pr-[180px]">
          <p className="text-center font-medium w-[153px] text-white text-[13.5px]">
            키 입력 카운트 표시
            <a className="text-[#419DFF] cursor-pointer "> [초기화]</a>
          </p>
          <Checkbox />
        </div>
      </div>
    </div>
  )
}

function Checkbox({ checked, onChange}) {
  const [isChecked, setIsChecked] = useState(checked);

  useEffect(() => {
    setIsChecked(checked);
  }, [checked]);

  return (
    <div
      className={`relative w-[27px] h-[16px] rounded-[75px] cursor-pointer transition-colors duration-75 
        ${isChecked ? 'bg-[#493C1D]' : 'bg-[#3B4049]'}`}
      onClick={onChange}
    >
      <div 
        className={`absolute w-[12px] h-[12px] rounded-[75px] top-[2px] transition-all duration-75 ease-in-out 
          ${isChecked ? 'left-[13px] bg-[#FFB400]' : 'left-[2px] bg-[#989BA6]'}`}
      />
    </div>
  )
}