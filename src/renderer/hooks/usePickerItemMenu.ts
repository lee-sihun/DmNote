import React, { useRef, useState } from 'react';
import { useRetainedValue } from '@hooks/ui/useRetainedValue';

// 피커 행의 ⋮ 버튼/우클릭/키보드로 여는 컨텍스트 메뉴 상태 관리
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

  const openAt = (key: TKey, position: { x: number; y: number }) => {
    const pressedWhileOpen = pressedWhileOpenKeyRef.current === key;
    pressedWhileOpenKeyRef.current = null;
    if (pressedWhileOpen || menuKey === key) {
      close();
      return;
    }
    setMenuPosition(position);
    setMenuKey(key);
  };

  const openFromButton = (event: React.MouseEvent<HTMLElement>, key: TKey) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openAt(key, { x: rect.right + 4, y: rect.top - 2 });
  };

  // 행 키보드 조작(Enter/Space) - 행 왼쪽 아래에 붙여 연다.
  // 좌클릭은 메뉴를 열지 않는다 - 마우스는 우클릭 전용
  const openFromKeyboard = (
    event: React.KeyboardEvent<HTMLElement>,
    key: TKey,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    // 포인터 기록은 마우스 경로 전용 - 키보드 조작은 현재 열림 상태만 보고 토글
    pressedWhileOpenKeyRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    openAt(key, { x: rect.left + 8, y: rect.bottom });
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

  // 퇴장 모션이 도는 동안에도 대상과 좌표가 필요하다.
  // menuKey는 열림 판정용, renderKey는 렌더 유지용으로 나눠 쓴다
  const renderKey = useRetainedValue(menuKey);
  const renderPosition = useRetainedValue(menuPosition);

  return {
    menuKey,
    renderKey,
    renderPosition,
    capturePressState,
    openFromButton,
    openFromKeyboard,
    openFromContextMenu,
    close,
  };
};
