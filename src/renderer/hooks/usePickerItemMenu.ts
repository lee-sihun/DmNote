import React, { useState } from 'react';

// 피커 행의 ⋮ 버튼/우클릭으로 여는 컨텍스트 메뉴 상태 관리
export const usePickerItemMenu = <TKey>() => {
  const [menuKey, setMenuKey] = useState<TKey | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const close = () => {
    setMenuKey(null);
    setMenuPosition(null);
  };

  const openFromButton = (event: React.MouseEvent<HTMLElement>, key: TKey) => {
    event.preventDefault();
    event.stopPropagation();
    if (menuKey === key) {
      close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right + 4, y: rect.top - 2 });
    setMenuKey(key);
  };

  const openFromContextMenu = (
    event: React.MouseEvent<HTMLElement>,
    key: TKey,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuPosition({ x: event.clientX, y: event.clientY });
    setMenuKey(key);
  };

  return { menuKey, menuPosition, openFromButton, openFromContextMenu, close };
};
