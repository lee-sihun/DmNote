import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nextProvider } from "react-i18next";
import i18n from "../../utils/i18n";
import "@styles/global.css";

function RootWithI18n() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (ipc) {
      ipc
        .invoke("get-language")
        .then((lng) => {
          if (lng && typeof lng === "string") {
            i18n.changeLanguage(lng);
          }
        })
        .finally(() => setReady(true));
      ipc.on("update-language", (_, lng) => {
        if (lng) i18n.changeLanguage(lng);
      });
    } else {
      setReady(true);
    }
  }, []);
  if (!ready) return null; // 간단한 로딩 생략
  return (
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  );
}

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<RootWithI18n />);
