import React from "react";
import Close from "@assets/svgs/close.svg";
import Minimize from "@assets/svgs/minimize.svg";

export default function TitleBar() {
  const handleMinimize = () => {
    window.electron.windowControl.minimize();
  };

  const handleClose = () => {
    window.electron.windowControl.close();
  };

  return (
    <div className="w-full h-[40px] flex justify-between items-center bg-[#1C1E25] rounded-t-[6px] [app-region:drag]">
      <div className="text-[15px] font-black text-[#989BA6] ml-[24px]">DM NOTE</div>
      <div className="flex h-full [app-region:no-drag]">
        <button 
          onClick={handleMinimize}
          className="w-[50px] h-full flex justify-center items-center hover:bg-[#21232B] active:bg-[#282B35] transition-colors"
        >
          <object type="image/svg+xml" data={Minimize} className="scale-[0.9]"/>
        </button>
        <button
          onClick={handleClose} 
          className="w-[50px] h-full flex justify-center items-center hover:bg-[#21232B] active:bg-[#282B35] transition-colors rounded-tr-[6px]"
        >
          <object type="image/svg+xml" data={Close} className="scale-[0.8]"/>
        </button>
      </div>
    </div>
  );
}