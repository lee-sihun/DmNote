import React from "react";

interface RadioProps {
  value: string;
  name: string;
  checked: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  children: React.ReactNode;
}

const Radio: React.FC<RadioProps> = ({ value, name, checked, onChange, children }) => {
  return (
    <label className="flex items-center cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        className="hidden"
        checked={checked}
        onChange={onChange}
      />
      <span className="w-[15px] h-[15px] inline-block mr-[10px] rounded-full bg-[#3B4049] border border-[#989BA6] flex-shrink-0 relative">
        <span
          className={`absolute inset-0 rounded-full transform transition-all duration-200 ${
            checked ? "bg-[#FFB400] scale-[0.5]" : "bg-transparent scale-[0.3]"
          }`}
        />
      </span>
      <span className="text-[13.5px] font-medium text-white leading-[15px] text-center">
        {children}
      </span>
    </label>
  );
};

export default Radio;