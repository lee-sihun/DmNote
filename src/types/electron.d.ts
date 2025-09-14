declare global {
  interface ElectronIpcRenderer {
    invoke(channel: string, ...args: any[]): Promise<any>;
    send(channel: string, ...args: any[]): void;
    on(channel: string, listener: (...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
  }

  interface Window {
    electron: {
      ipcRenderer: ElectronIpcRenderer;
    };
  }
}

export {};
