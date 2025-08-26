import Tab from "@components/main/Tab";
import TitleBar from "@components/main/TitleBar";
import React from "react";

export default function App() {
  return (
    <div className="bg-[#101216] w-full h-full flex flex-col overflow-hidden rounded-[6px] border border-[rgba(255,255,255,0.1)]">
      <TitleBar />
      <Tab />
    </div>
  );
}
