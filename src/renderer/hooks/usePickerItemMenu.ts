import React, { useRef, useState } from 'react';

// 피커 행의 ⋮ 버튼/우클릭으로 여는 컨텍스트 메뉴 상태 관리
export const usePickerItemMenu = <TKey>() => {
  const [menuKey, setMenuKey] = useState<TKey | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // 메뉴가 열린 상태에서 ⋮를 다시 누르면 문서 outside-click이 pointerdown에
  // 메뉴를 먼저 닫아버려 click 핸들러가 다시 여는 깜빡임이 생긴다.
  // pointerdown 시점의 열림 상태를 key와 함께 기록해 click에서 토글로 판정한다
  const pressedWhileOpenKeyRef = useRef<TKey | null>(null);

  const close = () => {
    setMenuKey(null);
    setMenuPosition(null);
  };

  // ⋮ 버튼의 onPointerDown에 연결
  const capturePressState = (key: TKey) => {
    pressedWhileOpenKeyRef.current = menuKey === key ? key : null;
  };

  const openFromButton = (event: React.MouseEvent<HTMLElement>, key: TKey) => {
    event.preventDefault();
    event.stopPropagation();
    const pressedWhileOpen = pressedWhileOpenKeyRef.current === key;
    pressedWhileOpenKeyRef.current = null;
    if (pressedWhileOpen || menuKey === key) {
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
    // 이름 변경 입력 등 편집 요소에선 네이티브 편집 메뉴에 양보
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    pressedWhileOpenKeyRef.current = null;
    setMenuPosition({ x: event.clientX, y: event.clientY });
    setMenuKey(key);
  };

  return {
    menuKey,
    menuPosition,
    capturePressState,
    openFromButton,
    openFromContextMenu,
    close,
  };
};
