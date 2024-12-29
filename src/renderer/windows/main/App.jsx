import Tab from "@components/Tab";
import TitleBar from "@components/TitleBar";
import React from "react";

export default function App() {
  return (
    <div className="bg-[#101216] w-full h-full flex flex-col rounded-[6px]">
      <TitleBar />
      <Tab />
    </div>
  );
}