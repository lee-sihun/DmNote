/* eslint-disable no-undef */
import { useEffect } from "react";

/**
 * Injects a single <style id="djmv-custom-css"> element into the current window
 * and keeps it synchronized with the main process via IPC.
 * - Always appended as the last child of <head> to maximize precedence.
 * - Listens to:
 *    - 'update-custom-css' => updates textContent
 *    - 'update-use-custom-css' => toggles disabled
 * - On mount, fetches initial values via:
 *    - ipc.invoke('get-custom-css')
 *    - ipc.invoke('get-use-custom-css')
 */
export function useCustomCssInjection() {
  useEffect(() => {
    let ipc = null;
    // Try preload exposure (main window)
    try {
      if (window?.electron?.ipcRenderer) {
        ipc = window.electron.ipcRenderer;
      }
    } catch {}
    // Fallback to window.require (overlay window)
    if (!ipc) {
      try {
        if (window.require) {
          const { ipcRenderer } = window.require("electron");
          ipc = ipcRenderer;
        }
      } catch {}
    }

    // Ensure single style element with stable id
    let styleEl = document.getElementById("djmv-custom-css");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "djmv-custom-css";
      document.head.appendChild(styleEl);
    } else {
      // Move to the end to ensure it's last (highest precedence among normal styles)
      document.head.appendChild(styleEl);
    }

    const cleanups = [];

    if (ipc) {
      const cssContentHandler = (_, content) => {
        styleEl.textContent = content || "";
      };
      const useCssHandler = (_, enabled) => {
        styleEl.disabled = !enabled;
      };

      ipc.on("update-custom-css", cssContentHandler);
      ipc.on("update-use-custom-css", useCssHandler);
      cleanups.push(() => {
        try {
          ipc.removeListener("update-custom-css", cssContentHandler);
          ipc.removeListener("update-use-custom-css", useCssHandler);
        } catch {}
      });

      // Initial sync
      ipc
        .invoke("get-custom-css")
        .then((data) => {
          if (data && data.content) styleEl.textContent = data.content;
        })
        .catch(() => {});

      ipc
        .invoke("get-use-custom-css")
        .then((enabled) => {
          styleEl.disabled = !enabled;
        })
        .catch(() => {});
    }

    return () => {
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
      // Keep style element in DOM to avoid FOUC when component remounts
    };
  }, []);
}
