import React from 'react';
import Close from '@assets/svgs/close.svg';
import Minimize from '@assets/svgs/minimize.svg';
import Logo from '@assets/svgs/logo.svg';
import { isMac } from '@utils/core/platform';
import { useSingleFlightAction } from '@hooks/useSingleFlightAction';

const TitleBar = (): React.ReactElement => {
  const isMacOS: boolean = isMac();
  const { run: minimize, pending: minimizing } = useSingleFlightAction(() =>
    window.api.window.minimize(),
  );
  const { run: close, pending: closing } = useSingleFlightAction(() =>
    window.api.window.close(),
  );
  const handleMinimize = () => {
    void minimize().catch((error) =>
      console.error('Failed to minimize window', error),
    );
  };
  const handleClose = () => {
    void close().catch((error) =>
      console.error('Failed to close window', error),
    );
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
            disabled={minimizing || closing}
            className="w-[38px] h-full flex justify-center items-center text-fg-muted hover:bg-fill hover:text-fg active:bg-fill-hover transition-colors duration-fast"
          >
            <Minimize className="scale-[0.8] pointer-events-none" />
          </button>
          <button
            onClick={handleClose}
            disabled={closing}
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
