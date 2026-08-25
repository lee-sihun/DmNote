import React from 'react';
import Dropdown from '@components/main/common/Dropdown';

interface NoteGlowPaintSourceDropdownProps {
  follow: boolean;
  onChange: (follow: boolean) => void;
  t: (key: string) => string;
}

// 글로우 페인트 소스 - 노트 색상 따라가기 / 직접 지정.
// 테두리 방향 드롭다운과 같은 아이콘 트리거 구성이라 스와치 옆에 나란히 둔다
const NoteGlowPaintSourceDropdown = ({
  follow,
  onChange,
  t,
}: NoteGlowPaintSourceDropdownProps) => {
  const followLabel =
    t('keySetting.noteGlowPaintFollow') || '노트 색상 따라가기';
  const customLabel = t('keySetting.noteGlowPaintCustom') || '직접 지정';
  const rowLabel = t('keySetting.noteGlowColor') || '글로우 색상';
  return (
    <Dropdown
      commitStrategy="after-paint"
      align="right"
      ariaLabel={`${rowLabel}: ${follow ? followLabel : customLabel}`}
      iconTrigger={
        <svg
          aria-hidden="true"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {follow ? (
            <>
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
              <path d="M8 12h8" />
            </>
          ) : (
            <>
              <path d="M8 17H6A5 5 0 0 1 6 7h2" />
              <path d="M16 7h2a5 5 0 1 1 0 10h-2" />
            </>
          )}
        </svg>
      }
      options={[
        { label: followLabel, value: 'follow' },
        { label: customLabel, value: 'custom' },
      ]}
      value={follow ? 'follow' : 'custom'}
      onChange={(value) => onChange(value === 'follow')}
    />
  );
};

export default NoteGlowPaintSourceDropdown;
