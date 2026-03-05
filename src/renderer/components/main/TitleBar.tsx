import React from 'react';
import Close from '@assets/svgs/close.svg';
import Minimize from '@assets/svgs/minimize.svg';
import Logo from '@assets/svgs/logo.svg';
import { isMac } from '@utils/core/platform';

export default function TitleBar(): React.ReactElement {
  const isMacOS: boolean = isMac();
  const handleMinimize = (): void => {
    window.api.window.minimize();
  };

  const handleClose = (): void => {
    window.api.window.close();
  };

  return (
    <div
      data-tauri-drag-region
      className="relative w-full h-[30px] min-h-[30px] flex justify-center items-center bg-primary rounded-t-[6px] [app-region:drag]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-[6px]">
        <Logo className="w-[12px] h-[12px]" />
        <div className="text-[12px] font-bold tracking-[0.05em] text-[#999BA5] select-none">
          DM NOTE
        </div>
      </div>
      {!isMacOS && (
        <div
          data-tauri-drag-region="false"
          className="absolute right-0 flex h-full [app-region:no-drag]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleMinimize}
            className="w-[36px] h-full flex justify-center items-center hover:bg-[#21232B] active:bg-[#282B35] transition-colors"
          >
            <Minimize className="scale-[0.8] pointer-events-none" />
          </button>
          <button
            onClick={handleClose}
            className="w-[36px] h-full flex justify-center items-center hover:bg-[#501D1E] active:bg-[#5A2829] transition-colors rounded-tr-[6px]"
          >
            <Close className="scale-[0.7] pointer-events-none" />
          </button>
        </div>
      )}
    </div>
  );
}
