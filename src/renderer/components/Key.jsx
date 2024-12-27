import React from "react";

export default function Key({ keyName, active }) {
  return (
    <div className={`w-[50px] h-[50px] mx-2.5 border-2 border-white rounded border-solid flex items-center justify-center ${
      active ? 'bg-white/80 text-black' : 'bg-black/50 text-white'
    }`}>
      {keyName}
    </div>
  )
}