// 탭 목록 아이콘 - 네 칸이 시계 방향으로 한 칸씩 옮겨가 잠깐 머물렀다 돌아온다.
// 회전 대칭이라 파트가 움직여도 아이콘 전체의 중심은 제자리에 남는다.
// 모션은 main.css의 dmnIconShift*, 도형은 기존 아이콘과 동일
const TabGridIcon = () => {
  return (
    <svg
      data-dmn-icon
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        data-dmn-icon-motion="shift-right"
        d="M6 1.5C6 0.671875 5.32812 0 4.5 0H1.5C0.671875 0 0 0.671875 0 1.5V4.5C0 5.32812 0.671875 6 1.5 6H4.5C5.32812 6 6 5.32812 6 4.5V1.5Z"
        fill="currentColor"
      />
      <path
        data-dmn-icon-motion="shift-down"
        d="M8 1.5V4.5C8 5.32812 8.67188 6 9.5 6H12.5C13.3281 6 14 5.32812 14 4.5V1.5C14 0.671875 13.3281 0 12.5 0H9.5C8.67188 0 8 0.671875 8 1.5Z"
        fill="currentColor"
      />
      <path
        data-dmn-icon-motion="shift-left"
        d="M14 9.5C14 8.67188 13.3281 8 12.5 8H9.5C8.67188 8 8 8.67188 8 9.5V12.5C8 13.3281 8.67188 14 9.5 14H12.5C13.3281 14 14 13.3281 14 12.5V9.5Z"
        fill="currentColor"
      />
      <path
        data-dmn-icon-motion="shift-up"
        d="M6 9.5C6 8.67188 5.32812 8 4.5 8H1.5C0.671875 8 0 8.67188 0 9.5V12.5C0 13.3281 0.671875 14 1.5 14H4.5C5.32812 14 6 13.3281 6 12.5V9.5Z"
        fill="currentColor"
      />
    </svg>
  );
};

export default TabGridIcon;
