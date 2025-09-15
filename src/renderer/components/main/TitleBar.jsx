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
    <div className="w-full h-[39px] min-h-[39px] flex justify-between items-center bg-primary rounded-t-[6px] [app-region:drag]">
      <div className="text-[15px] font-semibold tracking-[0.05em] text-[#DBDEE8] ml-[16px]">
        DM NOTE
      </div>
      <div className="flex h-full [app-region:no-drag]">
        <button
          onClick={handleMinimize}
          className="w-[50px] h-full flex justify-center items-center hover:bg-[#21232B] active:bg-[#282B35] transition-colors"
        >
          <object
            type="image/svg+xml"
            data={Minimize}
            className="scale-[0.9] pointer-events-none"
          />
        </button>
        <button
          onClick={handleClose}
          className="w-[50px] h-full flex justify-center items-center hover:bg-[#501D1E] active:bg-[#5A2829] transition-colors rounded-tr-[6px]"
        >
          <object
            type="image/svg+xml"
            data={Close}
            className="scale-[0.8] pointer-events-none"
          />
        </button>
      </div>
    </div>
  );
}
