import React from 'react';

interface RadioProps {
  value: string;
  name: string;
  checked: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  children: React.ReactNode;
}

const Radio = ({ value, name, checked, onChange, children }: RadioProps) => {
  return (
    <label className="flex items-center cursor-pointer group">
      <input
        type="radio"
        name={name}
        value={value}
        className="hidden"
        checked={checked}
        onChange={onChange}
      />
      <span
        className={`w-[16px] h-[16px] inline-block mr-[8px] rounded-full border flex-shrink-0 relative transition-colors duration-fast ${
          checked
            ? 'border-accent'
            : 'border-line-strong group-hover:border-fg-faint'
        }`}
      >
        <span
          className={`absolute inset-0 rounded-full transition-all duration-fast ease-out-expo ${
            checked ? 'bg-accent scale-[0.5]' : 'bg-transparent scale-[0.3]'
          }`}
        />
      </span>
      <span className="text-label text-fg">{children}</span>
    </label>
  );
};

export default Radio;
