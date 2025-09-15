import React, { useEffect, useState } from "react";

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
}

const Checkbox = ({ checked, onChange }: CheckboxProps) => {
  const [isChecked, setIsChecked] = useState(checked);

  useEffect(() => {
    setIsChecked(checked);
  }, [checked]);

  return (
    <div
      className={`relative w-[27px] h-[16px] rounded-[75px] cursor-pointer transition-colors duration-75 
        ${isChecked ? "bg-[#493C1D]" : "bg-[#3B4049]"}`}
      onClick={onChange}
    >
      <div
        className={`absolute w-[12px] h-[12px] rounded-[75px] top-[2px] transition-all duration-75 ease-in-out 
          ${isChecked ? "left-[13px] bg-[#FFB400]" : "left-[2px] bg-[#989BA6]"}`}
      />
    </div>
  );
};

export default Checkbox;