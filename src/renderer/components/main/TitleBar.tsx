import React from 'react';
import Close from '@assets/svgs/close.svg';
import Minimize from '@assets/svgs/minimize.svg';
import Logo from '@assets/svgs/logo.svg';
import { isMac } from '@utils/core/platform';

const TitleBar = (): React.ReactElement => {
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
      className="relative w-full h-[30px] min-h-[30px] flex justify-center items-center bg-app border-b border-line rounded-t-[8px] [app-region:drag]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-[6px] text-fg-muted pointer-events-none">
        <Logo className="w-[12px] h-[12px] shrink-0" />
        <span className="text-[12px] leading-[12px] font-semibold tracking-[0.06em] select-none">
          DM NOTE
        </span>
      </div>
      {!isMacOS && (
        <div
          data-tauri-drag-region="false"
          className="absolute right-0 flex h-full [app-region:no-drag]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleMinimize}
            className="w-[38px] h-full flex justify-center items-center text-fg-muted hover:bg-white/[0.06] hover:text-fg active:bg-white/[0.09] transition-colors duration-fast"
          >
            <Minimize className="scale-[0.8] pointer-events-none" />
          </button>
          <button
            onClick={handleClose}
            className="w-[38px] h-full flex justify-center items-center text-fg-muted hover:bg-danger hover:text-white active:bg-danger-active transition-colors duration-fast rounded-tr-[8px]"
          >
            <Close className="scale-[0.7] pointer-events-none" />
          </button>
        </div>
      )}
    </div>
  );
};

export default TitleBar;
