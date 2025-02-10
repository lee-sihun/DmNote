import Tab from "@components/Tab";
import TitleBar from "@components/TitleBar";
import React from "react";

export default function App() {
  return (
    <div className="bg-[#101216] w-full h-full flex flex-col rounded-[6px] border border-[rgba(255,255,255,0.1)]">
      <TitleBar />
      <Tab />
    </div>
  );
}
