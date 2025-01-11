import React from "react";
import Grid from "./Grid";
import { useKeyStore } from "@stores/useKeyStore"; 

export default function Canvas() {
  return (
    <div className="flex flex-col w-full h-full p-[18px] justify-between">
      <KeyMenu />
      <Grid />
    </div>
  )
}

export function KeyMenu() {
  const { selectedKeyType, setSelectedKeyType } = useKeyStore();
  
  const keyTypes = ['4key', '5key', '6key', '8key'];

  return (
    <div className="flex gap-[14px] ">
      {keyTypes.map((keyType) => (
        <button
          key={keyType}
          onClick={() => setSelectedKeyType(keyType)}
          className={`
            flex justify-center items-center w-[45px] h-[31.5px] rounded-[6px] 
            ${selectedKeyType !== keyType 
              ? 'bg-[#14161B] text-[#414249] border-none'
              : 'bg-[#272B33] text-[#989BA6] border-[rgba(255,255,255,0.1)]'
            }
            border text-[15px] font-bold
          `}
        >
          {keyType.replace('key', '키')}
        </button>
      ))}
    </div>
  )
}