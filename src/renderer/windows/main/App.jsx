import TitleBar from "@components/TitleBar";
import React from "react";

export default function App() {
  return (
    <div className="bg-[#101216] w-full h-full">
      <TitleBar />
      <h1 className="text-white">Electron + React + Tailwind</h1>
    </div>
  );
}